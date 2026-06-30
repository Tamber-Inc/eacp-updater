import type * as T from './schema';

export type Invoke = (command: string, payload: unknown) => Promise<unknown>;

export function makeBackend(invoke: Invoke)
{
    return {
        getHubState: (): Promise<T.HubState> =>
            invoke('getHubState', {}) as Promise<T.HubState>,
        refresh: (): Promise<T.CommandResult> =>
            invoke('refresh', {}) as Promise<T.CommandResult>,
        setChannel: (req: T.ChannelRequest): Promise<T.CommandResult> =>
            invoke('setChannel', req) as Promise<T.CommandResult>,
        checkUpdates: (): Promise<T.CommandResult> =>
            invoke('checkUpdates', {}) as Promise<T.CommandResult>,
        installProduct: (req: T.ProductRequest): Promise<T.CommandResult> =>
            invoke('installProduct', req) as Promise<T.CommandResult>,
        updateProduct: (req: T.ProductRequest): Promise<T.CommandResult> =>
            invoke('updateProduct', req) as Promise<T.CommandResult>,
        openProduct: (req: T.ProductRequest): Promise<T.CommandResult> =>
            invoke('openProduct', req) as Promise<T.CommandResult>,
        closeProduct: (req: T.ProductRequest): Promise<T.CommandResult> =>
            invoke('closeProduct', req) as Promise<T.CommandResult>,
        updateAll: (): Promise<T.CommandResult> =>
            invoke('updateAll', {}) as Promise<T.CommandResult>,
        publishMockUpdate: (): Promise<T.CommandResult> =>
            invoke('publishMockUpdate', {}) as Promise<T.CommandResult>,
        resetMock: (): Promise<T.CommandResult> =>
            invoke('resetMock', {}) as Promise<T.CommandResult>,
        installDemoApp: (req: T.RemoteInstallRequest): Promise<T.CommandResult> =>
            invoke('installDemoApp', req) as Promise<T.CommandResult>,
        updateHub: (req: T.RemoteInstallRequest): Promise<T.CommandResult> =>
            invoke('updateHub', req) as Promise<T.CommandResult>,
        launchDemoApp: (): Promise<T.CommandResult> =>
            invoke('launchDemoApp', {}) as Promise<T.CommandResult>,
        launchHub: (): Promise<T.CommandResult> =>
            invoke('launchHub', {}) as Promise<T.CommandResult>,
        installPrivilegedHelper: (): Promise<T.CommandResult> =>
            invoke('installPrivilegedHelper', {}) as Promise<T.CommandResult>,
    };
}
