#include "LaunchGuardIpc.h"

#include <array>
#include <cstring>
#include <string>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace eacp::AppHub
{

LaunchGuardIpcExchange sendLaunchGuardIpcRequest(std::string_view endpointName,
                                                 std::string_view payload)
{
    auto frame = encodeLaunchGuardFrame(payload);
    if (frame.empty() && !payload.empty())
        return {.ok = false, .error = "launch guard request is too large"};

    auto fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0)
        return {.ok = false, .error = "failed to create launch guard socket"};

    auto address = sockaddr_un();
    address.sun_family = AF_UNIX;
    auto endpoint = std::string(endpointName);
    if (endpoint == defaultLaunchGuardEndpointName())
        endpoint = "/tmp/tamber-apphub-launch-guard.sock";
    if (endpoint.size() >= sizeof(address.sun_path))
    {
        ::close(fd);
        return {.ok = false, .error = "launch guard socket path is too long"};
    }
    std::memcpy(address.sun_path, endpoint.c_str(), endpoint.size() + 1);

    if (::connect(fd,
                  reinterpret_cast<sockaddr*>(&address),
                  sizeof(address)) != 0)
    {
        ::close(fd);
        return {.ok = false, .error = "failed to connect to launch guard socket"};
    }

    auto written = std::size_t(0);
    while (written < frame.size())
    {
        auto count = ::send(fd,
                            frame.data() + written,
                            frame.size() - written,
                            0);
        if (count <= 0)
        {
            ::close(fd);
            return {.ok = false,
                    .error = "failed to write launch guard request"};
        }
        written += static_cast<std::size_t>(count);
    }

    auto responseBytes = std::string();
    auto buffer = std::array<char, 4096>();
    while (true)
    {
        auto count = ::recv(fd, buffer.data(), buffer.size(), 0);
        if (count <= 0)
            break;

        responseBytes.append(buffer.data(), static_cast<std::size_t>(count));
        auto decoded = decodeLaunchGuardFrame(responseBytes);
        if (decoded.status == LaunchGuardFrameStatus::Ready)
        {
            ::close(fd);
            return {.ok = true, .payload = decoded.payload};
        }
        if (decoded.status == LaunchGuardFrameStatus::Invalid)
        {
            ::close(fd);
            return {.ok = false, .error = decoded.error};
        }
    }

    ::close(fd);
    return {.ok = false, .error = "launch guard socket closed without response"};
}

} // namespace eacp::AppHub
