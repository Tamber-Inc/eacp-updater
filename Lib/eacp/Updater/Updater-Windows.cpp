#include "Updater.h"

#include <eacp/Core/Process/Process.h>
#include <eacp/Core/Utils/Environment.h>

#include <system_error>

namespace eacp::Updater
{
namespace fs = std::filesystem;

namespace
{
// bsdtar ships with Windows 10 1803+ and reads/writes zip archives.
fs::path systemTarPath()
{
    auto systemRoot = getEnvValue("SystemRoot");
    if (systemRoot.empty())
        systemRoot = "C:\\Windows";
    return fs::path(systemRoot) / "System32" / "tar.exe";
}

bool runTar(const Vector<std::string>& arguments)
{
    auto result = Processes::run(systemTarPath().string(), arguments);
    return result.exited && result.exitCode == 0;
}
} // namespace

bool extractZipArchive(const fs::path& archive, const fs::path& destination)
{
    std::error_code ec;
    fs::create_directories(destination, ec);
    if (ec)
        return false;

    return runTar({"-x", "-f", archive.string(), "-C", destination.string()});
}

bool createZipArchive(const fs::path& source, const fs::path& archive)
{
    std::error_code ec;
    if (archive.has_parent_path())
        fs::create_directories(archive.parent_path(), ec);
    fs::remove(archive, ec);

    return runTar({"-a",
                   "-c",
                   "-f",
                   archive.string(),
                   "-C",
                   source.parent_path().string(),
                   source.filename().string()});
}

InstallResult installAppBundleArtifact(const PrivilegedAppBundleInstallRequest&)
{
    // Windows installs are per-user (see AppHubPlatform-Windows.cpp) and do
    // not need privilege escalation.
    auto result = InstallResult();
    result.ok = false;
    result.error = "privileged app bundle installs are not used on Windows";
    return result;
}

} // namespace eacp::Updater
