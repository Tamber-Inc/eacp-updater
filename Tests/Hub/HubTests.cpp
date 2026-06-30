#include <eacp/Hub/Hub.h>

#include <eacp/Core/Utils/SHA256.h>

#include <NanoTest/NanoTest.h>

#include <filesystem>
#include <fstream>
#include <system_error>

using namespace nano;
namespace fs = std::filesystem;
namespace Hub = eacp::Hub;
namespace Updater = eacp::Updater;

namespace
{

fs::path testRoot(const std::string& name)
{
    auto root = fs::temp_directory_path() / ("eacp-hub-tests-" + name);
    std::error_code ec;
    fs::remove_all(root, ec);
    fs::create_directories(root, ec);
    return root;
}

void writeFile(const fs::path& path, const std::string& text)
{
    fs::create_directories(path.parent_path());
    auto out = std::ofstream(path, std::ios::binary | std::ios::trunc);
    out << text;
}

Updater::Product product(const std::string& id,
                         const std::string& name,
                         Updater::PackageKind kind,
                         const std::string& version,
                         const fs::path& artifactPath)
{
    auto out = Updater::Product();
    out.id = id;
    out.name = name;
    out.kind = kind;
    out.channel = "ai-models";
    out.latestVersion = version;

    auto artifact = Updater::ProductArtifact();
    artifact.platform = Updater::Platform::Any;
    artifact.architecture = Updater::Architecture::Any;
    artifact.url = "file://" + artifactPath.string();
    artifact.sha256 = eacp::Crypto::sha256File(artifactPath.string());
    out.artifacts.add(artifact);
    return out;
}

void writeCatalogAt(const fs::path& path, const Updater::ProductCatalog& catalog)
{
    writeFile(path, Updater::catalogToJson(catalog));
}

} // namespace

auto tManualCatalogWinsOverFallback =
    test("Hub/manualCatalogWinsOverFallback") = []
{
    auto root = testRoot("manual-wins");
    auto artifact = root / "artifacts" / "clap-v2.zip";
    writeFile(artifact, "clap model v2");

    auto manual = Updater::ProductCatalog();
    manual.catalogVersion = 9;
    manual.products.add(product("shared.clap",
                                "CLAP Model",
                                Updater::PackageKind::Model,
                                "2.0.0",
                                artifact));

    auto manualPath = root / "manual" / "models.json";
    writeCatalogAt(manualPath, manual);

    auto fallback = Updater::ProductCatalog();
    fallback.catalogVersion = 1;
    fallback.products.add(product("com.eacp.maze",
                                  "Maze",
                                  Updater::PackageKind::App,
                                  "1.0.0",
                                  artifact));

    auto loaded = Hub::loadCatalog(
        {.stateRoot = root, .manualCatalogPath = manualPath},
        {},
        [&] { return fallback; });

    check(loaded.catalogVersion == 9);
    check(loaded.products.size() == 1);
    if (loaded.products.size() == 1)
    {
        check(loaded.products[0].id == "shared.clap");
        check(loaded.products[0].kind == Updater::PackageKind::Model);
        check(loaded.products[0].latestVersion == "2.0.0");
    }
};

auto tManualCatalogCanDriveModelOnlyUpdatePlan =
    test("Hub/manualCatalogCanDriveModelOnlyUpdatePlan") = []
{
    auto root = testRoot("model-only-update");
    auto artifact = root / "artifacts" / "clap-v3.zip";
    writeFile(artifact, "clap model v3");

    auto manual = Updater::ProductCatalog();
    manual.catalogVersion = 12;
    manual.products.add(product("shared.clap",
                                "CLAP Model",
                                Updater::PackageKind::Model,
                                "3.0.0",
                                artifact));

    auto manualPath = root / "manual" / "models.json";
    writeCatalogAt(manualPath, manual);

    auto receipt = Updater::ProductReceipt();
    receipt.productId = "shared.clap";
    receipt.name = "CLAP Model";
    receipt.version = "2.0.0";
    receipt.installPath = (root / "components" / "shared.clap").string();
    receipt.channel = "ai-models";
    receipt.artifactSha256 = "old-hash";
    receipt.installedAt = "2026-06-29T00:00:00Z";

    auto receipts = eacp::Vector<Updater::ProductReceipt>();
    receipts.add(receipt);

    auto loaded = Hub::loadCatalogContaining(
        {.stateRoot = root, .manualCatalogPath = manualPath},
        "shared.clap",
        [] { return Updater::ProductCatalog(); });

    auto plan = Updater::planUpdateProduct(loaded,
                                           receipts,
                                           "shared.clap",
                                           Updater::Target {
                                               .platform = Updater::Platform::MacOS,
                                               .architecture =
                                                   Updater::Architecture::Universal},
                                           (root / "staging").string());

    check(plan.operations.size() == 1);
    if (plan.operations.size() == 1)
    {
        check(plan.operations[0].productId == "shared.clap");
        check(plan.operations[0].version == "3.0.0");
    }
};

auto tStableChannelUsesIndexCatalogUrl =
    test("Hub/stableChannelUsesIndexCatalogUrl") = []
{
    auto root = testRoot("stable-index");
    writeFile(Hub::cachedChannelIndexPath(root),
              R"({"defaultChannel":"stable","channels":[{"id":"stable","name":"Stable","catalogUrl":"https://example.test/channels/stable/apphub-catalog.json","isDefault":true},{"id":"develop","name":"Develop","catalogUrl":"https://example.test/channels/develop/apphub-catalog.json"}]})");

    auto config = Hub::CatalogConfig();
    config.stateRoot = root;
    config.channel = "stable";

    auto channels = Hub::availableChannels(config);
    check(channels.size() == 2);
    check(Hub::resolvedCatalogUrl(config)
          == "https://example.test/channels/stable/apphub-catalog.json");
};

auto tBranchChannelUsesIndexCatalogUrl =
    test("Hub/branchChannelUsesIndexCatalogUrl") = []
{
    auto root = testRoot("branch-index");
    writeFile(Hub::cachedChannelIndexPath(root),
              R"({"defaultChannel":"stable","channels":[{"id":"stable","catalogUrl":"https://example.test/channels/stable/apphub-catalog.json","isDefault":true},{"id":"jp/feat/some-random-branch","name":"JP Branch","catalogUrl":"https://example.test/channels/jp-feat-some-random-branch/apphub-catalog.json"}]})");

    auto config = Hub::CatalogConfig();
    config.stateRoot = root;
    config.channel = "jp/feat/some-random-branch";

    check(Hub::resolvedCatalogUrl(config)
          == "https://example.test/channels/"
             "jp-feat-some-random-branch/apphub-catalog.json");
};

auto tDevelopChannelHasIndependentCache =
    test("Hub/developChannelHasIndependentCache") = []
{
    auto root = testRoot("develop-cache");

    check(Hub::cachedCatalogPath(root, "stable")
          == root / "remote-downloads" / "apphub-catalog.json");
    check(Hub::cachedCatalogPath(root, "develop")
          == root / "remote-downloads" / "catalogs" / "develop.json");
};
