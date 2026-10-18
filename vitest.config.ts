import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'langfuse-reporter',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
