/** Writes docs/openapi.json from the Zod contracts (GAP-05): npm run openapi -w @pm/api */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../src/openapi/spec.js';

const target = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`wrote ${target}`);
