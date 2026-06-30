import type * as T from './schema';

export type Handlers = {
    getHubState(): T.HubState | Promise<T.HubState>;
    refresh(): T.CommandResult | Promise<T.CommandResult>;
    setChannel(req: T.ChannelRequest): T.CommandResult | Promise<T.CommandResult>;
    checkUpdates(): T.CommandResult | Promise<T.CommandResult>;
    installProduct(req: T.ProductRequest): T.CommandResult | Promise<T.CommandResult>;
    updateProduct(req: T.ProductRequest): T.CommandResult | Promise<T.CommandResult>;
    openProduct(req: T.ProductRequest): T.CommandResult | Promise<T.CommandResult>;
    closeProduct(req: T.ProductRequest): T.CommandResult | Promise<T.CommandResult>;
    updateAll(): T.CommandResult | Promise<T.CommandResult>;
    publishMockUpdate(): T.CommandResult | Promise<T.CommandResult>;
    resetMock(): T.CommandResult | Promise<T.CommandResult>;
    installDemoApp(req: T.RemoteInstallRequest): T.CommandResult | Promise<T.CommandResult>;
    updateHub(req: T.RemoteInstallRequest): T.CommandResult | Promise<T.CommandResult>;
    launchDemoApp(): T.CommandResult | Promise<T.CommandResult>;
    launchHub(): T.CommandResult | Promise<T.CommandResult>;
    installPrivilegedHelper(): T.CommandResult | Promise<T.CommandResult>;
};

export class UnknownCommandError extends Error
{
    httpStatus = 404;
    constructor(command: string)
    {
        super(`Unknown command: ${command}`);
    }
}

export async function dispatch(handlers: Handlers, command: string, payload: unknown): Promise<unknown>
{
    switch (command)
    {
        case 'getHubState': return await handlers.getHubState();
        case 'refresh': return await handlers.refresh();
        case 'setChannel': return await handlers.setChannel(payload as T.ChannelRequest);
        case 'checkUpdates': return await handlers.checkUpdates();
        case 'installProduct': return await handlers.installProduct(payload as T.ProductRequest);
        case 'updateProduct': return await handlers.updateProduct(payload as T.ProductRequest);
        case 'openProduct': return await handlers.openProduct(payload as T.ProductRequest);
        case 'closeProduct': return await handlers.closeProduct(payload as T.ProductRequest);
        case 'updateAll': return await handlers.updateAll();
        case 'publishMockUpdate': return await handlers.publishMockUpdate();
        case 'resetMock': return await handlers.resetMock();
        case 'installDemoApp': return await handlers.installDemoApp(payload as T.RemoteInstallRequest);
        case 'updateHub': return await handlers.updateHub(payload as T.RemoteInstallRequest);
        case 'launchDemoApp': return await handlers.launchDemoApp();
        case 'launchHub': return await handlers.launchHub();
        case 'installPrivilegedHelper': return await handlers.installPrivilegedHelper();
        default: throw new UnknownCommandError(command);
    }
}
