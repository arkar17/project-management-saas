import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, OPERATIONS } from '../../src/openapi/spec.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Every `router.<method>('<path>'` in the route modules (multi-line calls included). */
function sourceRoutes() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.routes.ts')) files.push(p);
    }
  };
  walk(join(root, 'src/modules'));
  const out: { method: string; path: string }[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']*)'/g)) {
      out.push({ method: m[1]!, path: m[2]!.replace(/:(\w+)/g, '{$1}').replace(/\/$/, '') });
    }
  }
  return out;
}

describe('GAP-05 OpenAPI contract', () => {
  it('documents every implemented route exactly once', () => {
    const routes = sourceRoutes();
    expect(OPERATIONS).toHaveLength(routes.length);
    const keys = OPERATIONS.map((o) => `${o.method} ${o.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of routes) {
      // Routers are mounted under prefixes, so a spec path must end with the local path.
      const found = OPERATIONS.some(
        (o) => o.method === r.method && (r.path === '' || o.path.endsWith(r.path)),
      );
      expect(found, `${r.method} ${r.path || '/'} is not in the OpenAPI spec`).toBe(true);
    }
  });

  it('is valid-looking OpenAPI 3.1 and docs/openapi.json is up to date', () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe('3.1.0');
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const op of Object.values(ops) as {
        responses: object;
        parameters: { name: string }[];
      }[]) {
        expect(Object.keys(op.responses).length, path).toBeGreaterThan(0);
        for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
          expect(
            op.parameters.some((p) => p.name === name),
            `${path} ${name}`,
          ).toBe(true);
        }
      }
    }
    const committed = JSON.parse(readFileSync(join(root, '../../docs/openapi.json'), 'utf8'));
    expect(committed, 'run: npm run openapi -w @pm/api').toEqual(JSON.parse(JSON.stringify(spec)));
  });
});
