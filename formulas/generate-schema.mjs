// Regenerate formulas/formula.schema.json from the live Capabilities export.
//   node formulas/generate-schema.mjs
// (Run this whenever the rules table in src/formula/FormulaRules.js changes;
// test/formula.test.mjs fails while the copy is stale.)

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formulaSchema } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'formula.schema.json');
const text = JSON.stringify(formulaSchema(), null, 2) + '\n';
writeFileSync(out, text);
console.log(`wrote ${out}  (${text.length} chars)`);
