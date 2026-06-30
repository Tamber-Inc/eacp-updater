#pragma once

#include <Miro/Miro.h>

#include <string>

namespace eacp::AppHub
{

enum class HubProductKind
{
    App,
    Runtime,
    Model,
    Blob
};

enum class HubInstallState
{
    NotInstalled,
    Installed,
    UpdateAvailable,
    Running
};

enum class HubOperationKind
{
    None,
    Checking,
    DownloadingManifest,
    DownloadingArtifact,
    VerifyingArtifact,
    Installing,
    Launching,
    Updating,
    Resetting
};

enum class HubOperationState
{
    Idle,
    Working,
    Succeeded,
    Failed
};

enum class HubHelperState
{
    Unknown,
    Installed,
    Missing,
    Failed
};

enum class LaunchDecision
{
    Allow,
    UpdateAvailable,
    UpdateRequired,
    HubRequired,
    UnknownAllow,
    UnknownBlock
};

struct LaunchCheckRequest
{
    std::string productId;
    std::string version;
    std::string channel;
    std::string bundlePath;
    bool openHubOnBlock = true;

    MIRO_REFLECT(productId, version, channel, bundlePath, openHubOnBlock)
};

struct LaunchCheckResult
{
    LaunchDecision decision = LaunchDecision::UnknownAllow;
    std::string productId;
    std::string installedVersion;
    std::string latestVersion;
    std::string minimumLaunchVersion;
    std::string message;
    std::string hubDeepLink;
    bool hubOpened = false;

    MIRO_REFLECT(decision,
                 productId,
                 installedVersion,
                 latestVersion,
                 minimumLaunchVersion,
                 message,
                 hubDeepLink,
                 hubOpened)
};

} // namespace eacp::AppHub
