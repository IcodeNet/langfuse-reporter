import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'langfuse-reporter',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
