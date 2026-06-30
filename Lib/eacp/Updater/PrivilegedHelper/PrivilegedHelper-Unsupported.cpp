#include "PrivilegedHelper.h"

namespace eacp::Updater
{

PrivilegedHelperInstallResult installPrivilegedHelper(std::string)
{
    auto result = PrivilegedHelperInstallResult();
    result.ok = false;
    result.error = "privileged helper blessing is only available on macOS";
    return result;
}

InstallResult installAppBundleWithPrivilegedHelper(
    std::string,
    const PrivilegedAppBundleInstallRequest&)
{
    auto result = InstallResult();
    result.ok = false;
    result.error = "privileged helper installs are only available on macOS";
    return result;
}

int runPrivilegedAppBundleHelper(std::string, std::string, int, char*[])
{
    return 1;
}

} // namespace eacp::Updater
