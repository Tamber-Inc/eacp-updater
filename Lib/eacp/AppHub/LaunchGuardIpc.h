#pragma once

#include <eacp/AppHub/AppHubTypes.h>

#include <cstddef>
#include <functional>
#include <string>
#include <string_view>

namespace eacp::AppHub
{

constexpr std::size_t maxLaunchGuardPayloadBytes = 4 * 1024 * 1024;

struct LaunchGuardIpcExchange
{
    bool ok = false;
    std::string payload;
    std::string error;
};

class LaunchGuardIpcTransport
{
public:
    virtual ~LaunchGuardIpcTransport() = default;
    virtual LaunchGuardIpcExchange exchange(std::string_view payload) = 0;
};

enum class LaunchGuardFrameStatus
{
    NeedMoreData,
    Ready,
    Invalid
};

struct LaunchGuardDecodedFrame
{
    LaunchGuardFrameStatus status = LaunchGuardFrameStatus::NeedMoreData;
    std::string payload;
    std::size_t bytesConsumed = 0;
    std::string error;
};

using LaunchGuardCheckHandler =
    std::function<LaunchCheckResult(const LaunchCheckRequest&)>;

std::string launchCheckRequestToString(const LaunchCheckRequest& request);
std::string launchCheckResultToString(const LaunchCheckResult& result);
LaunchCheckRequest launchCheckRequestFromString(std::string_view payload);
LaunchCheckResult launchCheckResultFromString(std::string_view payload);

std::string encodeLaunchGuardFrame(std::string_view payload);
LaunchGuardDecodedFrame decodeLaunchGuardFrame(std::string_view bytes);

std::string handleLaunchGuardIpcRequest(std::string_view payload,
                                        const LaunchGuardCheckHandler& handler);
LaunchCheckResult checkLaunchOverIpc(LaunchGuardIpcTransport& transport,
                                     const LaunchCheckRequest& request);

std::string defaultLaunchGuardEndpointName();
LaunchGuardIpcExchange sendLaunchGuardIpcRequest(std::string_view endpointName,
                                                 std::string_view payload);

} // namespace eacp::AppHub
