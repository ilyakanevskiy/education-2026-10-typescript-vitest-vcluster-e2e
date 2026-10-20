import { NetworkingV1Api, type CoreV1Event } from '@kubernetes/client-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { deleteIfExists, readOrNull, rejection } from '../src/api.js';
import { host, hostNamespace, suffix, tenant, type Cluster } from '../src/clusters.js';
import {
  describePod,
  findHostCopy,
  listHostCopies,
  OBJECT_NAME,
  PAUSE_IMAGE,
  pausePod,
  waitForPhase,
} from '../src/pods.js';
import { done, LONG_TIMEOUT_MS, pending, poll } from '../src/poll.js';

// The vCluster created from manual/isolation.yaml.
const VCLUSTER = 'iso';
const NAMESPACE = 'default';
const PSS_ENFORCE = 'pod-security.kubernetes.io/enforce';

describe(`isolation mode in vCluster ${VCLUSTER}`, () => {
  let hostCluster: Cluster;
  let virtual: Cluster;

  beforeAll(() => {
    hostCluster = host();
    virtual = tenant(VCLUSTER);
  });

  it('creates a ResourceQuota, a LimitRange and a NetworkPolicy in the host namespace', async () => {
    const namespace = hostNamespace(VCLUSTER);
    const networking = hostCluster.kubeConfig.makeApiClient(NetworkingV1Api);

    const quota = await readOrNull(() => hostCluster.core.readNamespacedResourceQuota({ name: `vc-${VCLUSTER}`, namespace }));
    const limits = await readOrNull(() => hostCluster.core.readNamespacedLimitRange({ name: `vc-${VCLUSTER}`, namespace }));
    const workloads = await readOrNull(() =>
      networking.readNamespacedNetworkPolicy({ name: `vc-work-${VCLUSTER}`, namespace }),
    );

    expect(quota, `ResourceQuota vc-${VCLUSTER} in ${namespace}`).not.toBeNull();
    expect(limits, `LimitRange vc-${VCLUSTER} in ${namespace}`).not.toBeNull();
    expect(workloads, `NetworkPolicy vc-work-${VCLUSTER} in ${namespace}`).not.toBeNull();
  });

  it('enforces the baseline Pod Security Standard on existing and new namespaces', async ({ onTestFinished }) => {
    const existing = await virtual.core.readNamespace({ name: NAMESPACE });
    expect(existing.metadata?.labels?.[PSS_ENFORCE], `${PSS_ENFORCE} on ${NAMESPACE}`).toBe('baseline');

    const name = `pss-${suffix()}`;
    await virtual.core.createNamespace({ body: { metadata: { name } } });
    onTestFinished(() => deleteIfExists(() => virtual.core.deleteNamespace({ name })));

    // The label is added after the namespace is created, so wait for it.
    await poll(`${PSS_ENFORCE}=baseline on new namespace ${name}`, async () => {
      const created = await virtual.core.readNamespace({ name });
      const value = created.metadata?.labels?.[PSS_ENFORCE];
      return value === 'baseline' ? done(undefined) : pending(`${PSS_ENFORCE}=${value ?? '<none>'}`);
    });
  });

  it('runs a plain pod but never syncs a pod whose cpu request exceeds the default limit', async ({
    onTestFinished,
  }) => {
    // Control: without it, "the heavy pod didn't start" could mean anything (image, node capacity).
    const okName = `ok-${suffix()}`;
    const ok = await virtual.core.createNamespacedPod({ namespace: NAMESPACE, body: pausePod(okName) });
    onTestFinished(() =>
      deleteIfExists(() => virtual.core.deleteNamespacedPod({ name: okName, namespace: NAMESPACE, gracePeriodSeconds: 0 })),
    );
    await waitForPhase(virtual.core, 'vCluster', okName, NAMESPACE, 'Running', LONG_TIMEOUT_MS);
    // The lookup finds the control's copy, so its finding none for the heavy pod means something.
    expect(await findHostCopy(hostCluster.core, VCLUSTER, ok), 'host copy of the plain pod').toBeDefined();

    // The virtual API server accepts the pod; the host's LimitRange rejects its copy.
    const heavyName = `heavy-${suffix()}`;
    const heavy = await virtual.core.createNamespacedPod({
      namespace: NAMESPACE,
      body: pausePod(heavyName, {
        containers: [{ name: 'pause', image: PAUSE_IMAGE, resources: { requests: { cpu: '2' } } }],
      }),
    });
    onTestFinished(() =>
      deleteIfExists(() =>
        virtual.core.deleteNamespacedPod({ name: heavyName, namespace: NAMESPACE, gracePeriodSeconds: 0 }),
      ),
    );

    // SyncError also covers transient failures the syncer retries (e.g. an update
    // conflict), so the reason alone doesn't identify the LimitRange rejection.
    const limitViolation = 'must be less than or equal to cpu limit';
    const syncError = await poll(`SyncError event "${limitViolation}" for pod ${heavyName}`, async () => {
      const events = await virtual.core.listNamespacedEvent({
        namespace: NAMESPACE,
        fieldSelector: `involvedObject.kind=Pod,involvedObject.name=${heavyName}`,
      });
      const found = events.items.find(
        (e: CoreV1Event) => e.reason === 'SyncError' && e.message?.includes(limitViolation),
      );
      return found
        ? done(found)
        : pending(`events: [${events.items.map((e) => `${e.reason}: ${e.message}`).join('; ')}]`);
    });
    expect(syncError.type).toBe('Warning');

    const current = await virtual.core.readNamespacedPod({ name: heavyName, namespace: NAMESPACE });
    expect(current.status?.phase, describePod(current)).toBe('Pending');
    expect(await findHostCopy(hostCluster.core, VCLUSTER, heavy), 'host copy of the heavy pod').toBeUndefined();
  });

  it('rejects a privileged pod at the virtual API server', async ({ onTestFinished }) => {
    const name = `priv-${suffix()}`;
    // Cleanup in case the rejection regresses and the pod gets created.
    onTestFinished(() =>
      deleteIfExists(() => virtual.core.deleteNamespacedPod({ name, namespace: NAMESPACE, gracePeriodSeconds: 0 })),
    );

    const status = await rejection(() =>
      virtual.core.createNamespacedPod({
        namespace: NAMESPACE,
        body: pausePod(name, {
          containers: [{ name: 'pause', image: PAUSE_IMAGE, securityContext: { privileged: true } }],
        }),
      }),
    );
    expect(status.code).toBe(403);
    expect(status.reason).toBe('Forbidden');
    expect(status.message, 'rejected by PodSecurity admission').toContain('violates PodSecurity "baseline');

    expect(await readOrNull(() => virtual.core.readNamespacedPod({ name, namespace: NAMESPACE })), 'pod in the vCluster').toBeNull();
    const onHost = await listHostCopies(hostCluster.core, VCLUSTER, NAMESPACE);
    const copies = onHost.filter((p) => p.metadata?.annotations?.[OBJECT_NAME] === name);
    expect(copies.map((p) => p.metadata?.name), 'host copies of the privileged pod').toEqual([]);
  });
});
