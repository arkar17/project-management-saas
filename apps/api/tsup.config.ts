import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // @pm/shared ships TypeScript source, so it is bundled; other dependencies stay external.
  noExternal: ['@pm/shared'],
});
