// Generated. Do not edit by hand.
//
// Pre-wired React hooks for every registered bridge event.
// Keyed states get useXxx / useXxxIds / useXxxItem; plain
// states get useXxx; push-only events get useXxx via
// makeNativeEvent. Initial values come from toJSON(T{}).

import { backend, isBackendAvailable } from './backend';
import { makeBridgeStore } from './react';

export const useHubState = makeBridgeStore({
    backend,
    event: 'hubState',
    fetch: backend.getHubState,
    shouldFetch: isBackendAvailable,
    initial: {"catalogUrl":"","catalogVersion":0,"channel":"stable","channels":[],"demoApp":{"installed":false,"installedVersion":"","latestVersion":"","message":"","name":"","productId":"","updateAvailable":false},"helperState":"Unknown","hubApp":{"installed":false,"installedVersion":"","latestVersion":"","message":"","name":"","productId":"","updateAvailable":false},"hubVersion":"1.0.0","operation":{"bytesReceived":0,"detail":"","kind":"None","productId":"","state":"Idle","title":"","totalBytes":-1},"products":[],"root":""},
});
