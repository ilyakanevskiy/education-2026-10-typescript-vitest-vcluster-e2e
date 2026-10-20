# vCluster on `kind` — e2e tests in TypeScript

End-to-end tests for [vCluster](https://github.com/loft-sh/vcluster) running on a local
[`kind`](https://kind.sigs.k8s.io/) host cluster, written with
[`@kubernetes/client-node`](https://github.com/kubernetes-client/javascript) and
[Vitest](https://vitest.dev/).

The tests check what a tenant sees inside a virtual cluster against what actually
happens on the host: pod sync, API isolation between tenants, and the policies of
vCluster's isolation mode.

## Prerequisites

Versions the tests were run with; nearby versions should work too.

| Tool | Version | Notes |
|---|---|---|
| Docker | Docker Desktop 4.94.0 (Engine 29.8.2, Linux containers) | 4 CPUs and ~8 GB of memory are enough for `kind` and three vClusters |
| [`kind`](https://kind.sigs.k8s.io/) | 0.33.0 | Creates a single-node cluster with Kubernetes v1.37.0 |
| [vCluster CLI](https://www.vcluster.com/docs/) | 0.37.3 | Installs vClusters through Helm and downloads Helm itself |
| kubectl | 1.36.1 | Ships with Docker Desktop |
| [Node.js](https://nodejs.org/) | 24.20.0 (LTS) | `@types/node` is pinned to the same major version |

## Test environment

### Why Shared Nodes

vCluster has four architectures: Shared Nodes, Dedicated Nodes, Private Nodes and
Standalone. The tests use **Shared Nodes**, where the tenants' pods run as ordinary
pods in one namespace of the host cluster per vCluster:

- it is the mode where the syncer and the host namespace exist at all — and they are
  exactly what the tests compare the tenant's view against;
- it needs nothing beyond a single `kind` node. Dedicated Nodes need labelled node pools,
  Private Nodes need nodes that join the tenant cluster directly, and Standalone runs
  on bare metal or VMs without a host cluster. Private Nodes do run on a laptop via
  vind (vCluster in Docker), but there is no host cluster there to compare against.

The flip side: Shared Nodes has no node isolation. Pods of different tenants share a
node and its kernel, so these tests cover API isolation and the host-side policies,
not isolation at the node level.

### Setup

A single `kind` node and three vClusters installed with the vCluster CLI's default Helm
driver. Tests use the vClusters as they are and never create or delete them.

| vCluster | Host namespace | Config | kubeconfig context |
|---|---|---|---|
| `team-a` | `vcluster-team-a` | default | `vcluster_team-a_vcluster-team-a_kind-kind` |
| `team-b` | `vcluster-team-b` | default | `vcluster_team-b_vcluster-team-b_kind-kind` |
| `iso` | `vcluster-iso` | [`manual/isolation.yaml`](manual/isolation.yaml) | `vcluster_iso_vcluster-iso_kind-kind` |

The host context is `kind-kind`.

```shell
kind create cluster
vcluster create team-a
vcluster disconnect
vcluster create team-b
vcluster disconnect
vcluster create iso -f manual/isolation.yaml
vcluster disconnect
```

`vcluster create` waits for the vCluster, writes its context and switches to it;
`vcluster disconnect` switches back to `kind-kind`. On Docker Desktop the vCluster
contexts point at proxy containers the CLI starts; after a Docker restart, run
`vcluster connect <name>` and `vcluster disconnect` again.

`manual/` also holds the manifests used for the manual checks before the tests were
written.

## Tests

| File | Test |
|---|---|
| [`sync.test.ts`](test/sync.test.ts) — pod sync in `team-a` | A pod created in the vCluster gets a copy in the host namespace, both reach `Running`, and deleting the pod in the vCluster removes the host copy |
| [`tenants.test.ts`](test/tenants.test.ts) — isolation between `team-a` and `team-b` | A namespace created in `team-a` is not visible in `team-b` |
| | `team-b`'s syncer service account may list pods in its own host namespace, but neither list pods nor read secrets in `team-a`'s (SubjectAccessReview) |
| | A CRD installed in `team-a` exists neither in `team-b` nor on the host |
| | A namespace with a pod created directly on the host shows up in neither tenant |
| [`isolation.test.ts`](test/isolation.test.ts) — isolation mode in `iso` | The host namespace has the vCluster's ResourceQuota, LimitRange and NetworkPolicy |
| | Existing and new namespaces carry `pod-security.kubernetes.io/enforce=baseline` |
| | A plain pod runs; a pod requesting more cpu than the default limit is accepted by the vCluster but never synced to the host — a `SyncError` event names the LimitRange violation |
| | A privileged pod is rejected by the vCluster's API server with 403 and exists on neither side |

Each test creates its resources under a random suffix and removes them afterwards,
also when it fails. Files run one after another, since they share the same clusters.

## Run

```shell
npm ci
npm test
```
