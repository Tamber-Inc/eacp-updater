#include "LaunchGuardIpc.h"

#include <Miro/Miro.h>

#include <array>
#include <cstdint>
#include <string>

namespace eacp::AppHub
{
namespace
{
constexpr std::size_t frameHeaderBytes = 4;

std::array<char, frameHeaderBytes> encodeLength(std::size_t size)
{
    auto value = static_cast<std::uint32_t>(size);
    return {static_cast<char>((value >> 24) & 0xff),
            static_cast<char>((value >> 16) & 0xff),
            static_cast<char>((value >> 8) & 0xff),
            static_cast<char>(value & 0xff)};
}

std::uint32_t decodeLength(std::string_view bytes)
{
    auto value = std::uint32_t(0);
    for (auto i = std::size_t(0); i < frameHeaderBytes; ++i)
    {
        value <<= 8;
        value |= static_cast<unsigned char>(bytes[i]);
    }
    return value;
}

LaunchCheckResult ipcError(LaunchDecision decision, std::string message)
{
    auto result = LaunchCheckResult();
    result.decision = decision;
    result.message = std::move(message);
    return result;
}

} // namespace

std::string launchCheckRequestToString(const LaunchCheckRequest& request)
{
    return Miro::toJSONString(request);
}

std::string launchCheckResultToString(const LaunchCheckResult& result)
{
    return Miro::toJSONString(result);
}

LaunchCheckRequest launchCheckRequestFromString(std::string_view payload)
{
    auto request = LaunchCheckRequest();
    Miro::fromJSONString(request, std::string(payload));
    return request;
}

LaunchCheckResult launchCheckResultFromString(std::string_view payload)
{
    auto result = LaunchCheckResult();
    Miro::fromJSONString(result, std::string(payload));
    return result;
}

std::string encodeLaunchGuardFrame(std::string_view payload)
{
    if (payload.size() > maxLaunchGuardPayloadBytes)
        return {};

    auto header = encodeLength(payload.size());
    auto out = std::string();
    out.reserve(frameHeaderBytes + payload.size());
    out.append(header.data(), header.size());
    out.append(payload.data(), payload.size());
    return out;
}

LaunchGuardDecodedFrame decodeLaunchGuardFrame(std::string_view bytes)
{
    if (bytes.size() < frameHeaderBytes)
        return {.status = LaunchGuardFrameStatus::NeedMoreData};

    auto payloadBytes = static_cast<std::size_t>(decodeLength(bytes));
    if (payloadBytes > maxLaunchGuardPayloadBytes)
    {
        return {.status = LaunchGuardFrameStatus::Invalid,
                .error = "launch guard payload is too large"};
    }

    auto frameBytes = frameHeaderBytes + payloadBytes;
    if (bytes.size() < frameBytes)
        return {.status = LaunchGuardFrameStatus::NeedMoreData};

    return {.status = LaunchGuardFrameStatus::Ready,
            .payload = std::string(bytes.substr(frameHeaderBytes, payloadBytes)),
            .bytesConsumed = frameBytes};
}

std::string handleLaunchGuardIpcRequest(std::string_view payload,
                                        const LaunchGuardCheckHandler& handler)
{
    try
    {
        if (!handler)
        {
            return launchCheckResultToString(
                ipcError(LaunchDecision::UnknownBlock,
                         "launch guard handler is not installed"));
        }

        return launchCheckResultToString(
            handler(launchCheckRequestFromString(payload)));
    }
    catch (...)
    {
        return launchCheckResultToString(
            ipcError(LaunchDecision::UnknownBlock,
                     "invalid launch guard request"));
    }
}

LaunchCheckResult checkLaunchOverIpc(LaunchGuardIpcTransport& transport,
                                     const LaunchCheckRequest& request)
{
    auto exchange = transport.exchange(launchCheckRequestToString(request));
    if (!exchange.ok)
        return ipcError(LaunchDecision::UnknownAllow, exchange.error);

    try
    {
        return launchCheckResultFromString(exchange.payload);
    }
    catch (...)
    {
        return ipcError(LaunchDecision::UnknownAllow,
                        "invalid launch guard response");
    }
}

LaunchCheckRequest launchCheckRequestFor(const LaunchGuardContext& context)
{
    auto request = LaunchCheckRequest();
    request.productId = context.productId;
    request.version = context.version;
    request.channel = context.channel;
    request.bundlePath = context.bundlePath;
    request.openHubOnBlock = context.openHubOnBlock;
    return request;
}

LaunchCheckResult checkLaunch(const LaunchGuardContext& context)
{
    auto request = launchCheckRequestFor(context);
    auto response = sendLaunchGuardIpcRequest(
        context.endpointName.empty() ? defaultLaunchGuardEndpointName()
                                     : context.endpointName,
        launchCheckRequestToString(request));
    if (!response.ok)
    {
        auto result = LaunchCheckResult();
        result.decision = LaunchDecision::UnknownAllow;
        result.productId = request.productId;
        result.installedVersion = request.version;
        result.message = response.error.empty() ? "Launch guard unavailable"
                                                : response.error;
        return result;
    }

    try
    {
        return launchCheckResultFromString(response.payload);
    }
    catch (...)
    {
        auto result = LaunchCheckResult();
        result.decision = LaunchDecision::UnknownAllow;
        result.productId = request.productId;
        result.installedVersion = request.version;
        result.message = "Launch guard returned an invalid response";
        return result;
    }
}

bool shouldAbortLaunch(const LaunchCheckResult& result)
{
    return result.decision == LaunchDecision::UpdateRequired
        || result.decision == LaunchDecision::HubRequired
        || result.decision == LaunchDecision::UnknownBlock;
}

std::string launchGuardMessage(const LaunchCheckResult& result)
{
    if (result.message.empty())
        return shouldAbortLaunch(result) ? "Launch blocked" : "Launch allowed";
    return result.message;
}

std::string defaultLaunchGuardEndpointName()
{
    return "TamberAppHubLaunchGuard";
}

} // namespace eacp::AppHub
