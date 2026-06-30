#include "AppHubApi.h"

#include <eacp/AppHub/LaunchGuardIpc.h>

#include <NanoTest/NanoTest.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

using namespace nano;
namespace fs = std::filesystem;
namespace Updater = eacp::Updater;
namespace LaunchGuard = eacp::AppHub;

namespace
{
struct LaunchProbe
{
    bool shouldLaunch = false;
    bool shouldClose = true;
    std::string launchedPath;
    std::string closedPath;
};

struct HelperProbe
{
    int helperInstallCalls = 0;
    int appInstallCalls = 0;
    int appInstallFailuresBeforeSuccess = 0;
    bool helperInstallSucceeds = false;
    Updater::PrivilegedAppBundleInstallRequest lastInstallRequest;
};

LaunchProbe& launchProbe()
{
    static auto probe = LaunchProbe();
    return probe;
}

HelperProbe& helperProbe()
{
    static auto probe = HelperProbe();
    return probe;
}

fs::path testRoot(const std::string& name)
{
    auto root = fs::temp_directory_path() / ("eacp-apphub-tests-" + name);
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

Updater::Product makeAppProduct()
{
    auto product = Updater::Product();
    product.id = "com.eacp.maze";
    product.name = "Maze";
    product.kind = Updater::PackageKind::App;
    product.bundleName = "Maze.app";
    product.channel = "stable";
    product.latestVersion = "1.0.0";
    return product;
}

void writeCatalog(const fs::path& root)
{
    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = 1;
    catalog.signature = "test";
    catalog.products.add(makeAppProduct());
    writeFile(root / "catalog.json", Updater::catalogToJson(catalog));
}

void writeCatalogAt(const fs::path& path, const Updater::ProductCatalog& catalog)
{
    writeFile(path, Updater::catalogToJson(catalog));
}

void writeReceipt(const fs::path& root, const std::string& installPath)
{
    auto receipt = Updater::ProductReceipt();
    receipt.productId = "com.eacp.maze";
    receipt.name = "Maze";
    receipt.version = "1.0.0";
    receipt.installPath = installPath;
    receipt.channel = "stable";
    receipt.artifactSha256 = "test";
    receipt.installedAt = "2026-06-29T00:00:00Z";

    auto options = Updater::MockHelperOptions();
    options.root = root.string();
    options.stagingRoot = (root / "staging").string();
    auto helper = Updater::MockPrivilegedHelper(options);
    writeFile(fs::path(helper.receiptsRoot()) / "com.eacp.maze.json",
              Updater::receiptToJson(receipt));
}

void writeReceiptFor(const fs::path& root,
                     const std::string& productId,
                     const std::string& name,
                     const std::string& version,
                     const std::string& installPath,
                     const std::string& artifactSha256)
{
    auto receipt = Updater::ProductReceipt();
    receipt.productId = productId;
    receipt.name = name;
    receipt.version = version;
    receipt.installPath = installPath;
    receipt.channel = "stable";
    receipt.artifactSha256 = artifactSha256;
    receipt.installedAt = "2026-06-29T00:00:00Z";

    auto options = Updater::MockHelperOptions();
    options.root = root.string();
    options.stagingRoot = (root / "staging").string();
    auto helper = Updater::MockPrivilegedHelper(options);
    writeFile(fs::path(helper.receiptsRoot()) / (productId + ".json"),
              Updater::receiptToJson(receipt));
}

class ScopedEnvironmentVariable
{
public:
    ScopedEnvironmentVariable(const std::string& name, const std::string& value)
        : name_(name)
    {
#if defined(_WIN32)
        _putenv_s(name_.c_str(), value.c_str());
#else
        ::setenv(name_.c_str(), value.c_str(), 1);
#endif
    }

    ~ScopedEnvironmentVariable()
    {
#if defined(_WIN32)
        _putenv_s(name_.c_str(), "");
#else
        ::unsetenv(name_.c_str());
#endif
    }

    ScopedEnvironmentVariable(const ScopedEnvironmentVariable&) = delete;
    ScopedEnvironmentVariable& operator=(const ScopedEnvironmentVariable&) = delete;

private:
    std::string name_;
};

class RecordingLaunchGuardTransport final
    : public LaunchGuard::LaunchGuardIpcTransport
{
public:
    explicit RecordingLaunchGuardTransport(
        LaunchGuard::LaunchGuardIpcExchange response)
        : response_(std::move(response))
    {
    }

    LaunchGuard::LaunchGuardIpcExchange exchange(
        std::string_view payload) override
    {
        payload_ = std::string(payload);
        return response_;
    }

    std::string payload() const { return payload_; }

private:
    LaunchGuard::LaunchGuardIpcExchange response_;
    std::string payload_;
};
} // namespace

namespace AppHub
{
fs::path defaultStateRoot()
{
    return testRoot("default-state");
}

Updater::Target currentTarget()
{
    auto target = Updater::Target();
    target.platform = Updater::Platform::MacOS;
    target.architecture = Updater::Architecture::Universal;
    return target;
}

fs::path installedApplicationsRoot()
{
    return fs::temp_directory_path() / "eacp-apphub-tests-applications";
}

fs::path installedAppBundlePath(std::string_view bundleName)
{
    return installedApplicationsRoot() / std::string(bundleName);
}

fs::path installedDemoAppBundlePath()
{
    return installedAppBundlePath("Demo.app");
}

fs::path installedDemoAppExecutablePath()
{
    return installedDemoAppBundlePath() / "Demo";
}

fs::path installedHubAppBundlePath()
{
    return installedAppBundlePath("AppHub.app");
}

fs::path installedHubAppExecutablePath()
{
    return installedHubAppBundlePath() / "AppHub";
}

std::optional<fs::path> currentExecutablePath()
{
    return std::nullopt;
}

bool createAppBundleZip(const fs::path&, const fs::path&)
{
    return false;
}

bool isAppBundleRunning(std::string_view appPath)
{
    return launchProbe().shouldLaunch
        && launchProbe().launchedPath == std::string(appPath);
}

LaunchResult closeAppBundle(std::string_view appPath)
{
    launchProbe().closedPath = std::string(appPath);
    if (launchProbe().shouldClose)
    {
        launchProbe().shouldLaunch = false;
        return {.ok = true};
    }
    return {.ok = false, .error = "test close failed"};
}

LaunchResult openAppBundle(std::string_view appPath)
{
    launchProbe().launchedPath = std::string(appPath);
    if (launchProbe().shouldLaunch)
        return {.ok = true};
    return {.ok = false, .error = "test launch failed"};
}

LaunchResult openNewAppBundleInstance(std::string_view appPath)
{
    return openAppBundle(appPath);
}

PlatformResult directInstallAppBundle(const fs::path&,
                                      const Updater::RemoteAppManifest&,
                                      const fs::path&)
{
    return {.ok = false, .error = "not used"};
}

PrivilegedHelperInstallResult installPrivilegedHelper()
{
    auto& probe = helperProbe();
    ++probe.helperInstallCalls;
    if (probe.helperInstallSucceeds)
        return {.ok = true};
    return {.ok = false, .error = "helper repair failed"};
}

Updater::InstallResult installAppBundleWithPrivilegedHelper(
    const Updater::PrivilegedAppBundleInstallRequest& request)
{
    auto& probe = helperProbe();
    ++probe.appInstallCalls;
    probe.lastInstallRequest = request;
    if (probe.appInstallCalls <= probe.appInstallFailuresBeforeSuccess)
        return {.ok = false,
                .error = "privileged helper connection invalidated"};
    return {.ok = true};
}
} // namespace AppHub

auto tOpenProductDoesNotMarkRunningWhenLaunchFails =
    test("AppHub/openProductDoesNotMarkRunningWhenLaunchFails") = []
{
    auto root = testRoot("launch-fails");
    auto appPath = (root / "Installed" / "Maze.app").string();
    writeCatalog(root);
    writeReceipt(root, appPath);
    launchProbe() = {.shouldLaunch = false};

    auto api = Api::AppHubApi(root);
    auto result = api.openProduct({.productId = "com.eacp.maze"});

    check(!result.ok);
    check(result.message == "test launch failed");
    check(launchProbe().launchedPath == appPath);
    check(!fs::exists(root / "running" / "com.eacp.maze.running"));
};

auto tLaunchGuardRequestAndResultAreMiroStrings =
    test("AppHub/launchGuardRequestAndResultAreMiroStrings") = []
{
    auto request = LaunchGuard::LaunchCheckRequest();
    request.productId = "com.eacp.maze";
    request.version = "1.2.3";
    request.channel = "stable";
    request.bundlePath = "/Applications/Tamber Apps/Maze.app";
    request.openHubOnBlock = false;

    auto parsedRequest = LaunchGuard::launchCheckRequestFromString(
        LaunchGuard::launchCheckRequestToString(request));
    check(parsedRequest.productId == request.productId);
    check(parsedRequest.version == request.version);
    check(parsedRequest.channel == request.channel);
    check(parsedRequest.bundlePath == request.bundlePath);
    check(!parsedRequest.openHubOnBlock);

    auto result = LaunchGuard::LaunchCheckResult();
    result.decision = LaunchGuard::LaunchDecision::UpdateRequired;
    result.productId = request.productId;
    result.installedVersion = "1.2.3";
    result.latestVersion = "2.0.0";
    result.minimumLaunchVersion = "2.0.0";
    result.message = "Update required";
    result.hubDeepLink = "tamberhub://product/com.eacp.maze";
    result.hubOpened = true;

    auto parsedResult = LaunchGuard::launchCheckResultFromString(
        LaunchGuard::launchCheckResultToString(result));
    check(parsedResult.decision == result.decision);
    check(parsedResult.productId == result.productId);
    check(parsedResult.installedVersion == result.installedVersion);
    check(parsedResult.latestVersion == result.latestVersion);
    check(parsedResult.minimumLaunchVersion == result.minimumLaunchVersion);
    check(parsedResult.message == result.message);
    check(parsedResult.hubDeepLink == result.hubDeepLink);
    check(parsedResult.hubOpened);
};

auto tLaunchGuardHandlerConsumesMiroStringPayload =
    test("AppHub/launchGuardHandlerConsumesMiroStringPayload") = []
{
    auto request = LaunchGuard::LaunchCheckRequest();
    request.productId = "com.eacp.maze";
    request.version = "1.0.0";

    auto response = LaunchGuard::handleLaunchGuardIpcRequest(
        LaunchGuard::launchCheckRequestToString(request),
        [](const LaunchGuard::LaunchCheckRequest& parsed)
        {
            auto result = LaunchGuard::LaunchCheckResult();
            result.decision = LaunchGuard::LaunchDecision::UpdateAvailable;
            result.productId = parsed.productId;
            result.installedVersion = parsed.version;
            result.latestVersion = "1.1.0";
            result.message = "Update available";
            return result;
        });

    auto result = LaunchGuard::launchCheckResultFromString(response);
    check(result.decision == LaunchGuard::LaunchDecision::UpdateAvailable);
    check(result.productId == "com.eacp.maze");
    check(result.installedVersion == "1.0.0");
    check(result.latestVersion == "1.1.0");
};

auto tLaunchGuardHandlerReturnsBlockingResultForInvalidPayload =
    test("AppHub/launchGuardHandlerReturnsBlockingResultForInvalidPayload") = []
{
    auto response = LaunchGuard::handleLaunchGuardIpcRequest(
        "not json",
        [](const LaunchGuard::LaunchCheckRequest&)
        {
            auto result = LaunchGuard::LaunchCheckResult();
            result.decision = LaunchGuard::LaunchDecision::Allow;
            return result;
        });

    auto result = LaunchGuard::launchCheckResultFromString(response);
    check(result.decision == LaunchGuard::LaunchDecision::UnknownBlock);
    check(result.message == "invalid launch guard request");
};

auto tLaunchGuardClientUsesMiroStringTransport =
    test("AppHub/launchGuardClientUsesMiroStringTransport") = []
{
    auto response = LaunchGuard::LaunchCheckResult();
    response.decision = LaunchGuard::LaunchDecision::UpdateRequired;
    response.productId = "com.eacp.maze";
    response.minimumLaunchVersion = "3.0.0";
    response.message = "Update required";

    auto transport = RecordingLaunchGuardTransport(
        {.ok = true,
         .payload = LaunchGuard::launchCheckResultToString(response)});

    auto request = LaunchGuard::LaunchCheckRequest();
    request.productId = "com.eacp.maze";
    request.version = "2.0.0";
    auto result = LaunchGuard::checkLaunchOverIpc(transport, request);
    auto sent = LaunchGuard::launchCheckRequestFromString(transport.payload());

    check(sent.productId == "com.eacp.maze");
    check(sent.version == "2.0.0");
    check(result.decision == LaunchGuard::LaunchDecision::UpdateRequired);
    check(result.minimumLaunchVersion == "3.0.0");
};

auto tLaunchGuardClientFailsOpenOnTransportError =
    test("AppHub/launchGuardClientFailsOpenOnTransportError") = []
{
    auto transport = RecordingLaunchGuardTransport(
        {.ok = false, .error = "agent unavailable"});

    auto result = LaunchGuard::checkLaunchOverIpc(
        transport,
        {.productId = "com.eacp.maze", .version = "2.0.0"});

    check(result.decision == LaunchGuard::LaunchDecision::UnknownAllow);
    check(result.message == "agent unavailable");
};

auto tLaunchGuardFramesRoundTripAndSupportPartialReads =
    test("AppHub/launchGuardFramesRoundTripAndSupportPartialReads") = []
{
    auto frame = LaunchGuard::encodeLaunchGuardFrame("hello");
    check(frame.size() == 9);

    auto partial = LaunchGuard::decodeLaunchGuardFrame(
        std::string_view(frame.data(), 3));
    check(partial.status == LaunchGuard::LaunchGuardFrameStatus::NeedMoreData);

    partial = LaunchGuard::decodeLaunchGuardFrame(
        std::string_view(frame.data(), 6));
    check(partial.status == LaunchGuard::LaunchGuardFrameStatus::NeedMoreData);

    auto decoded = LaunchGuard::decodeLaunchGuardFrame(frame + "next");
    check(decoded.status == LaunchGuard::LaunchGuardFrameStatus::Ready);
    check(decoded.payload == "hello");
    check(decoded.bytesConsumed == frame.size());
};

auto tLaunchGuardFrameRejectsOversizedPayload =
    test("AppHub/launchGuardFrameRejectsOversizedPayload") = []
{
    auto frame = std::string();
    frame.push_back(static_cast<char>(0xff));
    frame.push_back(static_cast<char>(0xff));
    frame.push_back(static_cast<char>(0xff));
    frame.push_back(static_cast<char>(0xff));

    auto decoded = LaunchGuard::decodeLaunchGuardFrame(frame);
    check(decoded.status == LaunchGuard::LaunchGuardFrameStatus::Invalid);
    check(decoded.error == "launch guard payload is too large");
};

auto tOpenProductMarksRunningOnlyAfterLaunchSucceeds =
    test("AppHub/openProductMarksRunningOnlyAfterLaunchSucceeds") = []
{
    auto root = testRoot("launch-succeeds");
    auto appPath = (root / "Installed" / "Maze.app").string();
    writeCatalog(root);
    writeReceipt(root, appPath);
    launchProbe() = {.shouldLaunch = true};

    auto api = Api::AppHubApi(root);
    auto result = api.openProduct({.productId = "com.eacp.maze"});

    check(result.ok);
    check(launchProbe().launchedPath == appPath);
    check(fs::exists(root / "running" / "com.eacp.maze.running"));
};

auto tOpenProductFallsBackToCatalogBundleWhenReceiptIsMissing =
    test("AppHub/openProductFallsBackToCatalogBundleWhenReceiptIsMissing") = []
{
    auto root = testRoot("launch-catalog-fallback");
    writeCatalog(root);
    launchProbe() = {.shouldLaunch = true};

    auto api = Api::AppHubApi(root);
    auto result = api.openProduct({.productId = "com.eacp.maze"});

    check(result.ok);
    check(launchProbe().launchedPath
          == AppHub::installedAppBundlePath("Maze.app").string());
    check(fs::exists(root / "running" / "com.eacp.maze.running"));
};

auto tCloseProductTerminatesRunningApp =
    test("AppHub/closeProductTerminatesRunningApp") = []
{
    auto root = testRoot("close-running-app");
    auto appPath = (root / "Installed" / "Maze.app").string();
    writeCatalog(root);
    writeReceipt(root, appPath);
    writeFile(root / "running" / "com.eacp.maze.running", "running");
    launchProbe() = {.shouldLaunch = true, .shouldClose = true};
    launchProbe().launchedPath = appPath;

    auto api = Api::AppHubApi(root);
    auto result = api.closeProduct({.productId = "com.eacp.maze"});

    check(result.ok);
    check(launchProbe().closedPath == appPath);
    check(!fs::exists(root / "running" / "com.eacp.maze.running"));
    check(api.getHubState().operation.state == Api::HubOperationState::Succeeded);
};

auto tCloseProductKeepsMarkerWhenTerminateFails =
    test("AppHub/closeProductKeepsMarkerWhenTerminateFails") = []
{
    auto root = testRoot("close-running-app-fails");
    auto appPath = (root / "Installed" / "Maze.app").string();
    writeCatalog(root);
    writeReceipt(root, appPath);
    writeFile(root / "running" / "com.eacp.maze.running", "running");
    launchProbe() = {.shouldLaunch = true, .shouldClose = false};
    launchProbe().launchedPath = appPath;

    auto api = Api::AppHubApi(root);
    auto result = api.closeProduct({.productId = "com.eacp.maze"});

    check(!result.ok);
    check(result.message == "test close failed");
    check(launchProbe().closedPath == appPath);
    check(fs::exists(root / "running" / "com.eacp.maze.running"));
    check(api.getHubState().operation.state == Api::HubOperationState::Failed);
};

auto tInstallProductRepairsMissingPrivilegedHelper =
    test("AppHub/installProductRepairsMissingPrivilegedHelper") = []
{
    auto root = testRoot("install-repairs-helper");
    auto artifact = root / "artifacts" / "maze.app.zip";
    writeFile(artifact, "maze artifact");

    auto product = makeAppProduct();
    product.latestVersion = "9.9.7";

    auto productArtifact = Updater::ProductArtifact();
    productArtifact.platform = Updater::Platform::MacOS;
    productArtifact.architecture = Updater::Architecture::Universal;
    productArtifact.url = "file://" + artifact.string();
    productArtifact.sha256 = eacp::Crypto::sha256File(artifact.string());
    product.artifacts.add(productArtifact);

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = 2;
    catalog.signature = "test";
    catalog.products.add(product);
    writeCatalogAt(root / "catalog.json", catalog);

    helperProbe() = {};
    helperProbe().appInstallFailuresBeforeSuccess = 1;
    helperProbe().helperInstallSucceeds = true;

    auto api = Api::AppHubApi(root);
    auto result = api.installProduct({.productId = "com.eacp.maze"});
    auto state = api.getHubState();
    auto helper = Updater::MockPrivilegedHelper(
        Updater::MockHelperOptions {.root = root.string(),
                                    .stagingRoot = (root / "staging").string()});
    auto receipts = helper.receipts();
    auto* receipt = Updater::findReceipt(receipts, "com.eacp.maze");

    check(result.ok);
    check(helperProbe().appInstallCalls == 2);
    check(helperProbe().helperInstallCalls == 1);
    check(helperProbe().lastInstallRequest.bundleName == "Maze.app");
    check(state.helperState == Api::HubHelperState::Installed);
    check(receipt != nullptr);
    if (receipt != nullptr)
        check(receipt->version == "9.9.7");
};

auto tLoadsConfiguredManualCatalog =
    test("AppHub/loadsConfiguredManualCatalog") = []
{
    auto root = testRoot("configured-manual-catalog");
    auto catalogPath = root / "generated" / "apphub-catalog.json";

    auto product = Updater::Product();
    product.id = "com.eacp.webviewtodo";
    product.name = "WebView Todo";
    product.kind = Updater::PackageKind::App;
    product.bundleName = "WebView Todo.app";
    product.channel = "stable";
    product.latestVersion = "1.0.0";

    auto artifact = Updater::ProductArtifact();
    artifact.platform = Updater::Platform::MacOS;
    artifact.architecture = Updater::Architecture::Universal;
    artifact.url = "file:///tmp/webviewtodo.zip";
    artifact.sha256 = "test";
    product.artifacts.add(artifact);

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = 42;
    catalog.signature = "test";
    catalog.products.add(product);
    writeCatalogAt(catalogPath, catalog);

    auto catalogOverride = ScopedEnvironmentVariable(
        "EACP_APPHUB_MANUAL_CATALOG_PATH", catalogPath.string());
    auto api = Api::AppHubApi(root);
    auto state = api.getHubState();

    check(state.catalogVersion == 42);
    check(state.products.size() == 1);
    if (state.products.size() == 1)
    {
        check(state.products[0].id == "com.eacp.webviewtodo");
        check(state.products[0].name == "WebView Todo");
    }
};

auto tUpdateProductUpdatesOnlyRequestedInstalledProduct =
    test("AppHub/updateProductUpdatesRequestedInstalledProduct") = []
{
    auto root = testRoot("targeted-update-product");
    auto artifact = root / "artifacts" / "shared.clap.artifact";
    writeFile(artifact, "clap-v2");

    auto artifactHash = eacp::Crypto::sha256File(artifact.string());

    auto product = Updater::Product();
    product.id = "shared.clap";
    product.name = "CLAP Model";
    product.kind = Updater::PackageKind::Model;
    product.channel = "stable";
    product.latestVersion = "2.0.0";

    auto productArtifact = Updater::ProductArtifact();
    productArtifact.platform = Updater::Platform::Any;
    productArtifact.architecture = Updater::Architecture::Any;
    productArtifact.url = "file://" + artifact.string();
    productArtifact.sha256 = artifactHash;
    product.artifacts.add(productArtifact);

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = 2;
    catalog.signature = "test";
    catalog.products.add(product);
    writeCatalogAt(root / "catalog.json", catalog);

    writeReceiptFor(root,
                    "shared.clap",
                    "CLAP Model",
                    "1.0.0",
                    (root / "installed" / "shared.clap").string(),
                    "old-hash");
    writeFile(root / "running" / "shared.clap.running", "stale");

    auto api = Api::AppHubApi(root);
    auto result = api.updateProduct({.productId = "shared.clap"});
    auto helper = Updater::MockPrivilegedHelper(
        Updater::MockHelperOptions {.root = root.string(),
                                    .stagingRoot = (root / "staging").string()});
    auto receipts = helper.receipts();
    auto* receipt = Updater::findReceipt(receipts, "shared.clap");

    check(result.ok);
    check(!fs::exists(root / "running" / "shared.clap.running"));
    check(receipt != nullptr);
    if (receipt != nullptr)
    {
        check(receipt->version == "2.0.0");
        check(receipt->artifactSha256 == artifactHash);
    }
};

auto tUpdateProductClearsStaleAppRunningMarker =
    test("AppHub/updateProductClearsStaleAppRunningMarker") = []
{
    auto root = testRoot("stale-app-running-marker");
    auto artifact = root / "artifacts" / "maze.app.zip";
    writeFile(artifact, "maze-v2");

    auto artifactHash = eacp::Crypto::sha256File(artifact.string());

    auto product = makeAppProduct();
    product.latestVersion = "2.0.0";
    auto productArtifact = Updater::ProductArtifact();
    productArtifact.platform = Updater::Platform::MacOS;
    productArtifact.architecture = Updater::Architecture::Universal;
    productArtifact.url = "file://" + artifact.string();
    productArtifact.sha256 = artifactHash;
    product.artifacts.add(productArtifact);

    auto catalog = Updater::ProductCatalog();
    catalog.catalogVersion = 2;
    catalog.signature = "test";
    catalog.products.add(product);
    writeCatalogAt(root / "catalog.json", catalog);

    auto appPath = (root / "Installed" / "Maze.app").string();
    writeReceipt(root, appPath);
    writeFile(root / "running" / "com.eacp.maze.running", "stale");

    launchProbe() = {};
    helperProbe() = {};
    auto api = Api::AppHubApi(root);
    auto result = api.updateProduct({.productId = "com.eacp.maze"});
    auto helper = Updater::MockPrivilegedHelper(
        Updater::MockHelperOptions {.root = root.string(),
                                    .stagingRoot = (root / "staging").string()});
    auto receipts = helper.receipts();
    auto* receipt = Updater::findReceipt(receipts, "com.eacp.maze");

    check(result.ok);
    check(!fs::exists(root / "running" / "com.eacp.maze.running"));
    check(receipt != nullptr);
    if (receipt != nullptr)
        check(receipt->version == "2.0.0");
};

auto tSetChannelPersistsSelectedChannel =
    test("AppHub/setChannelPersistsSelectedChannel") = []
{
    auto root = testRoot("set-channel");
    writeCatalog(root);
    writeFile(eacp::Hub::cachedChannelIndexPath(root),
              R"({"defaultChannel":"stable","channels":[{"id":"stable","name":"Stable","catalogUrl":"https://example.test/channels/stable/apphub-catalog.json","isDefault":true},{"id":"jp/feat/some-random-branch","name":"JP Branch","catalogUrl":"https://example.test/channels/jp-feat-some-random-branch/apphub-catalog.json"}]})");
    auto indexOverride = ScopedEnvironmentVariable("EACP_APPHUB_CHANNEL_INDEX_URL",
                                                   "");

    auto api = Api::AppHubApi(root);
    auto result = api.setChannel({.channel = "jp/feat/some-random-branch"});
    auto state = api.getHubState();

    check(result.ok);
    check(state.channel == "jp/feat/some-random-branch");
    check(state.channels.size() == 2);
    check(state.catalogUrl
          == "https://example.test/channels/"
             "jp-feat-some-random-branch/apphub-catalog.json");

    auto reloaded = Api::AppHubApi(root);
    check(reloaded.getHubState().channel == "jp/feat/some-random-branch");
};
