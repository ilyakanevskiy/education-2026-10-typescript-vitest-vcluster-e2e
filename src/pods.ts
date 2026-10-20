import type { CoreV1Api, V1Pod } from '@kubernetes/client-node';
import { readOrNull } from './api.js';
import { done, pending, poll, type Attempt } from './poll.js';

/** Small image that is already on the kind node and starts immediately. */
export const PAUSE_IMAGE = 'registry.k8s.io/pause:3.10';

export function pausePod(name: string, overrides: Partial<V1Pod['spec']> = {}): V1Pod {
  return {
    metadata: { name },
    spec: {
      containers: [{ name: 'pause', image: PAUSE_IMAGE }],
      ...overrides,
    },
  };
}

export const describePod = (pod: V1Pod): string =>
  `${pod.metadata?.namespace}/${pod.metadata?.name} phase=${pod.status?.phase ?? '<none>'}`;

/**
 * Finds the host copy of a vCluster pod. The syncer labels it with the owning vCluster
 * and the virtual namespace, and records the virtual pod's uid in an annotation; the
 * uid is matched instead of the rewritten name, which gets truncated and hashed when long.
 */
export async function findHostCopy(
  hostCore: CoreV1Api,
  hostNamespace: string,
  vcluster: string,
  virtualPod: V1Pod,
): Promise<V1Pod | undefined> {
  const list = await hostCore.listNamespacedPod({
    namespace: hostNamespace,
    labelSelector: `vcluster.loft.sh/managed-by=${vcluster},vcluster.loft.sh/namespace=${virtualPod.metadata?.namespace}`,
  });
  return list.items.find(
    (pod) => pod.metadata?.annotations?.['vcluster.loft.sh/object-uid'] === virtualPod.metadata?.uid,
  );
}

export const waitForPhase = (
  core: CoreV1Api,
  where: string,
  name: string,
  namespace: string,
  phase: string,
  timeoutMs?: number,
): Promise<V1Pod> =>
  poll(
    `${where} pod ${namespace}/${name} to reach ${phase}`,
    async (): Promise<Attempt<V1Pod>> => {
      const pod = await readOrNull(() => core.readNamespacedPod({ name, namespace }));
      if (!pod) return pending('404');
      return pod.status?.phase === phase ? done(pod) : pending(describePod(pod));
    },
    timeoutMs,
  );
