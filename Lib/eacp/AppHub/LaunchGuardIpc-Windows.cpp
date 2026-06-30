#include "LaunchGuardIpc.h"

#if defined(_WIN32)

#include <array>
#include <string>

#include <windows.h>

namespace eacp::AppHub
{
namespace
{
std::wstring widen(std::string_view value)
{
    if (value.empty())
        return {};

    auto required = MultiByteToWideChar(CP_UTF8,
                                        0,
                                        value.data(),
                                        static_cast<int>(value.size()),
                                        nullptr,
                                        0);
    if (required <= 0)
        return {};

    auto out = std::wstring(static_cast<std::size_t>(required), L'\0');
    MultiByteToWideChar(CP_UTF8,
                        0,
                        value.data(),
                        static_cast<int>(value.size()),
                        out.data(),
                        required);
    return out;
}

std::string pipeNameFor(std::string_view endpointName)
{
    if (endpointName == defaultLaunchGuardEndpointName())
        return R"(\\.\pipe\TamberAppHubLaunchGuard)";
    return std::string(endpointName);
}
} // namespace

LaunchGuardIpcExchange sendLaunchGuardIpcRequest(std::string_view endpointName,
                                                 std::string_view payload)
{
    auto frame = encodeLaunchGuardFrame(payload);
    if (frame.empty() && !payload.empty())
        return {.ok = false, .error = "launch guard request is too large"};

    auto pipeName = widen(pipeNameFor(endpointName));
    auto handle = CreateFileW(pipeName.c_str(),
                              GENERIC_READ | GENERIC_WRITE,
                              0,
                              nullptr,
                              OPEN_EXISTING,
                              0,
                              nullptr);
    if (handle == INVALID_HANDLE_VALUE)
        return {.ok = false, .error = "failed to connect to launch guard pipe"};

    DWORD written = 0;
    if (!WriteFile(handle,
                   frame.data(),
                   static_cast<DWORD>(frame.size()),
                   &written,
                   nullptr)
        || written != frame.size())
    {
        CloseHandle(handle);
        return {.ok = false, .error = "failed to write launch guard request"};
    }

    auto responseBytes = std::string();
    auto buffer = std::array<char, 4096>();
    while (true)
    {
        DWORD read = 0;
        if (!ReadFile(handle,
                      buffer.data(),
                      static_cast<DWORD>(buffer.size()),
                      &read,
                      nullptr)
            || read == 0)
            break;

        responseBytes.append(buffer.data(), read);
        auto decoded = decodeLaunchGuardFrame(responseBytes);
        if (decoded.status == LaunchGuardFrameStatus::Ready)
        {
            CloseHandle(handle);
            return {.ok = true, .payload = decoded.payload};
        }
        if (decoded.status == LaunchGuardFrameStatus::Invalid)
        {
            CloseHandle(handle);
            return {.ok = false, .error = decoded.error};
        }
    }

    CloseHandle(handle);
    return {.ok = false, .error = "launch guard pipe closed without response"};
}

} // namespace eacp::AppHub

#endif
