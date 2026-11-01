import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'] } },
      {
        // Needs DATABASE_URL pointing at a disposable database with migrations applied.
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
