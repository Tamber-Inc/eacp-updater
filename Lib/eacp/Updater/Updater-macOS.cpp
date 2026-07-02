#include "Updater.h"

#include <eacp/Core/Process/Process.h>
#include <eacp/Core/Utils/SHA256.h>
#include <eacp/Core/Utils/Strings.h>

#include <cstdlib>
#include <sstream>
#include <string_view>
#include <system_error>
#include <unistd.h>
#include <vector>

namespace eacp::Updater
{
namespace fs = std::filesystem;

namespace
{
InstallResult ok()
{
    auto result = InstallResult();
    result.ok = true;
    return result;
}

InstallResult error(std::string message)
{
    auto result = InstallResult();
    result.ok = false;
    result.error = std::move(message);
    return result;
}

struct ProcessOutput
{
    bool ok = false;
    std::string output;
};

ProcessOutput runProcessCapture(const std::string& executable,
                                const Vector<std::string>& arguments)
{
    auto run = Processes::run(executable, arguments);

    auto result = ProcessOutput();
    result.ok = run.exited && run.exitCode == 0;
    result.output = run.output + run.errorOutput;
    return result;
}

bool runProcess(const std::string& executable,
                const Vector<std::string>& arguments)
{
    return runProcessCapture(executable, arguments).ok;
}

fs::path createTemporaryDirectory(const std::string& prefix)
{
    auto pattern = (fs::temp_directory_path() / (prefix + ".XXXXXX")).string();
    auto mutablePattern = std::vector<char>(pattern.begin(), pattern.end());
    mutablePattern.push_back('\0');

    auto* result = ::mkdtemp(mutablePattern.data());
    return result == nullptr ? fs::path() : fs::path(result);
}

std::string bundleIdentifierFor(const fs::path& app)
{
    auto result =
        runProcessCapture("/usr/libexec/PlistBuddy",
                          {"-c",
                           "Print :CFBundleIdentifier",
                           (app / "Contents" / "Info.plist").string()});
    return result.ok ? Strings::trim(result.output) : std::string();
}

std::string teamIdentifierFor(const fs::path& app)
{
    auto result = runProcessCapture("/usr/bin/codesign",
                                    {"--display", "--verbose=4", app.string()});
    if (!result.ok)
        return {};

    auto input = std::istringstream(result.output);
    auto line = std::string();
    constexpr auto prefix = std::string_view("TeamIdentifier=");
    while (std::getline(input, line))
    {
        if (line.rfind(prefix, 0) == 0)
            return Strings::trim(line.substr(prefix.size()));
    }

    return {};
}

InstallResult validateUnpackedAppBundle(
    const PrivilegedAppBundleInstallRequest& request,
    const fs::path& app)
{
    std::error_code ec;
    if (!fs::is_directory(app, ec) || fs::is_symlink(app, ec))
        return error("artifact did not contain expected app bundle");

    auto actualBundleId = bundleIdentifierFor(app);
    if (actualBundleId.empty())
        return error("app bundle identifier could not be read");
    if (actualBundleId != request.productId)
        return error("app bundle identifier mismatch");

    if (!runProcess("/usr/bin/codesign",
                    {"--verify", "--strict", "--verbose=2", app.string()}))
        return error("app bundle code signature verification failed");

    if (!request.requiredTeamIdentifier.empty())
    {
        auto teamId = teamIdentifierFor(app);
        if (teamId != request.requiredTeamIdentifier)
            return error("app bundle team identifier mismatch");
    }

    return ok();
}
} // namespace

bool extractZipArchive(const fs::path& archive, const fs::path& destination)
{
    std::error_code ec;
    fs::create_directories(destination, ec);
    if (ec)
        return false;

    return runProcess("/usr/bin/ditto",
                      {"-x", "-k", archive.string(), destination.string()});
}

bool createZipArchive(const fs::path& source, const fs::path& archive)
{
    std::error_code ec;
    if (archive.has_parent_path())
        fs::create_directories(archive.parent_path(), ec);
    fs::remove(archive, ec);

    return runProcess(
        "/usr/bin/ditto",
        {"-c", "-k", "--keepParent", source.string(), archive.string()});
}

InstallResult installAppBundleArtifact(
    const PrivilegedAppBundleInstallRequest& request)
{
    if (!isValidProductId(request.productId))
        return error("invalid product id");
    if (!isValidAppBundleName(request.bundleName))
        return error("invalid app bundle name");
    if (request.artifactPath.empty())
        return error("artifact path is required");
    if (request.artifactSha256.empty())
        return error("artifact hash is required");

    auto artifact = fs::path(request.artifactPath);
    std::error_code ec;
    if (!fs::is_regular_file(artifact, ec))
        return error("artifact path is not a regular file");

    auto actualHash = Crypto::sha256File(artifact.string());
    if (actualHash.empty())
        return error("artifact could not be read");
    if (actualHash != request.artifactSha256)
        return error("artifact hash mismatch");

    auto temp = createTemporaryDirectory("eacp-privileged-install");
    if (temp.empty())
        return error("failed to create privileged install temp directory");

    auto cleanup = [&]
    {
        std::error_code cleanupEc;
        fs::remove_all(temp, cleanupEc);
    };

    auto unpack = temp / "unpack";
    fs::create_directories(unpack, ec);
    if (ec)
    {
        cleanup();
        return error("failed to create unpack directory");
    }

    if (!extractZipArchive(artifact, unpack))
    {
        cleanup();
        return error("failed to unpack artifact");
    }

    auto unpackedApp = unpack / request.bundleName;
    if (auto validation = validateUnpackedAppBundle(request, unpackedApp);
        !validation.ok)
    {
        cleanup();
        return validation;
    }

    auto installPath = fs::path("/Applications") / request.bundleName;
    auto rollbackPath =
        fs::path("/Applications") / (request.bundleName + ".rollback");

    fs::remove_all(rollbackPath, ec);
    if (ec)
    {
        cleanup();
        return error("failed to remove old rollback");
    }

    if (fs::exists(installPath, ec))
    {
        fs::rename(installPath, rollbackPath, ec);
        if (ec)
        {
            cleanup();
            return error("failed to create rollback");
        }
    }

    fs::rename(unpackedApp, installPath, ec);
    if (ec
        && !runProcess("/usr/bin/ditto",
                       {unpackedApp.string(), installPath.string()}))
    {
        auto restoreEc = std::error_code();
        fs::remove_all(installPath, restoreEc);
        restoreEc.clear();
        if (fs::exists(rollbackPath, restoreEc))
            fs::rename(rollbackPath, installPath, restoreEc);
        cleanup();
        return error("failed to install app");
    }

    cleanup();
    return ok();
}

} // namespace eacp::Updater
