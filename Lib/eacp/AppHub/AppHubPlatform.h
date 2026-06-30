#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

#include <eacp/Updater/Updater.h>

namespace AppHub
{
using Path = std::filesystem::path;

eacp::Updater::Target currentTarget();
Path defaultStateRoot();
Path installedApplicationsRoot();
Path installedAppBundlePath(std::string_view bundleName);
Path installedDemoAppBundlePath();
Path installedDemoAppExecutablePath();
Path installedHubAppBundlePath();
Path installedHubAppExecutablePath();
std::optional<std::filesystem::path> currentExecutablePath();
bool createAppBundleZip(const std::filesystem::path& bundle,
                        const std::filesystem::path& output);
bool isAppBundleRunning(std::string_view appPath);

struct LaunchResult
{
    bool ok = false;
    std::string error;
};

using PlatformResult = LaunchResult;

LaunchResult openAppBundle(std::string_view appPath);
LaunchResult openNewAppBundleInstance(std::string_view appPath);
LaunchResult closeAppBundle(std::string_view appPath);
PlatformResult directInstallAppBundle(
    const std::filesystem::path& root,
    const eacp::Updater::RemoteAppManifest& manifest,
    const std::filesystem::path& artifactPath);

} // namespace AppHub
