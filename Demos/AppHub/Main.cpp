#include "App.h"
#include "PrivilegedHelperClient.h"

#include <eacp/AppHub/AppHubPlatform.h>
#include <eacp/Updater/Updater.h>

#include <eacp/Core/Utils/SHA256.h>
#include <eacp/Network/HTTP/Http.h>
#include <eacp/Graphics/Graphics.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>

namespace fs = std::filesystem;
namespace Graphics = eacp::Graphics;
namespace HTTP = eacp::HTTP;
namespace Updater = eacp::Updater;

#ifndef EACP_APPHUB_VERSION
#define EACP_APPHUB_VERSION "0.0.0"
#endif

#ifndef EACP_APPHUB_DEMO_MANIFEST_URL
#define EACP_APPHUB_DEMO_MANIFEST_URL \
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/manifest.json"
#endif

#ifndef EACP_APPHUB_MANIFEST_URL
#define EACP_APPHUB_MANIFEST_URL \
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/hub-manifest.json"
#endif

namespace
{
constexpr std::string_view editorId = "tamber.editor";
constexpr std::string_view captureId = "tamber.capture";
constexpr std::string_view runtimeId = "shared.onnxruntime";
constexpr std::string_view modelId = "shared.clap";
constexpr std::string_view defaultDemoManifestUrl = EACP_APPHUB_DEMO_MANIFEST_URL;
constexpr std::string_view defaultHubManifestUrl = EACP_APPHUB_MANIFEST_URL;

struct CliOptions
{
    fs::path root = fs::temp_directory_path() / "eacp-apphub-demo";
    std::string command = "gui";
    std::string productId;
    std::string manifestUrl;
};

fs::path remoteDownloadRoot(const fs::path& root);

void writeFile(const fs::path& path, const std::string& text)
{
    fs::create_directories(path.parent_path());
    auto out = std::ofstream(path, std::ios::binary | std::ios::trunc);
    out << text;
}

std::string stringFrom(std::string_view value)
{
    return std::string(value);
}

Updater::Target makeTarget()
{
    return AppHub::currentTarget();
}

Updater::ProductArtifact makeArtifact(const fs::path& artifact)
{
    auto out = Updater::ProductArtifact();
    auto target = makeTarget();
    out.platform = target.platform;
    out.architecture = target.architecture;
    out.url = "file://" + artifact.string();
    out.sha256 = eacp::Crypto::sha256File(artifact.string());
    out.signature = "dev-signature-placeholder";
    return out;
}

std::string readFile(const fs::path& path)
{
    auto in = std::ifstream(path, std::ios::binary);
    if (!in)
        return {};

    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

std::string downloadText(std::string_view url, const fs::path& output)
{
    std::error_code ec;
    fs::create_directories(output.parent_path(), ec);
    if (ec)
        return {};

    auto response = HTTP::Request(std::string(url)).perform();
    if (response.statusCode < 200 || response.statusCode >= 300)
        return {};

    writeFile(output, response.content);
    return readFile(output);
}

std::string executableVersion(std::string_view executable)
{
    auto ec = std::error_code();
    if (!fs::exists(fs::path(executable), ec))
        return {};

    auto result = eacp::Processes::run(std::string(executable), {"--version"});
    if (!result.exited || result.exitCode != 0)
        return {};

    auto out = result.output;
    while (!out.empty() && std::isspace(static_cast<unsigned char>(out.back())))
        out.pop_back();
    return out;
}

std::optional<Updater::RemoteAppManifest> remoteManifest(const fs::path& root,
                                                         std::string_view url,
                                                         std::string_view name)
{
    auto path = remoteDownloadRoot(root) / (std::string(name) + ".json");
    auto raw = downloadText(url, path);
    if (raw.empty())
        return std::nullopt;

    auto manifest = Updater::RemoteAppManifest();
    try
    {
        Miro::fromJSONString(manifest, raw);
    }
    catch (...)
    {
        return std::nullopt;
    }

    return manifest;
}

std::string updateStatusFor(const fs::path& root,
                            std::string_view manifestUrl,
                            std::string_view manifestName,
                            std::string_view installedExecutable,
                            std::string_view missingLabel)
{
    auto manifest = remoteManifest(root, manifestUrl, manifestName);
    if (!manifest)
        return "Update check failed";

    auto localVersion = executableVersion(installedExecutable);
    if (localVersion.empty())
        return std::string(missingLabel) + " is not installed";

    if (Updater::isNewerVersion(manifest->version, localVersion))
        return manifest->name + " update available: " + manifest->version;

    return manifest->name + " is up to date: " + localVersion;
}

bool openBundle(std::string_view appPath)
{
    return AppHub::openAppBundle(appPath).ok;
}

fs::path catalogPath(const fs::path& root)
{
    return root / "catalog.json";
}

fs::path stagingRoot(const fs::path& root)
{
    return root / "staging";
}

fs::path runningRoot(const fs::path& root)
{
    return root / "running";
}

fs::path runningPath(const fs::path& root, const std::string& productId)
{
    return runningRoot(root) / (productId + ".running");
}

fs::path remoteDownloadRoot(const fs::path& root)
{
    return root / "remote-downloads";
}

fs::path& guiStateRoot()
{
    static auto root = AppHub::defaultStateRoot();
    return root;
}

Updater::MockHelperOptions makeHelperOptions(const fs::path& root)
{
    auto options = Updater::MockHelperOptions();
    options.root = root.string();
    options.stagingRoot = stagingRoot(root).string();
    return options;
}

fs::path artifactPath(const fs::path& root, std::string_view productId)
{
    return stagingRoot(root) / (stringFrom(productId) + ".artifact");
}

Updater::Product makeProduct(const std::string& id,
                             const std::string& name,
                             Updater::PackageKind kind,
                             const std::string& version,
                             const fs::path& artifact,
                             const eacp::Vector<std::string>& dependencies = {},
                             const std::string& bundleName = {})
{
    auto product = Updater::Product();
    product.id = id;
    product.name = name;
    product.kind = kind;
    product.bundleName = bundleName;
    product.channel = "stable";
    product.latestVersion = version;
    product.dependencies = dependencies;
    product.artifacts.add(makeArtifact(artifact));
    return product;
}

Updater::ProductCatalog writeDevCatalog(const fs::path& root, bool updateEditor)
{
    auto editorArtifact = artifactPath(root, editorId);
    auto captureArtifact = artifactPath(root, captureId);
    auto runtimeArtifact = artifactPath(root, runtimeId);
    auto modelArtifact = artifactPath(root, modelId);

    writeFile(editorArtifact,
              updateEditor ? "Example Editor payload v2"
                           : "Example Editor payload v1");
    writeFile(captureArtifact, "Example Capture payload v1");
    writeFile(runtimeArtifact, "ONNX Runtime payload v1");
    writeFile(modelArtifact, updateEditor ? "CLAP model payload v2"
                                          : "CLAP model payload v1");

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = updateEditor ? 2 : 1;
    catalog.signature = "dev-catalog-signature-placeholder";

    catalog.products.add(makeProduct(stringFrom(runtimeId),
                                     "ONNX Runtime",
                                     Updater::PackageKind::Runtime,
                                     "1.0.0",
                                     runtimeArtifact));
    catalog.products.add(makeProduct(stringFrom(modelId),
                                     "CLAP Model",
                                     Updater::PackageKind::Model,
                                     updateEditor ? "2.0.0" : "1.0.0",
                                     modelArtifact));

    auto appDeps = eacp::Vector<std::string>();
    appDeps.add(stringFrom(runtimeId));
    appDeps.add(stringFrom(modelId));

    catalog.products.add(makeProduct(stringFrom(editorId),
                                     "Example Editor",
                                     Updater::PackageKind::App,
                                     updateEditor ? "2.0.0" : "1.0.0",
                                     editorArtifact,
                                     appDeps));
    catalog.products.add(makeProduct(stringFrom(captureId),
                                     "Example Capture",
                                     Updater::PackageKind::App,
                                     "1.0.0",
                                     captureArtifact,
                                     appDeps));

    writeFile(catalogPath(root), Updater::catalogToJson(catalog));
    return catalog;
}

Updater::ProductCatalog loadOrCreateCatalog(const fs::path& root)
{
    return Api::Detail::loadCatalog(root);
}

Updater::MockPrivilegedHelper makeHelper(const fs::path& root)
{
    return Updater::MockPrivilegedHelper(makeHelperOptions(root));
}

bool isRunning(const fs::path& root, const std::string& productId)
{
    auto ec = std::error_code();
    return fs::exists(runningPath(root, productId), ec);
}

eacp::Vector<std::string> runningProducts(const fs::path& root)
{
    auto out = eacp::Vector<std::string>();
    auto ec = std::error_code();
    auto dir = runningRoot(root);
    if (!fs::exists(dir, ec))
        return out;

    for (const auto& entry: fs::directory_iterator(dir, ec))
    {
        if (ec || !entry.is_regular_file())
            continue;

        auto name = entry.path().filename().string();
        constexpr auto suffix = std::string_view(".running");
        if (name.size() <= suffix.size()
            || name.compare(name.size() - suffix.size(),
                            suffix.size(),
                            suffix) != 0)
            continue;

        out.add(name.substr(0, name.size() - suffix.size()));
    }

    return out;
}

std::optional<CliOptions> parseArgs(int argc, char* argv[])
{
    auto options = CliOptions();

    for (auto i = 1; i < argc; ++i)
    {
        auto arg = std::string(argv[i]);
        if (arg == "--root")
        {
            if (i + 1 >= argc)
                return std::nullopt;
            options.root = argv[++i];
        }
        else if (arg == "--help" || arg == "-h")
        {
            options.command = "help";
        }
        else if (arg == "--version")
        {
            options.command = "version";
        }
        else if (options.command == "gui")
        {
            options.command = arg;
        }
        else if (arg == "--manifest-url")
        {
            if (i + 1 >= argc)
                return std::nullopt;
            options.manifestUrl = argv[++i];
        }
        else if (options.productId.empty())
        {
            options.productId = arg;
        }
        else
        {
            return std::nullopt;
        }
    }

    return options;
}

bool validBundleName(const std::string& bundleName)
{
    return Updater::isValidAppBundleName(bundleName);
}

void printUsage()
{
    std::cout
        << "AppHub updater\n\n"
        << "Usage:\n"
        << "  AppHub\n"
        << "  AppHub [--root <path>] tui\n"
        << "  AppHub [--root <path>] demo\n"
        << "  AppHub [--root <path>] reset\n"
        << "  AppHub [--root <path>] list\n"
        << "  AppHub [--root <path>] status\n"
        << "  AppHub [--root <path>] install <product-id>\n"
        << "  AppHub [--root <path>] catalog-install <product-id>\n"
        << "  AppHub [--root <path>] catalog-update <product-id>\n"
        << "  AppHub [--root <path>] open <product-id>\n"
        << "  AppHub [--root <path>] catalog-open <product-id>\n"
        << "  AppHub [--root <path>] close <product-id>\n"
        << "  AppHub [--root <path>] publish-update\n"
        << "  AppHub [--root <path>] bless-helper\n"
        << "  AppHub [--root <path>] remote-install [--manifest-url <url>]\n"
        << "  AppHub [--root <path>] update-demo [--manifest-url <url>]\n"
        << "  AppHub [--root <path>] update-hub [--manifest-url <url>]\n"
        << "  AppHub launch-demo\n"
        << "  AppHub launch-hub\n"
        << "  AppHub [--root <path>] check-updates\n"
        << "  AppHub [--root <path>] update [product-id]\n"
        << "  AppHub [--root <path>] remove <product-id>\n"
        << "  AppHub --version\n\n"
        << "Default feeds:\n"
        << "  Demo App: " << defaultDemoManifestUrl << "\n"
        << "  AppHub:   " << defaultHubManifestUrl << "\n\n"
        << "Use `AppHub [--root <path>] list` to print the selected catalog.\n";
}

void printStatus(const fs::path& root,
                 const Updater::ProductCatalog& catalog,
                 const eacp::Vector<Updater::ProductReceipt>& receipts)
{
    std::cout << "Root: " << root << "\n";
    std::cout << "Catalog version: " << catalog.catalogVersion << "\n";
    std::cout << "Products:\n";

    for (const auto& product: catalog.products)
    {
        auto* receipt = Updater::findReceipt(receipts, product.id);
        auto installed = receipt != nullptr;
        auto updateAvailable =
            installed && Updater::isNewerVersion(product.latestVersion,
                                                 receipt->version);

        std::cout << "  " << product.id << " | " << product.name
                  << " | latest " << product.latestVersion << " | ";

        if (!installed)
        {
            std::cout << "not installed\n";
        }
        else
        {
            std::cout << "installed " << receipt->version;
            if (updateAvailable)
                std::cout << " | update available";
            if (isRunning(root, product.id))
                std::cout << " | running";
            std::cout << "\n";
        }
    }
}

void printReceipts(const eacp::Vector<Updater::ProductReceipt>& receipts)
{
    std::cout << "Receipts:\n";
    if (receipts.empty())
    {
        std::cout << "  none\n";
        return;
    }

    for (const auto& receipt: receipts)
    {
        std::cout << "  " << receipt.productId << " " << receipt.version
                  << " -> " << receipt.installPath << "\n";
    }
}

int printResult(const std::string& label, const Updater::InstallResult& result)
{
    std::cout << label << ": " << (result.ok ? "ok" : result.error) << "\n";
    return result.ok ? 0 : 1;
}

int resetRoot(const fs::path& root)
{
    std::error_code ec;
    fs::remove_all(root, ec);
    if (ec)
    {
        std::cout << "Reset failed: " << ec.message() << "\n";
        return 1;
    }

    writeDevCatalog(root, false);
    auto helper = makeHelper(root);
    if (!helper.isInstalled())
    {
        std::cout << "Reset failed: helper root could not be created\n";
        return 1;
    }

    std::cout << "Reset mock AppHub root: " << root << "\n";
    return 0;
}

int installProduct(const fs::path& root, const std::string& productId)
{
    auto catalog = loadOrCreateCatalog(root);
    auto helper = makeHelper(root);
    auto plan = Updater::planInstallWithDependencies(catalog,
                                                     helper.receipts(),
                                                     productId,
                                                     makeTarget(),
                                                     stagingRoot(root).string());

    if (plan.operations.empty())
    {
        std::cout << "No install plan for product: " << productId << "\n";
        return 1;
    }

    return printResult("Install " + productId, helper.submit(plan));
}

int updateAll(const fs::path& root)
{
    auto catalog = loadOrCreateCatalog(root);
    auto helper = makeHelper(root);
    auto plan =
        Updater::planUpdateAll(catalog,
                               helper.receipts(),
                               makeTarget(),
                               stagingRoot(root).string());

    if (plan.operations.empty())
    {
        std::cout << "Update all: no updates available\n";
        return 0;
    }

    auto running = runningProducts(root);
    if (!running.empty())
    {
        std::cout << "Update all: waiting for apps to close";
        for (const auto& productId: running)
            std::cout << " " << productId;
        std::cout << "\n";
        return 0;
    }

    return printResult("Update all", helper.submit(plan));
}

int publishUpdate(const fs::path& root)
{
    writeDevCatalog(root, true);
    std::cout << "Published catalog version 2 with updates for "
              << modelId << " and " << editorId << "\n";
    return 0;
}

int blessHelper()
{
    auto result = AppHub::installPrivilegedHelper();
    if (!result.ok)
    {
        std::cout << "Bless helper: " << result.error << "\n";
        return 1;
    }

    std::cout << "Bless helper: ok\n";
    return 0;
}

bool directInstallFallbackEnabled()
{
    auto* value = std::getenv("EACP_APPHUB_DIRECT_INSTALL_FALLBACK");
    return value != nullptr && std::string_view(value) == "1";
}

int directInstallAppBundle(const fs::path& root,
                           const Updater::RemoteAppManifest& manifest,
                           const fs::path& artifactPath)
{
    auto result = AppHub::directInstallAppBundle(root, manifest, artifactPath);
    if (!result.ok)
    {
        std::cout << "Remote install: " << result.error << "\n";
        return 1;
    }

    return 0;
}

int remoteInstall(const fs::path& root, const std::string& manifestUrl)
{
    auto effectiveManifestUrl = manifestUrl.empty()
                                    ? std::string(defaultDemoManifestUrl)
                                    : manifestUrl;

    auto downloads = remoteDownloadRoot(root);
    auto manifestPath = downloads / "manifest.json";
    auto artifactPath = downloads / "artifact.app.zip";

    std::error_code ec;
    fs::create_directories(downloads, ec);
    if (ec)
    {
        std::cout << "Remote install: failed to create download directory\n";
        return 1;
    }

    std::cout << "Remote install: downloading manifest\n";
    auto rawManifest = downloadText(effectiveManifestUrl, manifestPath);
    if (rawManifest.empty())
    {
        std::cout << "Remote install: manifest download failed\n";
        return 1;
    }

    auto manifest = Updater::RemoteAppManifest();
    try
    {
        Miro::fromJSONString(manifest, rawManifest);
    }
    catch (...)
    {
        std::cout << "Remote install: invalid manifest\n";
        return 1;
    }

    if (!Updater::isValidProductId(manifest.productId)
        || !validBundleName(manifest.bundleName)
        || manifest.artifact.url.empty()
        || manifest.artifact.sha256.empty())
    {
        std::cout << "Remote install: manifest failed validation\n";
        return 1;
    }

    std::cout << "Remote install: downloading " << manifest.name << " "
              << manifest.version << "\n";
    auto response = HTTP::Request(manifest.artifact.url).downloadTo(
        artifactPath.string());
    if (response.statusCode < 200 || response.statusCode >= 300)
    {
        std::cout << "Remote install: artifact download failed\n";
        return 1;
    }

    auto actualHash = eacp::Crypto::sha256File(artifactPath.string());
    if (actualHash != manifest.artifact.sha256)
    {
        std::cout << "Remote install: artifact hash mismatch\n";
        return 1;
    }

    if (directInstallFallbackEnabled())
    {
        std::cout << "Remote install: using explicit direct install fallback\n";
        return directInstallAppBundle(root, manifest, artifactPath);
    }

    auto request = Updater::PrivilegedAppBundleInstallRequest();
    request.productId = manifest.productId;
    request.name = manifest.name;
    request.version = manifest.version;
    request.bundleName = manifest.bundleName;
    request.artifactPath = artifactPath.string();
    request.artifactSha256 = manifest.artifact.sha256;

    std::cout << "Remote install: requesting privileged install of "
              << manifest.bundleName << "\n";
    auto installResult = AppHub::installAppBundleWithPrivilegedHelper(request);
    if (!installResult.ok)
    {
        std::cout << "Remote install: privileged helper failed: "
                  << installResult.error << "\n";
        return 1;
    }

    std::cout << "Remote install: installed " << manifest.name << " "
              << manifest.version << "\n";

    return 0;
}

int updateDemoApp(const fs::path& root, const std::string& manifestUrl)
{
    auto effectiveManifestUrl = manifestUrl.empty()
                                    ? std::string(defaultDemoManifestUrl)
                                    : manifestUrl;
    return remoteInstall(root, effectiveManifestUrl);
}

int updateHubApp(const fs::path& root, const std::string& manifestUrl)
{
    auto effectiveManifestUrl = manifestUrl.empty()
                                    ? std::string(defaultHubManifestUrl)
                                    : manifestUrl;
    return remoteInstall(root, effectiveManifestUrl);
}

int launchDemoApp()
{
    if (!openBundle(AppHub::installedDemoAppBundlePath().string()))
    {
        std::cout << "Launch Demo App: failed\n";
        return 1;
    }

    std::cout << "Launch Demo App: ok\n";
    return 0;
}

int launchHubApp()
{
    if (!openBundle(AppHub::installedHubAppBundlePath().string()))
    {
        std::cout << "Launch AppHub: failed\n";
        return 1;
    }

    std::cout << "Launch AppHub: ok\n";
    return 0;
}

int checkRemoteUpdates(const fs::path& root)
{
    std::cout << updateStatusFor(root,
                                 defaultDemoManifestUrl,
                                 "demo-manifest",
                                 AppHub::installedDemoAppExecutablePath()
                                     .string(),
                                 "Demo App")
              << "\n";
    std::cout << updateStatusFor(root,
                                 defaultHubManifestUrl,
                                 "hub-manifest",
                                 AppHub::installedHubAppExecutablePath().string(),
                                 "AppHub")
              << "\n";
    return 0;
}

int openProduct(const fs::path& root, const std::string& productId)
{
    auto helper = makeHelper(root);
    auto* receipt = Updater::findReceipt(helper.receipts(), productId);
    if (receipt == nullptr)
    {
        std::cout << "Open " << productId << ": not installed\n";
        return 1;
    }

    auto installPath = fs::path(receipt->installPath);
    if (installPath.extension() == ".app" || fs::is_directory(installPath))
    {
        auto launched = AppHub::openAppBundle(installPath.string());
        if (!launched.ok)
        {
            std::cout << "Open " << productId << ": " << launched.error << "\n";
            return 1;
        }
    }

    writeFile(runningPath(root, productId), "running");
    std::cout << "Open " << productId << ": ok\n";
    return 0;
}

int closeProduct(const fs::path& root, const std::string& productId)
{
    auto ec = std::error_code();
    fs::remove(runningPath(root, productId), ec);
    if (ec)
    {
        std::cout << "Close " << productId << ": " << ec.message() << "\n";
        return 1;
    }

    std::cout << "Close " << productId << ": ok\n";
    return 0;
}

int removeProduct(const fs::path& root, const std::string& productId)
{
    auto helper = makeHelper(root);
    return printResult("Remove " + productId,
                       helper.submit(Updater::planRemove(productId)));
}

int runDemo(const fs::path& root)
{
    auto status = resetRoot(root);
    if (status != 0)
        return status;

    status = installProduct(root, stringFrom(editorId));
    if (status != 0)
        return status;

    status = installProduct(root, stringFrom(captureId));
    if (status != 0)
        return status;

    status = publishUpdate(root);
    if (status != 0)
        return status;

    status = updateAll(root);
    if (status != 0)
        return status;

    status = removeProduct(root, stringFrom(captureId));
    if (status != 0)
        return status;

    auto helper = makeHelper(root);
    printReceipts(helper.receipts());
    std::cout << "Demo complete. All writes were constrained to the mock helper root.\n";
    return 0;
}

int showList(const fs::path& root)
{
    auto catalog = loadOrCreateCatalog(root);
    auto helper = makeHelper(root);
    printStatus(root, catalog, helper.receipts());
    return 0;
}

int showReceipts(const fs::path& root)
{
    auto helper = makeHelper(root);
    std::cout << "Root: " << root << "\n";
    printReceipts(helper.receipts());
    return 0;
}

int runTui(const fs::path& root)
{
    loadOrCreateCatalog(root);

    while (true)
    {
        std::cout << "\nAppHub mock updater\n"
                  << "Root: " << root << "\n"
                  << "1. List products\n"
                  << "2. Install Example Editor\n"
                  << "3. Install Example Capture\n"
                  << "4. Update all\n"
                  << "5. Open Example Editor\n"
                  << "6. Close Example Editor\n"
                  << "7. Publish update\n"
                  << "8. Remove Example Editor\n"
                  << "9. Remove Example Capture\n"
                  << "10. Show receipts\n"
                  << "11. Reset\n"
                  << "12. Quit\n"
                  << "> ";

        auto choice = std::string();
        if (!std::getline(std::cin, choice))
            return 0;

        if (choice == "1")
            showList(root);
        else if (choice == "2")
            installProduct(root, stringFrom(editorId));
        else if (choice == "3")
            installProduct(root, stringFrom(captureId));
        else if (choice == "4")
            updateAll(root);
        else if (choice == "5")
            openProduct(root, stringFrom(editorId));
        else if (choice == "6")
            closeProduct(root, stringFrom(editorId));
        else if (choice == "7")
            publishUpdate(root);
        else if (choice == "8")
            removeProduct(root, stringFrom(editorId));
        else if (choice == "9")
            removeProduct(root, stringFrom(captureId));
        else if (choice == "10")
            showReceipts(root);
        else if (choice == "11")
            resetRoot(root);
        else if (choice == "12" || choice == "q" || choice == "quit")
            return 0;
        else
            std::cout << "Unknown choice\n";
    }
}

Graphics::Image makeTrayIcon()
{
    constexpr auto size = 36;
    auto image = Graphics::Image(size, size);
    auto center = (size - 1) / 2.f;

    for (auto y = 0; y < size; ++y)
    {
        for (auto x = 0; x < size; ++x)
        {
            auto dx = (static_cast<float>(x) - center) / center;
            auto dy = (static_cast<float>(y) - center) / center;
            auto radius = std::sqrt(dx * dx + dy * dy);
            auto alpha = std::clamp(1.12f - radius, 0.f, 1.f);
            if (alpha <= 0.f)
                continue;

            image.set(x, y, Graphics::Color(0.18f, 0.66f, 0.58f, alpha));
        }
    }

    return image;
}

struct HubPanelView final : Graphics::View
{
    HubPanelView()
    {
        background->setFillColor({0.09f, 0.10f, 0.11f});
        title->setColor({0.94f, 0.96f, 0.96f});
        version->setColor({0.64f, 0.72f, 0.74f});
        demoStatus->setColor({0.53f, 0.82f, 0.76f});
        hubStatus->setColor({0.53f, 0.82f, 0.76f});
        feed->setColor({0.45f, 0.49f, 0.52f});

        version->setText("Hub version: " EACP_APPHUB_VERSION);
        demoStatus->setText("Demo App: choose Check for Updates");
        hubStatus->setText("AppHub: choose Check for Updates");
        feed->setText("Default feeds: GitHub remote-demo-v1");

        addChildren({background, title, version, demoStatus, hubStatus, feed});
    }

    void setStatuses(const std::string& demo, const std::string& hub)
    {
        demoStatus->setText(demo);
        hubStatus->setText(hub);
        repaint();
    }

    void setWorking(const std::string& message)
    {
        demoStatus->setText(message);
        repaint();
    }

    void resized() override
    {
        auto bounds = getLocalBounds();

        auto path = Graphics::Path();
        path.addRect(bounds);
        background->setPath(path);

        scaleToFit({background, title, version, demoStatus, hubStatus, feed});
        title->setPosition({20.f, bounds.h - 42.f});
        version->setPosition({20.f, bounds.h - 74.f});
        demoStatus->setPosition({20.f, bounds.h - 112.f});
        hubStatus->setPosition({20.f, bounds.h - 144.f});
        feed->setPosition({20.f, 24.f});
    }

    Graphics::ShapeLayerView background;
    Graphics::TextLayerView title {"Tamber AppHub"};
    Graphics::TextLayerView version;
    Graphics::TextLayerView demoStatus;
    Graphics::TextLayerView hubStatus;
    Graphics::TextLayerView feed;
};

struct AppHubGui
{
    AppHubGui()
    {
        eacp::Apps::setDockIconVisible(false);

        window.setContentView(panel);
        window.setVisible(false);

        tray.setIcon(makeTrayIcon());
        tray.setTooltip("Tamber AppHub");
        tray.setMenu(createMenu());
        tray.setOnClick([this] { togglePanel(); });
    }

    static Graphics::WindowOptions panelOptions()
    {
        auto options = Graphics::WindowOptions();
        options.title = "Tamber AppHub";
        options.width = 380;
        options.height = 210;
        options.isPrimary = false;
        options.flags = {Graphics::WindowFlags::Borderless};
        options.cornerRadius = 10.f;
        options.alwaysOnTop = true;
        options.visibleOnAllWorkspaces = true;
        options.showInactive = true;
        return options;
    }

    Graphics::Menu createMenu()
    {
        auto menu = Graphics::Menu();
        menu.add(Graphics::MenuItem::withAction("Show AppHub", [this] {
            togglePanel();
        }));
        menu.add(Graphics::MenuItem::withAction("Check for Updates", [this] {
            checkForUpdates();
        }));
        menu.addSeparator();
        menu.add(Graphics::MenuItem::withAction("Install / Update Demo App", [this] {
            panel.setWorking("Installing Demo App...");
            auto status = updateDemoApp(root, {});
            panel.setWorking(status == 0 ? "Demo App install/update finished"
                                         : "Demo App install/update failed");
        }));
        menu.add(Graphics::MenuItem::withAction("Launch Demo App", [] {
            launchDemoApp();
        }));
        menu.addSeparator();
        menu.add(Graphics::MenuItem::withAction("Update AppHub", [this] {
            panel.setWorking("Updating AppHub...");
            auto status = updateHubApp(root, {});
            panel.setWorking(status == 0 ? "AppHub update finished"
                                         : "AppHub update failed");
        }));
        menu.add(Graphics::MenuItem::withAction("Install Privileged Helper", [] {
            blessHelper();
        }));
        menu.addSeparator();
        menu.add(Graphics::MenuItem::withAction("Quit", [] { eacp::Apps::quit(); }));
        return menu;
    }

    void togglePanel() { window.setVisible(!window.isVisible()); }

    void checkForUpdates()
    {
        panel.setStatuses(
            updateStatusFor(root,
                            defaultDemoManifestUrl,
                            "demo-manifest",
                            AppHub::installedDemoAppExecutablePath().string(),
                            "Demo App"),
            updateStatusFor(root,
                            defaultHubManifestUrl,
                            "hub-manifest",
                            AppHub::installedHubAppExecutablePath().string(),
                            "AppHub"));
        window.setVisible(true);
    }

    fs::path root = guiStateRoot();
    HubPanelView panel;
    Graphics::Window window {panelOptions()};
    Graphics::TrayIcon tray;
};
} // namespace

int main(int argc, char* argv[])
{
    auto parsed = parseArgs(argc, argv);
    if (!parsed)
    {
        printUsage();
        return 2;
    }

    const auto& options = *parsed;
    const auto& command = options.command;

    if (command == "help")
    {
        printUsage();
        return 0;
    }
    if (command == "version")
    {
        std::cout << EACP_APPHUB_VERSION << "\n";
        return 0;
    }
    if (command == "gui")
    {
        guiStateRoot() = options.root;
        eacp::Apps::run<AppHubUI::AppHubWebApp>(argc, argv);
        return 0;
    }
    if (command == "tui")
        return runTui(options.root);
    if (command == "demo")
        return runDemo(options.root);
    if (command == "reset")
        return resetRoot(options.root);
    if (command == "list")
        return showList(options.root);
    if (command == "status")
        return showReceipts(options.root);
    if (command == "install")
    {
        if (options.productId.empty())
        {
            std::cout << "install requires a product id\n";
            return 2;
        }
        return installProduct(options.root, options.productId);
    }
    if (command == "catalog-install")
    {
        if (options.productId.empty())
        {
            std::cout << "catalog-install requires a product id\n";
            return 2;
        }
        auto api = Api::AppHubApi(options.root);
        auto result = api.installProduct({.productId = options.productId});
        std::cout << result.message << "\n";
        return result.ok ? 0 : 1;
    }
    if (command == "catalog-update")
    {
        if (options.productId.empty())
        {
            std::cout << "catalog-update requires a product id\n";
            return 2;
        }
        auto api = Api::AppHubApi(options.root);
        auto result = api.updateProduct({.productId = options.productId});
        std::cout << result.message << "\n";
        return result.ok ? 0 : 1;
    }
    if (command == "open")
    {
        if (options.productId.empty())
        {
            std::cout << "open requires a product id\n";
            return 2;
        }
        return openProduct(options.root, options.productId);
    }
    if (command == "catalog-open")
    {
        if (options.productId.empty())
        {
            std::cout << "catalog-open requires a product id\n";
            return 2;
        }
        auto api = Api::AppHubApi(options.root);
        auto result = api.openProduct({.productId = options.productId});
        std::cout << result.message << "\n";
        return result.ok ? 0 : 1;
    }
    if (command == "close")
    {
        if (options.productId.empty())
        {
            std::cout << "close requires a product id\n";
            return 2;
        }
        return closeProduct(options.root, options.productId);
    }
    if (command == "publish-update")
        return publishUpdate(options.root);
    if (command == "bless-helper")
        return blessHelper();
    if (command == "remote-install")
        return remoteInstall(options.root, options.manifestUrl);
    if (command == "update-demo")
        return updateDemoApp(options.root, options.manifestUrl);
    if (command == "update-hub")
        return updateHubApp(options.root, options.manifestUrl);
    if (command == "launch-demo")
        return launchDemoApp();
    if (command == "launch-hub")
        return launchHubApp();
    if (command == "check-updates")
        return checkRemoteUpdates(options.root);
    if (command == "update")
    {
        if (!options.productId.empty())
        {
            auto api = Api::AppHubApi(options.root);
            auto result = api.updateProduct({.productId = options.productId});
            std::cout << result.message << "\n";
            return result.ok ? 0 : 1;
        }
        return updateAll(options.root);
    }
    if (command == "remove")
    {
        if (options.productId.empty())
        {
            std::cout << "remove requires a product id\n";
            return 2;
        }
        return removeProduct(options.root, options.productId);
    }

    printUsage();
    return 2;
}
