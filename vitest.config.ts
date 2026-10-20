import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // All files talk to the same host cluster and vClusters.
    fileParallelism: false,
    // Above the sum of the poll timeouts in any one test (330 s in sync.test.ts), so a
    // poll's own timeout, which names the last state seen, fires before Vitest's.
    testTimeout: 400_000,
    hookTimeout: 60_000,
  },
});
