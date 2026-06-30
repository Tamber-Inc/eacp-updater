#include "AppHubPlatform.h"

#include <eacp/Core/Process/Process.h>

#include <mach-o/dyld.h>

#import <AppKit/NSWorkspace.h>
#import <AppKit/NSRunningApplication.h>
#import <Foundation/Foundation.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <vector>

namespace AppHub
{
namespace fs = std::filesystem;
namespace Processes = eacp::Processes;

fs::path defaultStateRoot()
{
    if (auto* home = std::getenv("HOME"))
        return fs::path(home) / "Library" / "Application Support" / "Tamber"
               / "AppHub";
    return fs::temp_directory_path() / "eacp-apphub";
}

eacp::Updater::Target currentTarget()
{
    auto target = eacp::Updater::Target();
    target.platform = eacp::Updater::Platform::MacOS;
    target.architecture = eacp::Updater::Architecture::Universal;
    return target;
}

fs::path installedApplicationsRoot()
{
    return "/Applications";
}

fs::path installedAppBundlePath(std::string_view bundleName)
{
    return installedApplicationsRoot() / std::string(bundleName);
}

fs::path installedDemoAppBundlePath()
{
    return installedAppBundlePath("Tamber Local Update Demo.app");
}

fs::path installedDemoAppExecutablePath()
{
    return installedDemoAppBundlePath() / "Contents" / "MacOS"
           / "Tamber Local Update Demo";
}

fs::path installedHubAppBundlePath()
{
    return installedAppBundlePath("AppHub.app");
}

fs::path installedHubAppExecutablePath()
{
    return installedHubAppBundlePath() / "Contents" / "MacOS" / "AppHub";
}

std::optional<fs::path> currentExecutablePath()
{
    auto size = std::uint32_t {};
    _NSGetExecutablePath(nullptr, &size);
    auto buffer = std::string(size, '\0');
    if (_NSGetExecutablePath(buffer.data(), &size) != 0)
        return std::nullopt;
    buffer.resize(std::strlen(buffer.c_str()));
    std::error_code ec;
    return fs::weakly_canonical(buffer, ec);
}

bool createAppBundleZip(const fs::path& bundle, const fs::path& output)
{
    std::error_code ec;
    fs::create_directories(output.parent_path(), ec);
    fs::remove(output, ec);

    auto result = Processes::run("/usr/bin/ditto",
                                 {"-c",
                                  "-k",
                                  "--sequesterRsrc",
                                  "--keepParent",
                                  bundle.string(),
                                  output.string()});
    return result.exited && result.exitCode == 0;
}

bool isAppBundleRunning(std::string_view appPath)
{
    auto ec = std::error_code();
    auto path = fs::weakly_canonical(fs::path(std::string(appPath)), ec);
    if (ec)
        path = fs::path(std::string(appPath));

    @autoreleasepool
    {
        auto target = [NSURL fileURLWithPath:
                                 [NSString stringWithUTF8String:path.string()
                                                                    .c_str()]
                               isDirectory:YES];
        for (NSRunningApplication* app in [[NSWorkspace sharedWorkspace]
                 runningApplications])
        {
            auto* bundleURL = [app bundleURL];
            if (bundleURL == nil)
                continue;
            if ([bundleURL isEqual:target])
                return true;
        }
    }

    return false;
}

LaunchResult closeAppBundle(std::string_view appPath)
{
    auto ec = std::error_code();
    auto path = fs::weakly_canonical(fs::path(std::string(appPath)), ec);
    if (ec)
        path = fs::path(std::string(appPath));

    @autoreleasepool
    {
        auto target = [NSURL fileURLWithPath:
                                 [NSString stringWithUTF8String:path.string()
                                                                    .c_str()]
                               isDirectory:YES];
        auto* matches = [NSMutableArray array];
        for (NSRunningApplication* app in [[NSWorkspace sharedWorkspace]
                 runningApplications])
        {
            auto* bundleURL = [app bundleURL];
            if (bundleURL != nil && [bundleURL isEqual:target])
                [matches addObject:app];
        }

        if ([matches count] == 0)
            return {.ok = true};

        for (NSRunningApplication* app in matches)
        {
            if (![app terminate])
                [app forceTerminate];
        }

        auto* deadline = [NSDate dateWithTimeIntervalSinceNow:5.0];
        while ([[NSDate date] compare:deadline] == NSOrderedAscending)
        {
            auto allTerminated = true;
            for (NSRunningApplication* app in matches)
            {
                if (![app isTerminated])
                {
                    allTerminated = false;
                    break;
                }
            }
            if (allTerminated)
                return {.ok = true};
            [NSThread sleepForTimeInterval:0.05];
        }

        for (NSRunningApplication* app in matches)
        {
            if (![app isTerminated])
                [app forceTerminate];
        }

        auto* forceDeadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
        while ([[NSDate date] compare:forceDeadline] == NSOrderedAscending)
        {
            auto allTerminated = true;
            for (NSRunningApplication* app in matches)
            {
                if (![app isTerminated])
                {
                    allTerminated = false;
                    break;
                }
            }
            if (allTerminated)
                return {.ok = true};
            [NSThread sleepForTimeInterval:0.05];
        }
    }

    return {.ok = false, .error = "Timed out closing app"};
}

namespace
{

bool runProcess(const std::vector<std::string>& args)
{
    if (args.empty())
        return false;
    auto rest = eacp::Vector<std::string>();
    for (auto it = args.begin() + 1; it != args.end(); ++it)
        rest.add(*it);
    auto result = Processes::run(args.front(), rest);
    return result.exited && result.exitCode == 0;
}

bool runInstallProcess(std::vector<std::string> args)
{
    if (::access("/Applications", W_OK) != 0)
        args.insert(args.begin(), "sudo");
    return runProcess(args);
}

} // namespace

PlatformResult directInstallAppBundle(const fs::path& root,
                                      const eacp::Updater::RemoteAppManifest& manifest,
                                      const fs::path& artifactPath)
{
    auto unpack = root / "remote-unpack";

    std::error_code ec;
    fs::remove_all(unpack, ec);
    fs::create_directories(unpack, ec);
    if (ec)
        return {.ok = false, .error = "failed to create unpack directory"};

    if (!runProcess({"/usr/bin/ditto",
                     "-x",
                     "-k",
                     artifactPath.string(),
                     unpack.string()}))
        return {.ok = false, .error = "failed to unpack artifact"};

    auto unpackedApp = unpack / manifest.bundleName;
    if (!fs::is_directory(unpackedApp, ec))
        return {.ok = false,
                .error = "artifact did not contain " + manifest.bundleName};

    auto installPath = installedAppBundlePath(manifest.bundleName);
    auto rollbackPath =
        installedApplicationsRoot() / (manifest.bundleName + ".rollback");

    if (!runInstallProcess({"/bin/rm", "-rf", rollbackPath.string()}))
        return {.ok = false, .error = "failed to remove old rollback"};

    if (fs::exists(installPath, ec)
        && !runInstallProcess({"/bin/mv",
                               installPath.string(),
                               rollbackPath.string()}))
        return {.ok = false, .error = "failed to create rollback"};

    if (!runInstallProcess(
            {"/bin/mv", unpackedApp.string(), installPath.string()})
        && !runInstallProcess({"/usr/bin/ditto",
                               unpackedApp.string(),
                               installPath.string()}))
        return {.ok = false, .error = "failed to install app"};

    return {.ok = true};
}

LaunchResult openAppBundle(std::string_view appPath)
{
    auto result = Processes::run("/usr/bin/open", {std::string(appPath)});
    if (result.exited && result.exitCode == 0)
        return {.ok = true};

    auto error = result.output;
    if (error.empty())
        error = "open exited with code " + std::to_string(result.exitCode);
    return {.ok = false, .error = error};
}

LaunchResult openNewAppBundleInstance(std::string_view appPath)
{
    auto result =
        Processes::run("/usr/bin/open", {"-n", std::string(appPath)});
    if (result.exited && result.exitCode == 0)
        return {.ok = true};

    auto error = result.output;
    if (error.empty())
        error = "open -n exited with code " + std::to_string(result.exitCode);
    return {.ok = false, .error = error};
}

} // namespace AppHub
