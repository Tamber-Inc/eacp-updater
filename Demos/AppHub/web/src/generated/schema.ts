export interface HubChannel {
    id: string;
    name: string;
    catalogUrl: string;
    isDefault: boolean;
}

export type HubHelperState = "Unknown" | "Installed" | "Missing" | "Failed";

export type HubProductKind = "App" | "Runtime" | "Model" | "Blob";

export type HubInstallState = "NotInstalled" | "Installed" | "UpdateAvailable" | "Running";

export interface HubProduct {
    id: string;
    name: string;
    kind: HubProductKind;
    state: HubInstallState;
    bundleName: string;
    channel: string;
    installedVersion: string;
    latestVersion: string;
    installPath: string;
    dependencies: string[];
}

export interface RemoteAppStatus {
    productId: string;
    name: string;
    installedVersion: string;
    latestVersion: string;
    installed: boolean;
    updateAvailable: boolean;
    message: string;
}

export type HubOperationKind = "None" | "Checking" | "DownloadingManifest" | "DownloadingArtifact" | "VerifyingArtifact" | "Installing" | "Launching" | "Updating" | "Resetting";

export type HubOperationState = "Idle" | "Working" | "Succeeded" | "Failed";

export interface HubOperation {
    kind: HubOperationKind;
    state: HubOperationState;
    productId: string;
    title: string;
    detail: string;
    bytesReceived: number;
    totalBytes: number;
}

export interface HubState {
    hubVersion: string;
    root: string;
    channel: string;
    catalogUrl: string;
    channels: HubChannel[];
    catalogVersion: number;
    helperState: HubHelperState;
    products: HubProduct[];
    demoApp: RemoteAppStatus;
    hubApp: RemoteAppStatus;
    operation: HubOperation;
}

export interface CommandResult {
    ok: boolean;
    message: string;
}

export interface ChannelRequest {
    channel: string;
}

export interface ProductRequest {
    productId: string;
}

export interface RemoteInstallRequest {
    manifestUrl: string;
}

