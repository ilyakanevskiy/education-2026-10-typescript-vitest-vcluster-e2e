import { connect, HOST_CONTEXT, vclusterContext } from '../src/clusters.js';

const VCLUSTERS = ['team-a', 'team-b', 'iso'];

/**
 * Runs once before all test files: checks that the host and every vCluster answer, so
 * a missing or stopped vCluster fails the run with what to do instead of a bare
 * connection error inside a test.
 */
export default async function preflight(): Promise<void> {
  const problems: string[] = [];
  const check = async (context: string, hint: string): Promise<void> => {
    try {
      await connect(context).core.readNamespace({ name: 'default' });
    } catch (error) {
      problems.push(`${context}: ${error instanceof Error ? error.message : String(error)}\n  ${hint}`);
    }
  };
  await check(HOST_CONTEXT, 'create it with `kind create cluster`');
  for (const name of VCLUSTERS) {
    await check(
      vclusterContext(name),
      `create it with \`vcluster create ${name}\`, or after a Docker restart run \`vcluster connect ${name}\` and \`vcluster disconnect\``,
    );
  }
  if (problems.length > 0) {
    throw new Error(`test environment is not ready (see README, Setup):\n${problems.join('\n')}`);
  }
}
