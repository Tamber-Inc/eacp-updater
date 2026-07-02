#include "AppHubPlatform.h"

namespace AppHub
{
namespace fs = std::filesystem;

fs::path defaultStateRoot()
{
    return fs::temp_directory_path() / "Tamber" / "AppHub";
}

eacp::Updater::Target currentTarget()
{
    auto target = eacp::Updater::Target();
    target.platform = eacp::Updater::Platform::Linux;
    target.architecture = eacp::Updater::Architecture::X64;
    return target;
}

fs::path installedApplicationsRoot()
{
    return fs::temp_directory_path() / "Applications";
}

fs::path installedAppBundlePath(std::string_view bundleName)
{
    return installedApplicationsRoot() / std::string(bundleName);
}

fs::path installedDemoAppBundlePath()
{
    return installedAppBundlePath("Tamber Local Update Demo");
}

fs::path installedDemoAppExecutablePath()
{
    return installedDemoAppBundlePath() / "Tamber Local Update Demo";
}

fs::path installedHubAppBundlePath()
{
    return installedAppBundlePath("AppHub");
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

bool isAppBundleRunning(std::string_view)
{
    return false;
}

LaunchResult closeAppBundle(std::string_view)
{
    return {.ok = true};
}

LaunchResult openAppBundle(std::string_view)
{
    return {.ok = false, .error = "app launching is not implemented"};
}

LaunchResult openNewAppBundleInstance(std::string_view appPath)
{
    return openAppBundle(appPath);
}

PlatformResult directInstallAppBundle(const fs::path&,
                                      const eacp::Updater::RemoteAppManifest&,
                                      const fs::path&)
{
    return {.ok = false,
            .error = "direct install is not implemented on this platform"};
}

} // namespace AppHub
