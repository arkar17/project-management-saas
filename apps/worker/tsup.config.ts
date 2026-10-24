import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // @pm/api and @pm/shared ship TypeScript source, so they are bundled; their third-party
  // dependencies stay external and resolve from the workspace node_modules at runtime.
  noExternal: [/^@pm\//],
  external: [/^(?!@pm\/)[a-z@]/],
});
