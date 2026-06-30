#pragma once

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

} // namespace eacp::AppHub
