#pragma once

#include <eacp/Updater/PrivilegedHelper/PrivilegedHelper.h>

#ifndef EACP_APPHUB_HELPER_LABEL
#define EACP_APPHUB_HELPER_LABEL "com.tamber.AppHub.PrivilegedHelper"
#endif

namespace AppHub
{

using PrivilegedHelperInstallResult =
    eacp::Updater::PrivilegedHelperInstallResult;

#if defined(EACP_APPHUB_EXTERNAL_HELPER)
PrivilegedHelperInstallResult installPrivilegedHelper();
eacp::Updater::InstallResult installAppBundleWithPrivilegedHelper(
    const eacp::Updater::PrivilegedAppBundleInstallRequest& request);
#else
inline PrivilegedHelperInstallResult installPrivilegedHelper()
{
    return eacp::Updater::installPrivilegedHelper(EACP_APPHUB_HELPER_LABEL);
}

inline eacp::Updater::InstallResult installAppBundleWithPrivilegedHelper(
    const eacp::Updater::PrivilegedAppBundleInstallRequest& request)
{
    return eacp::Updater::installAppBundleWithPrivilegedHelper(
        EACP_APPHUB_HELPER_LABEL,
        request);
}
#endif

} // namespace AppHub
