import { randomBytes } from 'node:crypto';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';

export const HOST_CONTEXT = 'kind-kind';

/** Host namespace the vCluster CLI installs a vCluster into by default. */
export const hostNamespace = (vcluster: string): string => `vcluster-${vcluster}`;

/** Context name `vcluster connect` writes: `vcluster_<name>_<host namespace>_<host context>`. */
export const vclusterContext = (vcluster: string): string =>
  `vcluster_${vcluster}_${hostNamespace(vcluster)}_${HOST_CONTEXT}`;

export interface Cluster {
  context: string;
  kubeConfig: KubeConfig;
  core: CoreV1Api;
}

/**
 * Builds clients for an explicitly named context. The context is selected on an
 * in-memory copy of the kubeconfig; the kubeconfig file and its current context are
 * left untouched.
 */
export function connect(context: string): Cluster {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  const contextObject = kubeConfig.getContextObject(context);
  if (!contextObject) {
    throw new Error(`kubeconfig has no context "${context}"`);
  }
  kubeConfig.setCurrentContext(context);
  if (!kubeConfig.getCluster(contextObject.cluster)?.server) {
    throw new Error(`context "${context}" points at cluster "${contextObject.cluster}" without a server URL`);
  }
  return { context, kubeConfig, core: kubeConfig.makeApiClient(CoreV1Api) };
}

export const host = (): Cluster => connect(HOST_CONTEXT);
export const tenant = (vcluster: string): Cluster => connect(vclusterContext(vcluster));

/** Short random suffix that keeps names unique per run and valid as DNS labels. */
export const suffix = (): string => randomBytes(3).toString('hex');
