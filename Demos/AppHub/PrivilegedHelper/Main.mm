#include <eacp/Updater/PrivilegedHelper/PrivilegedHelper.h>

#ifndef EACP_APPHUB_HELPER_ALLOWED_TEAM_ID
#define EACP_APPHUB_HELPER_ALLOWED_TEAM_ID "MBHR5VAUVQ"
#endif

int main(int argc, char* argv[])
{
    return eacp::Updater::runPrivilegedAppBundleHelper(
        EACP_APPHUB_HELPER_LABEL,
        EACP_APPHUB_HELPER_ALLOWED_TEAM_ID,
        argc,
        argv);
}
