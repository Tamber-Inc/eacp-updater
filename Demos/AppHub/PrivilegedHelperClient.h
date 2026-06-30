#pragma once

#include <eacp/Updater/PrivilegedHelper/PrivilegedHelper.h>

#ifndef EACP_APPHUB_HELPER_LABEL
#define EACP_APPHUB_HELPER_LABEL "music.tamber.AppHub.PrivilegedHelper"
#endif

namespace AppHub
{

using PrivilegedHelperInstallResult = eacp::Updater::PrivilegedHelperInstallResult;

// @codex that the fuck is all this? why do we need a macro?
// what is this here?
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
