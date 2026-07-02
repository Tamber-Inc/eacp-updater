// eacp-updater-tool: the contract-critical half of the publish pipeline.
//
// Everything that ends up parsed by the updater library at runtime — channel
// index, product catalog, per-product manifests — is written HERE, through
// the same Miro-reflected structs the library reads back. Orchestration
// (building, signing, uploading) lives in the @tamber-inc/eacp-publish npm
// CLI, which shells out to this tool for all metadata. Wire-format drift
// between publisher and updater is therefore impossible: this binary is
// compiled from the same sources that parse the files.
//
// Commands:
//   eacp-updater-tool emit --spec <spec.json> --out <dir>
//       Writes a complete, upload-ready channel tree into <dir>:
//         index.json
//         channels/<channel>/catalog.json
//         channels/<channel>/products/<id>/manifest.json
//       then re-parses everything with the library parsers and fails loudly
//       if anything does not round-trip. Prints a JSON summary on stdout.
//
//   eacp-updater-tool validate --root <dir> --channel <channel>
//       Re-validates a previously emitted (or hand-edited) tree.
//
// The spec is deliberately friendly: enums are written as names ("macos",
// "universal", "app"), not the integers of the wire format.

#include <eacp/Hub/Hub.h>
#include <eacp/Updater/Updater.h>

#include <Miro/Miro.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>

namespace
{

namespace fs = std::filesystem;
namespace Updater = eacp::Updater;
namespace Hub = eacp::Hub;

struct SpecArtifact
{
    std::string platform;
    std::string architecture;
    std::string url;
    std::string sha256;
    std::string signature;

    MIRO_REFLECT(platform, architecture, url, sha256, signature)
};

struct SpecProduct
{
    std::string id;
    std::string name;
    std::string bundleName;
    std::string version;
    std::string kind;
    std::string role;
    eacp::Vector<std::string> dependencies;
    eacp::Vector<SpecArtifact> artifacts;

    MIRO_REFLECT(id, name, bundleName, version, kind, role, dependencies, artifacts)
};

struct EmitSpec
{
    std::string channel;
    std::string channelName;
    std::string defaultChannel;
    std::string publicRoot;
    std::string existingIndexPath;
    eacp::Vector<SpecProduct> products;

    MIRO_REFLECT(channel,
                 channelName,
                 defaultChannel,
                 publicRoot,
                 existingIndexPath,
                 products)
};

[[noreturn]] void fail(const std::string& message)
{
    std::cerr << "eacp-updater-tool: " << message << "\n";
    std::exit(1);
}

template <typename EnumType>
EnumType mapName(const std::string& value,
                 const std::map<std::string, EnumType>& names,
                 const std::string& what)
{
    auto lowered = value;
    for (auto& character: lowered)
        character = static_cast<char>(std::tolower(character));

    auto found = names.find(lowered);
    if (found == names.end())
    {
        auto allowed = std::string();
        for (const auto& [name, unused]: names)
            allowed += (allowed.empty() ? "" : ", ") + name;
        fail("unknown " + what + " '" + value + "' (allowed: " + allowed + ")");
    }
    return found->second;
}

Updater::Platform parsePlatform(const std::string& value)
{
    return mapName<Updater::Platform>(value,
                                      {{"any", Updater::Platform::Any},
                                       {"windows", Updater::Platform::Windows},
                                       {"win", Updater::Platform::Windows},
                                       {"macos", Updater::Platform::MacOS},
                                       {"mac", Updater::Platform::MacOS},
                                       {"linux", Updater::Platform::Linux}},
                                      "platform");
}

Updater::Architecture parseArchitecture(const std::string& value)
{
    return mapName<Updater::Architecture>(
        value,
        {{"any", Updater::Architecture::Any},
         {"x64", Updater::Architecture::X64},
         {"arm64", Updater::Architecture::Arm64},
         {"universal", Updater::Architecture::Universal}},
        "architecture");
}

Updater::PackageKind parseKind(const std::string& value)
{
    if (value.empty())
        return Updater::PackageKind::App;
    return mapName<Updater::PackageKind>(value,
                                         {{"app", Updater::PackageKind::App},
                                          {"runtime", Updater::PackageKind::Runtime},
                                          {"model", Updater::PackageKind::Model},
                                          {"blob", Updater::PackageKind::Blob}},
                                         "kind");
}

std::string readFile(const fs::path& path)
{
    auto stream = std::ifstream(path);
    if (!stream)
        fail("cannot read " + path.string());
    auto buffer = std::stringstream();
    buffer << stream.rdbuf();
    return buffer.str();
}

void writeFile(const fs::path& path, const std::string& text)
{
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    auto stream = std::ofstream(path);
    stream << text;
    if (!stream)
        fail("cannot write " + path.string());
}

void checkSha256(const std::string& sha256, const std::string& context)
{
    if (sha256.size() != 64
        || sha256.find_first_not_of("0123456789abcdef") != std::string::npos)
        fail(context + ": sha256 must be 64 lowercase hex characters, got '"
             + sha256 + "'");
}

void checkProduct(const SpecProduct& product)
{
    auto context = "product '" + product.id + "'";
    if (!Updater::isValidProductId(product.id))
        fail(context + ": invalid product id");
    if (product.kind.empty() || parseKind(product.kind) == Updater::PackageKind::App)
    {
        if (!Updater::isValidAppBundleName(product.bundleName))
            fail(context + ": invalid app bundle name '" + product.bundleName + "'");
    }
    if (product.name.empty())
        fail(context + ": name is required");
    if (product.version.empty())
        fail(context + ": version is required");
    if (product.artifacts.empty())
        fail(context + ": at least one artifact is required");
    for (const auto& artifact: product.artifacts)
    {
        if (artifact.url.empty())
            fail(context + ": artifact url is required");
        checkSha256(artifact.sha256, context);
    }
}

Updater::Product toCatalogProduct(const SpecProduct& product,
                                  const std::string& channel)
{
    auto result = Updater::Product();
    result.id = product.id;
    result.name = product.name;
    result.kind = parseKind(product.kind);
    result.bundleName = product.bundleName;
    result.channel = channel;
    result.latestVersion = product.version;
    result.dependencies = product.dependencies;

    for (const auto& artifact: product.artifacts)
    {
        auto converted = Updater::ProductArtifact();
        converted.platform = parsePlatform(artifact.platform);
        converted.architecture = parseArchitecture(artifact.architecture);
        converted.url = artifact.url;
        converted.sha256 = artifact.sha256;
        converted.signature = artifact.signature;
        result.artifacts.add(converted);
    }

    return result;
}

Updater::RemoteAppManifest toManifest(const SpecProduct& product)
{
    // A RemoteAppManifest carries one artifact; prefer the macOS one until
    // manifests grow per-platform entries.
    const auto* chosen = &product.artifacts[0];
    for (const auto& artifact: product.artifacts)
        if (parsePlatform(artifact.platform) == Updater::Platform::MacOS)
            chosen = &artifact;

    auto manifest = Updater::RemoteAppManifest();
    manifest.productId = product.id;
    manifest.name = product.name;
    manifest.version = product.version;
    manifest.bundleName = product.bundleName;
    manifest.artifact = {chosen->url, chosen->sha256};
    return manifest;
}

Hub::ChannelIndex buildIndex(const EmitSpec& spec)
{
    auto index = Hub::ChannelIndex();
    if (!spec.existingIndexPath.empty())
    {
        if (auto existing =
                Hub::loadChannelIndexFromPath(spec.existingIndexPath))
            index = *existing;
        else
            fail("existing index at '" + spec.existingIndexPath
                 + "' did not parse; refusing to clobber it");
    }

    auto entry = Hub::ChannelInfo();
    entry.id = spec.channel;
    entry.name = spec.channelName.empty() ? spec.channel : spec.channelName;
    entry.catalogUrl =
        spec.publicRoot + "/channels/" + spec.channel + "/catalog.json";

    auto replaced = false;
    for (auto& channel: index.channels)
    {
        if (channel.id == entry.id)
        {
            channel = entry;
            replaced = true;
        }
    }
    if (!replaced)
        index.channels.add(entry);

    index.defaultChannel =
        spec.defaultChannel.empty() ? spec.channel : spec.defaultChannel;
    for (auto& channel: index.channels)
        channel.isDefault = channel.id == index.defaultChannel;

    return index;
}

int catalogVersionFor(const EmitSpec& spec)
{
    if (spec.products.empty())
        return 1;
    auto major = std::atoi(spec.products[0].version.c_str());
    return major > 0 ? major : 1;
}

// Re-read everything we just wrote with the *library* parsers. If this
// passes, the shipped hub and apps can parse the channel by construction.
void validateTree(const fs::path& root, const std::string& channel)
{
    auto channelDir = root / "channels" / channel;

    auto index = Hub::loadChannelIndexFromPath(root / "index.json");
    if (!index)
        fail("index.json did not parse");
    if (index->defaultChannel.empty())
        fail("index.json has no defaultChannel");

    auto hasChannel = false;
    auto hasDefault = false;
    for (const auto& entry: index->channels)
    {
        hasChannel = hasChannel || entry.id == channel;
        hasDefault = hasDefault || entry.id == index->defaultChannel;
        if (entry.catalogUrl.empty())
            fail("channel '" + entry.id + "' has no catalogUrl");
    }
    if (!hasChannel)
        fail("index.json does not list channel '" + channel + "'");
    if (!hasDefault)
        fail("index.json defaultChannel '" + index->defaultChannel
             + "' is not in channels");

    auto catalog =
        Updater::parseCatalogJson(readFile(channelDir / "catalog.json"));
    for (const auto& product: catalog.products)
    {
        if (!Updater::isValidProductId(product.id))
            fail("catalog product '" + product.id + "' has an invalid id");

        auto manifestPath =
            channelDir / "products" / product.id / "manifest.json";
        auto manifest = Updater::RemoteAppManifest();
        try
        {
            Miro::fromJSONString(manifest, readFile(manifestPath));
        }
        catch (...)
        {
            fail("manifest for '" + product.id + "' did not parse");
        }
        if (manifest.productId != product.id)
            fail("manifest/catalog product id mismatch for '" + product.id + "'");
        if (manifest.version != product.latestVersion)
            fail("manifest version " + manifest.version + " != catalog "
                 + product.latestVersion + " for '" + product.id + "'");
    }
}

int runEmit(const std::map<std::string, std::string>& options)
{
    auto specPath = options.count("spec") ? options.at("spec") : "";
    auto outDir = options.count("out") ? options.at("out") : "";
    if (specPath.empty() || outDir.empty())
        fail("emit requires --spec <spec.json> and --out <dir>");

    auto spec = EmitSpec();
    try
    {
        Miro::fromJSONString(spec, readFile(specPath));
    }
    catch (const std::exception& error)
    {
        fail("spec did not parse: " + std::string(error.what()));
    }
    catch (...)
    {
        fail("spec did not parse");
    }

    if (spec.channel.empty())
        fail("spec.channel is required");
    if (spec.publicRoot.empty())
        fail("spec.publicRoot is required");
    if (spec.products.empty())
        fail("spec.products must not be empty");

    for (const auto& product: spec.products)
        checkProduct(product);

    auto root = fs::path(outDir);
    auto channelDir = root / "channels" / spec.channel;

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = catalogVersionFor(spec);
    for (const auto& product: spec.products)
    {
        if (product.role != "hub")
            catalog.products.add(toCatalogProduct(product, spec.channel));
    }
    writeFile(channelDir / "catalog.json", Updater::catalogToJson(catalog));

    for (const auto& product: spec.products)
    {
        writeFile(channelDir / "products" / product.id / "manifest.json",
                  Miro::toJSONString(toManifest(product)));
    }

    writeFile(root / "index.json", Miro::toJSONString(buildIndex(spec)));

    validateTree(root, spec.channel);

    auto summary = std::ostringstream();
    summary << "{\n  \"channel\": \"" << spec.channel << "\",\n"
            << "  \"catalogProducts\": " << catalog.products.size() << ",\n"
            << "  \"manifests\": " << spec.products.size() << ",\n"
            << "  \"root\": \"" << root.string() << "\"\n}";
    std::cout << summary.str() << "\n";
    return 0;
}

int runValidate(const std::map<std::string, std::string>& options)
{
    auto root = options.count("root") ? options.at("root") : "";
    auto channel = options.count("channel") ? options.at("channel") : "";
    if (root.empty() || channel.empty())
        fail("validate requires --root <dir> and --channel <channel>");

    validateTree(root, channel);
    std::cout << "ok\n";
    return 0;
}

void printUsage()
{
    std::cout <<
        "eacp-updater-tool — writes and validates updater channel metadata\n"
        "through the same reflection code the updater library parses it with.\n"
        "\n"
        "Usage:\n"
        "  eacp-updater-tool emit --spec <spec.json> --out <dir>\n"
        "  eacp-updater-tool validate --root <dir> --channel <channel>\n";
}

} // namespace

int main(int argc, char* argv[])
{
    if (argc < 2)
    {
        printUsage();
        return 1;
    }

    auto command = std::string(argv[1]);
    auto options = std::map<std::string, std::string>();
    for (auto index = 2; index + 1 < argc; index += 2)
    {
        auto key = std::string(argv[index]);
        if (key.rfind("--", 0) != 0)
            fail("unexpected argument '" + key + "'");
        options[key.substr(2)] = argv[index + 1];
    }

    if (command == "emit")
        return runEmit(options);
    if (command == "validate")
        return runValidate(options);
    if (command == "--help" || command == "help")
    {
        printUsage();
        return 0;
    }

    fail("unknown command '" + command + "' (try --help)");
}
