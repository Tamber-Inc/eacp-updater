#include "AppHubPlatform.h"

#include <eacp/Core/Utils/Environment.h>
#include <eacp/Core/Utils/WinInclude.h>

#include <shellapi.h>
#include <tlhelp32.h>

#include <chrono>
#include <cwctype>
#include <thread>
#include <vector>

namespace AppHub
{
namespace fs = std::filesystem;

fs::path defaultStateRoot()
{
    // Per-user state to match the per-user install root below.
    auto localAppData = eacp::getEnvValue("LOCALAPPDATA");
    if (!localAppData.empty())
        return fs::path(localAppData) / "Tamber" / "AppHub";
    return fs::temp_directory_path() / "Tamber" / "AppHub";
}

eacp::Updater::Target currentTarget()
{
    auto target = eacp::Updater::Target();
    target.platform = eacp::Updater::Platform::Windows;
    target.architecture = eacp::Updater::Architecture::X64;

    auto processMachine = USHORT {};
    auto nativeMachine = USHORT {};
    if (IsWow64Process2(GetCurrentProcess(), &processMachine, &nativeMachine)
        && nativeMachine == IMAGE_FILE_MACHINE_ARM64)
        target.architecture = eacp::Updater::Architecture::Arm64;

    return target;
}

fs::path installedApplicationsRoot()
{
    // Per-user application root, writable without elevation — the
    // convention of user-scope installers (%LOCALAPPDATA%\Programs).
    auto localAppData = eacp::getEnvValue("LOCALAPPDATA");
    if (!localAppData.empty())
        return fs::path(localAppData) / "Programs";
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
    return installedDemoAppBundlePath() / "Tamber Local Update Demo.exe";
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
    auto buffer = std::vector<wchar_t>(32768);
    auto size = GetModuleFileNameW(nullptr,
                                   buffer.data(),
                                   static_cast<DWORD>(buffer.size()));
    if (size == 0 || size >= buffer.size())
        return std::nullopt;

    std::error_code ec;
    return fs::weakly_canonical(fs::path(buffer.data()), ec);
}

namespace
{
std::wstring toLowerCopy(std::wstring value)
{
    for (auto& c: value)
        c = static_cast<wchar_t>(std::towlower(c));
    return value;
}

// An app "bundle" on Windows is a directory named after the app holding
// <name>.exe.
fs::path bundleExecutablePath(const fs::path& bundle)
{
    return bundle / (bundle.filename().string() + ".exe");
}

std::vector<DWORD> processIdsUnder(const fs::path& bundle)
{
    auto result = std::vector<DWORD>();

    std::error_code ec;
    auto canonical = fs::weakly_canonical(bundle, ec);
    if (ec || canonical.empty())
        return result;
    auto prefix = toLowerCopy(canonical.wstring() + L"\\");

    auto* snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE)
        return result;

    auto entry = PROCESSENTRY32W {};
    entry.dwSize = sizeof(entry);
    for (auto more = Process32FirstW(snapshot, &entry); more;
         more = Process32NextW(snapshot, &entry))
    {
        auto* process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,
                                    FALSE,
                                    entry.th32ProcessID);
        if (process == nullptr)
            continue;

        auto buffer = std::vector<wchar_t>(32768);
        auto size = static_cast<DWORD>(buffer.size());
        if (QueryFullProcessImageNameW(process, 0, buffer.data(), &size))
        {
            auto imagePath = toLowerCopy(std::wstring(buffer.data(), size));
            if (imagePath.rfind(prefix, 0) == 0)
                result.push_back(entry.th32ProcessID);
        }

        CloseHandle(process);
    }

    CloseHandle(snapshot);
    return result;
}

struct CloseRequest
{
    const std::vector<DWORD>* processIds = nullptr;
};

BOOL CALLBACK postCloseToWindow(HWND window, LPARAM parameter)
{
    const auto& request = *reinterpret_cast<CloseRequest*>(parameter);

    auto windowProcessId = DWORD {};
    GetWindowThreadProcessId(window, &windowProcessId);

    for (auto processId: *request.processIds)
    {
        if (processId == windowProcessId)
        {
            PostMessageW(window, WM_CLOSE, 0, 0);
            break;
        }
    }

    return TRUE;
}

bool moveDirectoryEntries(const fs::path& from, const fs::path& to)
{
    std::error_code ec;
    fs::create_directories(to, ec);
    if (ec)
        return false;

    for (const auto& entry: fs::directory_iterator(from, ec))
    {
        auto destination = to / entry.path().filename();
        auto moveEc = std::error_code();
        fs::rename(entry.path(), destination, moveEc);
        if (!moveEc)
            continue;

        auto copyEc = std::error_code();
        fs::copy(entry.path(),
                 destination,
                 fs::copy_options::recursive
                     | fs::copy_options::overwrite_existing,
                 copyEc);
        if (copyEc)
            return false;
        fs::remove_all(entry.path(), copyEc);
    }

    return !ec;
}
} // namespace

bool createAppBundleZip(const fs::path& bundle, const fs::path& output)
{
    return eacp::Updater::createZipArchive(bundle, output);
}

bool isAppBundleRunning(std::string_view appPath)
{
    return !processIdsUnder(fs::path(std::string(appPath))).empty();
}

LaunchResult closeAppBundle(std::string_view appPath)
{
    auto bundle = fs::path(std::string(appPath));
    auto processIds = processIdsUnder(bundle);
    if (processIds.empty())
        return {.ok = true};

    auto request = CloseRequest {&processIds};
    EnumWindows(postCloseToWindow, reinterpret_cast<LPARAM>(&request));

    constexpr auto attempts = 100;
    for (auto attempt = 0; attempt < attempts; ++attempt)
    {
        if (processIdsUnder(bundle).empty())
            return {.ok = true};
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    for (auto processId: processIdsUnder(bundle))
    {
        auto* process = OpenProcess(PROCESS_TERMINATE, FALSE, processId);
        if (process == nullptr)
            continue;
        TerminateProcess(process, 1);
        CloseHandle(process);
    }

    if (processIdsUnder(bundle).empty())
        return {.ok = true};
    return {.ok = false, .error = "Timed out closing app"};
}

LaunchResult openAppBundle(std::string_view appPath)
{
    auto path = fs::path(std::string(appPath));

    std::error_code ec;
    if (fs::is_directory(path, ec))
        path = bundleExecutablePath(path);

    auto instance = ShellExecuteW(nullptr,
                                  L"open",
                                  path.wstring().c_str(),
                                  nullptr,
                                  nullptr,
                                  SW_SHOWNORMAL);
    if (reinterpret_cast<std::intptr_t>(instance) > 32)
        return {.ok = true};
    return {.ok = false, .error = "ShellExecuteW failed"};
}

LaunchResult openNewAppBundleInstance(std::string_view appPath)
{
    return openAppBundle(appPath);
}

PlatformResult directInstallAppBundle(
    const fs::path& root,
    const eacp::Updater::RemoteAppManifest& manifest,
    const fs::path& artifactPath)
{
    if (!eacp::Updater::isValidAppBundleName(manifest.bundleName))
        return {.ok = false, .error = "invalid app bundle name"};

    auto unpack = root / "remote-unpack";
    std::error_code ec;
    fs::remove_all(unpack, ec);
    fs::create_directories(unpack, ec);
    if (ec)
        return {.ok = false, .error = "failed to create unpack directory"};

    if (!eacp::Updater::extractZipArchive(artifactPath, unpack))
        return {.ok = false, .error = "failed to unpack artifact"};

    auto unpackedApp = unpack / manifest.bundleName;
    if (!fs::is_directory(unpackedApp, ec))
        return {.ok = false,
                .error = "artifact did not contain " + manifest.bundleName};

    auto installPath = installedAppBundlePath(manifest.bundleName);

    // A directory holding a running executable cannot be renamed on Windows,
    // but the locked files themselves can. Moving the previous install aside
    // entry by entry lets a running app keep executing its renamed image and
    // pick up the new version on its next launch — including the hub
    // replacing itself.
    auto rollbackPath =
        installedApplicationsRoot() / (manifest.bundleName + ".rollback");
    fs::remove_all(rollbackPath, ec);
    ec.clear();
    if (fs::exists(rollbackPath, ec))
        rollbackPath = installedApplicationsRoot()
                       / (manifest.bundleName + ".rollback-"
                          + std::to_string(GetTickCount64()));

    if (fs::exists(installPath, ec)
        && !moveDirectoryEntries(installPath, rollbackPath))
    {
        moveDirectoryEntries(rollbackPath, installPath);
        return {.ok = false,
                .error = "failed to move previous install aside"};
    }

    if (!moveDirectoryEntries(unpackedApp, installPath))
    {
        moveDirectoryEntries(rollbackPath, installPath);
        return {.ok = false, .error = "failed to install app"};
    }

    fs::remove_all(unpack, ec);
    return {.ok = true};
}

} // namespace AppHub
