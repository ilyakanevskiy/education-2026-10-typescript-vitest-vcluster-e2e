import type { CoreV1Api, V1Pod } from '@kubernetes/client-node';
import { readOrNull } from './api.js';
import { hostNamespace } from './clusters.js';
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

/** Annotations the syncer puts on a host copy, pointing back at the virtual pod. */
export const OBJECT_UID = 'vcluster.loft.sh/object-uid';
export const OBJECT_NAME = 'vcluster.loft.sh/object-name';
export const OBJECT_NAMESPACE = 'vcluster.loft.sh/object-namespace';

/**
 * Lists the host copies of pods from one virtual namespace. The syncer labels each
 * copy with the owning vCluster and the virtual namespace.
 */
export async function listHostCopies(hostCore: CoreV1Api, vcluster: string, namespace: string): Promise<V1Pod[]> {
  const list = await hostCore.listNamespacedPod({
    namespace: hostNamespace(vcluster),
    labelSelector: `vcluster.loft.sh/managed-by=${vcluster},vcluster.loft.sh/namespace=${namespace}`,
  });
  return list.items;
}

/**
 * Finds the host copy of a vCluster pod by the virtual pod's uid, which the syncer
 * records in an annotation; the uid is matched instead of the rewritten name, which
 * gets truncated and hashed when long.
 */
export async function findHostCopy(hostCore: CoreV1Api, vcluster: string, virtualPod: V1Pod): Promise<V1Pod | undefined> {
  const copies = await listHostCopies(hostCore, vcluster, virtualPod.metadata!.namespace!);
  return copies.find((pod) => pod.metadata?.annotations?.[OBJECT_UID] === virtualPod.metadata?.uid);
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
