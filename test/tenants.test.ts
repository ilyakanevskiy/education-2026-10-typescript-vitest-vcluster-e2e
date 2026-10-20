import {
  ApiextensionsV1Api,
  AuthorizationV1Api,
  type V1CustomResourceDefinition,
} from '@kubernetes/client-node';
import { beforeAll, describe, expect, it } from 'vitest';
import { deleteIfExists, readOrNull } from '../src/api.js';
import { host, hostNamespace, suffix, tenant, type Cluster } from '../src/clusters.js';
import { pausePod, waitForPhase } from '../src/pods.js';
import { done, LONG_TIMEOUT_MS, pending, poll } from '../src/poll.js';

const TENANT_A = 'team-a';
const TENANT_B = 'team-b';

describe(`isolation between tenants ${TENANT_A} and ${TENANT_B}`, () => {
  let hostCluster: Cluster;
  let a: Cluster;
  let b: Cluster;

  beforeAll(() => {
    hostCluster = host();
    a = tenant(TENANT_A);
    b = tenant(TENANT_B);
    // Without this, a "not visible in B" result could come from B's context pointing at A.
    if (a.server === b.server) {
      throw new Error(`contexts ${a.context} and ${b.context} share the server ${a.server}`);
    }
  });

  it(`a namespace created in ${TENANT_A} is not visible in ${TENANT_B}`, async ({ onTestFinished }) => {
    const name = `tenant-${suffix()}`;
    await a.core.createNamespace({ body: { metadata: { name } } });
    onTestFinished(() => deleteIfExists(() => a.core.deleteNamespace({ name })));

    const inA = await readOrNull(() => a.core.readNamespace({ name }));
    expect(inA?.metadata?.name, `namespace ${name} in ${TENANT_A}`).toBe(name);
    const inB = await readOrNull(() => b.core.readNamespace({ name }));
    expect(inB, `namespace ${name} in ${TENANT_B}`).toBeNull();
  });

  it(`the syncer of ${TENANT_B} is allowed into its own host namespace only`, async () => {
    const authorization = hostCluster.kubeConfig.makeApiClient(AuthorizationV1Api);
    const ownNamespace = hostNamespace(TENANT_B);
    const serviceAccount = `vc-${TENANT_B}`;

    const can = async (verb: string, resource: string, namespace: string): Promise<boolean> => {
      const review = await authorization.createSubjectAccessReview({
        body: {
          spec: {
            user: `system:serviceaccount:${ownNamespace}:${serviceAccount}`,
            // The groups the API server attaches to a service account token.
            groups: ['system:serviceaccounts', `system:serviceaccounts:${ownNamespace}`, 'system:authenticated'],
            resourceAttributes: { verb, resource, namespace },
          },
        },
      });
      return review.status!.allowed;
    };

    expect(await can('list', 'pods', ownNamespace), `list pods in ${ownNamespace}`).toBe(true);
    expect(await can('list', 'pods', hostNamespace(TENANT_A)), `list pods in ${hostNamespace(TENANT_A)}`).toBe(false);
    expect(await can('get', 'secrets', hostNamespace(TENANT_A)), `get secrets in ${hostNamespace(TENANT_A)}`).toBe(false);
  });

  it(`a CRD installed in ${TENANT_A} exists neither in ${TENANT_B} nor on the host`, async ({ onTestFinished }) => {
    const group = `${suffix()}.e2e.local`;
    const name = `widgets.${group}`;
    const crd: V1CustomResourceDefinition = {
      metadata: { name },
      spec: {
        group,
        scope: 'Namespaced',
        names: { plural: 'widgets', singular: 'widget', kind: 'Widget' },
        versions: [
          {
            name: 'v1',
            served: true,
            storage: true,
            schema: { openAPIV3Schema: { type: 'object', x_kubernetes_preserve_unknown_fields: true } },
          },
        ],
      },
    };
    const extensions = (cluster: Cluster) => cluster.kubeConfig.makeApiClient(ApiextensionsV1Api);

    await extensions(a).createCustomResourceDefinition({ body: crd });
    onTestFinished(() => deleteIfExists(() => extensions(a).deleteCustomResourceDefinition({ name })));

    await poll(`CRD ${name} to become Established in ${TENANT_A}`, async () => {
      const current = await readOrNull(() => extensions(a).readCustomResourceDefinition({ name }));
      if (!current) return pending('404');
      const established = current.status?.conditions?.find((c) => c.type === 'Established');
      return established?.status === 'True'
        ? done(undefined)
        : pending(`Established=${established?.status ?? '<none>'}`);
    });

    expect(await readOrNull(() => extensions(b).readCustomResourceDefinition({ name })), `CRD in ${TENANT_B}`).toBeNull();
    expect(await readOrNull(() => extensions(hostCluster).readCustomResourceDefinition({ name })), 'CRD on the host').toBeNull();
  });

  it('a workload created directly on the host does not show up in any tenant', async ({ onTestFinished }) => {
    const id = suffix();
    const namespace = `host-only-${id}`;
    const name = 'workload';
    const label = `e2e.local/host-only=${id}`;

    await hostCluster.core.createNamespace({ body: { metadata: { name: namespace } } });
    onTestFinished(() => deleteIfExists(() => hostCluster.core.deleteNamespace({ name: namespace })));
    const pod = pausePod(name);
    pod.metadata!.labels = { 'e2e.local/host-only': id };
    await hostCluster.core.createNamespacedPod({ namespace, body: pod });
    // Running on the host gives a sync from the host, if there were one, time to happen.
    await waitForPhase(hostCluster.core, 'host', name, namespace, 'Running', LONG_TIMEOUT_MS);
    const onHost = await hostCluster.core.listPodForAllNamespaces({ labelSelector: label });
    expect(onHost.items.map((p) => p.metadata?.name), `pods labelled ${label} on the host`).toEqual([name]);

    for (const t of [a, b]) {
      expect(await readOrNull(() => t.core.readNamespace({ name: namespace })), `namespace ${namespace} via ${t.context}`).toBeNull();
      const pods = await t.core.listPodForAllNamespaces({ labelSelector: label });
      expect(pods.items.map((p) => `${p.metadata?.namespace}/${p.metadata?.name}`), `pods labelled ${label} via ${t.context}`).toEqual([]);
    }
  });
});
