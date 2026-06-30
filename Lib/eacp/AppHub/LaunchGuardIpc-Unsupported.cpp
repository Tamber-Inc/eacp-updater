#include "LaunchGuardIpc.h"

namespace eacp::AppHub
{

LaunchGuardIpcExchange sendLaunchGuardIpcRequest(std::string_view,
                                                 std::string_view)
{
    return {.ok = false,
            .error = "launch guard IPC is not implemented on this platform"};
}

} // namespace eacp::AppHub
