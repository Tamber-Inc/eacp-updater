#include "AppHubPlatform.h"

#if defined(_WIN32)
#include <windows.h>

#include <array>
#include <cstdlib>
#endif

namespace AppHub
{
namespace fs = std::filesystem;

fs::path defaultStateRoot()
{
#if defined(_WIN32)
    if (auto* data = std::getenv("ProgramData"))
        return fs::path(data) / "Tamber" / "AppHub";
    return fs::temp_directory_path() / "Tamber" / "AppHub";
#else
    return fs::temp_directory_path() / "Tamber" / "AppHub";
#endif
}

eacp::Updater::Target currentTarget()
{
    auto target = eacp::Updater::Target();
    target.platform = eacp::Updater::Platform::Windows;
    target.architecture = eacp::Updater::Architecture::X64;
    return target;
}

fs::path installedApplicationsRoot()
{
#if defined(_WIN32)
    if (auto* programFiles = std::getenv("ProgramFiles"))
        return fs::path(programFiles);
#endif
    return fs::temp_directory_path() / "Applications";
}

fs::path installedAppBundlePath(std::string_view bundleName)
{
    return installedApplicationsRoot() / std::string(bundleName);
}

fs::path installedDemoAppBundlePath()
{
    return installedAppBundlePath("Tamber Hello World Demo");
}

fs::path installedDemoAppExecutablePath()
{
    return installedDemoAppBundlePath() / "Tamber Hello World Demo.exe";
}

fs::path installedHubAppBundlePath()
{
    return installedAppBundlePath("AppHub");
}

fs::path installedHubAppExecutablePath()
{
    return installedHubAppBundlePath() / "AppHub.exe";
}

std::optional<fs::path> currentExecutablePath()
{
#if defined(_WIN32)
    auto buffer = std::array<wchar_t, MAX_PATH> {};
    auto size = GetModuleFileNameW(nullptr,
                                   buffer.data(),
                                   static_cast<DWORD>(buffer.size()));
    if (size == 0 || size >= buffer.size())
        return std::nullopt;
    std::error_code ec;
    return fs::weakly_canonical(fs::path(buffer.data()), ec);
#else
    return std::nullopt;
#endif
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

LaunchResult openAppBundle(std::string_view appPath)
{
#if defined(_WIN32)
    auto path = fs::path(std::string(appPath));
    auto instance = ShellExecuteW(nullptr,
                                  L"open",
                                  path.wstring().c_str(),
                                  nullptr,
                                  nullptr,
                                  SW_SHOWNORMAL);
    if (reinterpret_cast<std::intptr_t>(instance) > 32)
        return {.ok = true};
    return {.ok = false, .error = "ShellExecuteW failed"};
#else
    return {.ok = false, .error = "app launching is not implemented"};
#endif
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
            .error = "direct install fallback is not implemented on Windows"};
}

} // namespace AppHub
