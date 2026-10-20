import { describe, expect, it } from 'vitest';
import { deleteIfExists, readOrNull } from '../src/api.js';
import { host, hostNamespace, suffix, tenant } from '../src/clusters.js';
import {
  describePod,
  findHostCopy,
  OBJECT_NAME,
  OBJECT_NAMESPACE,
  OBJECT_UID,
  pausePod,
  waitForPhase,
} from '../src/pods.js';
import { done, LONG_TIMEOUT_MS, pending, poll } from '../src/poll.js';

const VCLUSTER = 'team-a';
const NAMESPACE = 'default';

describe(`pod sync in vCluster ${VCLUSTER}`, () => {
  it('copies a pod to the host, runs it on both sides and removes the host copy on delete', async ({
    onTestFinished,
  }) => {
    const hostCluster = host();
    const virtual = tenant(VCLUSTER);
    const name = `sync-${suffix()}`;

    // A bare pod, not a Deployment: no controller recreates it behind the test's back.
    const created = await virtual.core.createNamespacedPod({ namespace: NAMESPACE, body: pausePod(name) });
    onTestFinished(() =>
      deleteIfExists(() => virtual.core.deleteNamespacedPod({ name, namespace: NAMESPACE, gracePeriodSeconds: 0 })),
    );

    // Stage 1: the syncer creates a copy in the vCluster's host namespace.
    const hostCopy = await poll(`host copy of ${NAMESPACE}/${name} in ${hostNamespace(VCLUSTER)}`, async () => {
      const copy = await findHostCopy(hostCluster.core, VCLUSTER, created);
      return copy ? done(copy) : pending(`no pod with ${OBJECT_UID} ${created.metadata?.uid}`);
    });
    const hostName = hostCopy.metadata!.name!;
    expect(hostCopy.metadata?.annotations?.[OBJECT_NAME], 'host copy points back at the virtual pod').toBe(name);
    expect(hostCopy.metadata?.annotations?.[OBJECT_NAMESPACE]).toBe(NAMESPACE);

    // Stage 2: "synced" and "running" are separate outcomes — check both sides run.
    await waitForPhase(hostCluster.core, 'host', hostName, hostNamespace(VCLUSTER), 'Running', LONG_TIMEOUT_MS);
    await waitForPhase(virtual.core, 'vCluster', name, NAMESPACE, 'Running', LONG_TIMEOUT_MS);

    // Stage 3: deleting in the vCluster removes the host copy.
    await virtual.core.deleteNamespacedPod({ name, namespace: NAMESPACE, gracePeriodSeconds: 0 });
    await poll(`vCluster pod ${NAMESPACE}/${name} to be deleted`, async () => {
      const pod = await readOrNull(() => virtual.core.readNamespacedPod({ name, namespace: NAMESPACE }));
      return pod ? pending(describePod(pod)) : done(undefined);
    });
    await poll(`host copy ${hostName} to be deleted`, async () => {
      const pod = await readOrNull(() =>
        hostCluster.core.readNamespacedPod({ name: hostName, namespace: hostNamespace(VCLUSTER) }),
      );
      return pod ? pending(describePod(pod)) : done(undefined);
    });
  });
});
