#include "Updater.h"

namespace eacp::Updater
{

bool extractZipArchive(const std::filesystem::path&,
                       const std::filesystem::path&)
{
    return false;
}

bool createZipArchive(const std::filesystem::path&,
                      const std::filesystem::path&)
{
    return false;
}

InstallResult installAppBundleArtifact(const PrivilegedAppBundleInstallRequest&)
{
    auto result = InstallResult();
    result.ok = false;
    result.error =
        "privileged app bundle installs are not implemented on this platform";
    return result;
}

} // namespace eacp::Updater
