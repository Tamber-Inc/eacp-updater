#pragma once

#include <eacp/Updater/Updater.h>

#include <string>

namespace eacp::Updater
{

struct PrivilegedHelperInstallResult
{
    bool ok = false;
    std::string error;
};

PrivilegedHelperInstallResult installPrivilegedHelper(std::string helperLabel);
InstallResult installAppBundleWithPrivilegedHelper(
    std::string helperLabel,
    const PrivilegedAppBundleInstallRequest& request);

int runPrivilegedAppBundleHelper(std::string helperLabel,
                                 std::string allowedTeamIdentifier,
                                 int argc,
                                 char* argv[]);

} // namespace eacp::Updater
