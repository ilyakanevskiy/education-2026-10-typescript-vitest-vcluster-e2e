# vCluster on kind — e2e tests in TypeScript

End-to-end tests for [vCluster](https://github.com/loft-sh/vcluster) running on a local
[kind](https://kind.sigs.k8s.io/) host cluster, written with
[`@kubernetes/client-node`](https://github.com/kubernetes-client/javascript) and
[Vitest](https://vitest.dev/).

The tests check what a tenant sees inside a virtual cluster against what actually
happens on the host: pod sync, API isolation between tenants, and the policies of
vCluster's isolation mode.

## Test environment

Shared-nodes mode: a single kind node, three vClusters installed with the vCluster
CLI's default Helm driver. Tests use the vClusters as they are and never create or
delete them.

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
`vcluster disconnect` switches back to `kind-kind`. On Docker Desktop the vCluster contexts point at proxy containers the
CLI starts; after a Docker restart, run `vcluster connect <name>` and
`vcluster disconnect` again.

`manual/` also holds the manifests used for the manual checks before the tests were
written.

## Run

```shell
npm ci
npm test
```
