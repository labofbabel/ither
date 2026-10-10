import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as source from '../src/index.js';
import * as bundled from '../dist/ither.min.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('tracked distribution matches the source export and version contract', () => {
   assert.equal(source.Ither.version, packageJson.version);
   assert.equal(bundled.Ither.version, packageJson.version);
   assert.deepEqual(Object.keys(bundled).sort(), Object.keys(source).sort());
});

test('tracked distribution exposes the callable workflow facade', async () => {
   const result = await bundled.Ither({
      space: { layers: { value: { type: 'OBJ', domains: { value: ['a', 'b'] } } } },
   });
   assert.deepEqual(Object.keys(result), ['space']);
   assert.deepEqual(result.space.decode([1n]), { value: { value: 'b' } });
   assert.equal('query' in result.space, false);
});
