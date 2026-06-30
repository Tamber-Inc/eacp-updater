import { useEffect, useMemo, useState } from 'react';
import { backend } from './generated/backend';
import { useHubState } from './generated/hooks';
import type {
    HubHelperState,
    HubInstallState,
    HubOperation,
    HubOperationKind,
    HubOperationState,
    HubProduct,
    HubProductKind,
    RemoteAppStatus,
} from './generated/schema';

const installStateLabels: Record<HubInstallState, string> = {
    NotInstalled: 'Not installed',
    Installed: 'Installed',
    UpdateAvailable: 'Update available',
    Running: 'Running',
};

const productKindLabels: Record<HubProductKind, string> = {
    App: 'App',
    Runtime: 'Runtime',
    Model: 'Model',
    Blob: 'Blob',
};

const operationStateLabels: Record<HubOperationState, string> = {
    Idle: 'Idle',
    Working: 'Working',
    Succeeded: 'Done',
    Failed: 'Failed',
};

const operationKindLabels: Record<HubOperationKind, string> = {
    None: 'Ready',
    Checking: 'Checking',
    DownloadingManifest: 'Manifest',
    DownloadingArtifact: 'Downloading',
    VerifyingArtifact: 'Verifying',
    Installing: 'Installing',
    Launching: 'Launching',
    Updating: 'Updating',
    Resetting: 'Resetting',
};

const helperStateLabels: Record<HubHelperState, string> = {
    Unknown: 'Needs setup',
    Installed: 'Ready',
    Missing: 'Needs repair',
    Failed: 'Repair failed',
};

const helperStateDetails: Record<HubHelperState, string> = {
    Unknown: 'Install the helper before installing apps.',
    Installed: 'The helper is available for app installs and updates.',
    Missing: 'Repair the helper to continue installing apps.',
    Failed: 'Repair the helper and approve the admin prompt.',
};

export default function App()
{
    const state = useHubState();
    const [selectedChannel, setSelectedChannel] = useState(state.channel);
    const [channelMessage, setChannelMessage] = useState('');
    const [switchingChannel, setSwitchingChannel] = useState(false);
    useEffect(() => {
        if (state.channel)
            setSelectedChannel(state.channel);
    }, [state.channel]);
    const channelOptions = state.channels;
    const hasChannels = channelOptions.length > 0;
    const apps = useMemo(
        () => state.products.filter((product) => product.kind === 'App'),
        [state.products],
    );
    const shared = useMemo(
        () => state.products.filter((product) => product.kind !== 'App'),
        [state.products],
    );

    return (
        <main>
            <header className="topbar">
                <div>
                    <h1>Tamber AppHub</h1>
                    <p>Hub {state.hubVersion} · {state.channel}</p>
                </div>
                <div className="topbar-actions">
                    <form
                        className="channel-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!selectedChannel)
                                return;

                            setSwitchingChannel(true);
                            setChannelMessage(`Switching to ${selectedChannel}`);
                            void backend.setChannel({ channel: selectedChannel })
                                .then((result) => {
                                    setChannelMessage(result.message);
                                })
                                .catch((error: unknown) => {
                                    setChannelMessage(error instanceof Error
                                        ? error.message
                                        : 'Channel switch failed');
                                })
                                .finally(() => setSwitchingChannel(false));
                        }}
                    >
                        <select
                            aria-label="Channel"
                            value={selectedChannel}
                            onChange={(event) => setSelectedChannel(event.target.value)}
                            disabled={!hasChannels}
                        >
                            {hasChannels
                                ? null
                                : <option value={state.channel}>{state.channel || 'No channels'}</option>}
                            {channelOptions.map((channel) => (
                                <option key={channel.id} value={channel.id}>
                                    {channel.name || channel.id}
                                </option>
                            ))}
                        </select>
                        <button
                            type="submit"
                            disabled={!hasChannels || switchingChannel || selectedChannel === state.channel}
                        >
                            {switchingChannel ? 'Switching' : 'Switch'}
                        </button>
                    </form>
                    {channelMessage
                        ? <span className="channel-message">{channelMessage}</span>
                        : null}
                    <button type="button" onClick={() => void backend.refresh()}>
                        Refresh
                    </button>
                    <button type="button" onClick={() => void backend.checkUpdates()}>
                        Check updates
                    </button>
                </div>
            </header>

            <OperationStrip operation={state.operation} />
            <HelperStrip helperState={state.helperState} />

            <section className="grid remote-grid single">
                <RemoteCard
                    title="AppHub"
                    status={state.hubApp}
                    installLabel={state.hubApp.updateAvailable ? 'Update Hub' : 'Up to date'}
                    installDisabled={!state.hubApp.updateAvailable}
                    onInstall={() => void backend.updateHub({ manifestUrl: '' })}
                />
            </section>

            <section className="section">
                <div className="section-head">
                    <div>
                        <h2>Available Apps</h2>
                        <span className="muted">
                            Signed builds published by Tamber CI.
                        </span>
                    </div>
                    <div className="button-row">
                        <button type="button" onClick={() => void backend.updateAll()}>
                            Update all
                        </button>
                    </div>
                </div>
                <div className="product-list">
                    {apps.map((product) => <ProductRow key={product.id} product={product} />)}
                </div>
            </section>

            <section className="section">
                <div className="section-head">
                    <div>
                        <h2>Installed Shared Resources</h2>
                        <span className="muted">
                            Dependencies installed once and reused across apps.
                        </span>
                    </div>
                </div>
                <div className="resource-grid">
                    {shared.map((product) => <ResourceCard key={product.id} product={product} />)}
                </div>
            </section>
        </main>
    );
}

function HelperStrip({ helperState }: { helperState: HubHelperState })
{
    const ready = helperState === 'Installed';

    return (
        <section className={`helper-strip ${ready ? 'ready' : 'needs-repair'}`}>
            <div>
                <span className="eyebrow">Installer Helper</span>
                <strong>{helperStateLabels[helperState]}</strong>
                <p>{helperStateDetails[helperState]}</p>
            </div>
            <button
                type="button"
                className={ready ? undefined : 'primary'}
                onClick={() => void backend.installPrivilegedHelper()}
            >
                {ready ? 'Repair helper' : 'Install helper'}
            </button>
        </section>
    );
}

function OperationStrip({ operation }: { operation: HubOperation })
{
    const percent = operation.totalBytes > 0
        ? Math.min(100, Math.round(operation.bytesReceived * 100 / operation.totalBytes))
        : operation.state === 'Succeeded'
            ? 100
            : 0;
    const working = operation.state === 'Working';

    return (
        <section className={`operation ${operation.state.toLowerCase()}`}>
            <div>
                <span className="eyebrow">
                    {operationKindLabels[operation.kind]} · {operationStateLabels[operation.state]}
                </span>
                <strong>{operation.title || 'Ready'}</strong>
                <p>{operation.detail || 'No operation running.'}</p>
            </div>
            <div className="progress-wrap" aria-hidden={!working}>
                <div className="progress-meta">
                    <span>{formatBytes(operation.bytesReceived)}</span>
                    <span>{operation.totalBytes > 0 ? `${percent}%` : ''}</span>
                </div>
                <div className="progress">
                    <div style={{ width: `${working ? Math.max(percent, 8) : percent}%` }} />
                </div>
            </div>
        </section>
    );
}

interface RemoteCardProps
{
    title: string;
    status: RemoteAppStatus;
    installLabel: string;
    launchLabel?: string;
    installDisabled?: boolean;
    onInstall: () => void;
    onLaunch?: () => void;
}

function RemoteCard({
    title,
    status,
    installLabel,
    launchLabel,
    installDisabled = false,
    onInstall,
    onLaunch,
}: RemoteCardProps)
{
    return (
        <article className="remote-card">
            <div>
                <span className="eyebrow">{title}</span>
                <h2>{status.name || title}</h2>
                <p>{status.message || 'Waiting for update check.'}</p>
            </div>
            <dl>
                <Metric label="Installed" value={status.installedVersion || '-'} />
                <Metric label="Latest" value={status.latestVersion || '-'} />
            </dl>
            <div className="button-row">
                <button
                    type="button"
                    className="primary"
                    onClick={onInstall}
                    disabled={installDisabled}
                >
                    {installLabel}
                </button>
                {onLaunch && launchLabel
                    ? (
                        <button type="button" onClick={onLaunch} disabled={!status.installed}>
                            {launchLabel}
                        </button>
                    )
                    : null}
            </div>
        </article>
    );
}

function ProductRow({ product }: { product: HubProduct })
{
    const installed = product.state !== 'NotInstalled';
    const running = product.state === 'Running';
    const updateAvailable = product.state === 'UpdateAvailable';
    const installOrUpdate = updateAvailable
        ? () => void backend.updateProduct({ productId: product.id })
        : () => void backend.installProduct({ productId: product.id });

    return (
        <article className="product-row">
            <div className="product-main">
                <span className={`status-dot ${product.state.toLowerCase()}`} />
                <div>
                    <h3>{product.name}</h3>
                    <p>{product.id}</p>
                </div>
            </div>
            <div className="product-meta">
                <span>{installStateLabels[product.state]}</span>
                <span>{product.installedVersion || '-'} / {product.latestVersion || '-'}</span>
            </div>
            <div className="button-row">
                <button
                    type="button"
                    className="primary"
                    onClick={installOrUpdate}
                >
                    {updateAvailable
                        ? 'Update'
                        : installed
                            ? 'Reinstall'
                            : 'Install'}
                </button>
                <button
                    type="button"
                    onClick={() => void backend.openProduct({ productId: product.id })}
                    disabled={!installed || running}
                >
                    Open
                </button>
                <button
                    type="button"
                    onClick={() => void backend.closeProduct({ productId: product.id })}
                    disabled={!running}
                >
                    Close
                </button>
            </div>
        </article>
    );
}

function ResourceCard({ product }: { product: HubProduct })
{
    return (
        <article className="resource-card">
            <span className="eyebrow">{productKindLabels[product.kind]}</span>
            <h3>{product.name}</h3>
            <p>{product.id}</p>
            <div className="resource-footer">
                <span>{installStateLabels[product.state]}</span>
                <span>{product.installedVersion || product.latestVersion || '-'}</span>
            </div>
        </article>
    );
}

function Metric({ label, value }: { label: string; value: string })
{
    return (
        <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}

function formatBytes(bytes: number): string
{
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
