import test from 'node:test';
import assert from 'node:assert/strict';

import { CoordinateRay } from '../src/query/CoordinateRay.js';
import { CoordinateList } from '../src/query/CoordinateList.js';
import { assertWalker } from '../src/query/Walker.js';

const points = (walker, offset = 0n) => [...walker.entries({ offset })].filter(entry => 'coordinate' in entry).map(entry => entry.coordinate);

test('enumerates a finite integer ray over any number of axes: point k = start + direction · k', () => {
   const ray = new CoordinateRay({ bounds: [20n, null, 20n], start: [2n, 10n, 8n], direction: [2n, 4n, -2n], count: 5n });
   assert.equal(assertWalker(ray), ray);
   assert.equal(ray.count, 5n);
   assert.deepEqual(points(ray), [[2n, 10n, 8n], [4n, 14n, 6n], [6n, 18n, 4n], [8n, 22n, 2n], [10n, 26n, 0n]]);
   assert.equal(ray.total(), null, 'an axis with no bound and no constant range: unknown');
   assert.deepEqual(ray.box(), [{ min: 2n, max: 10n }, { min: 10n, max: 26n }, { min: 0n, max: 8n }]);
});

test('a ray past a limit or below zero yields at most two outside runs around one interval', () => {
   const ray = new CoordinateRay({ bounds: [10n], start: [12n], direction: [-3n], count: 7n });
   // k: 0 12 · 1 9 · 2 6 · 3 3 · 4 0 · 5 -3 · 6 -6
   assert.deepEqual([...ray.entries()], [
      { ordinal: 0n, outside: 1n },
      { ordinal: 1n, coordinate: [9n] },
      { ordinal: 2n, coordinate: [6n] },
      { ordinal: 3n, coordinate: [3n] },
      { ordinal: 4n, coordinate: [0n] },
      { ordinal: 5n, outside: 2n },
   ]);
   assert.equal(ray.total(), null, 'without constant ranges, only the fixed bound is known');
   const known = new CoordinateRay({ bounds: [10n], ranges: [10n], start: [12n], direction: [-3n], count: 7n });
   assert.equal(known.total(), 4n);
   assert.equal(known.total(2n, 5n), 3n);
   assert.deepEqual([...ray.entries({ offset: 5n })], [{ ordinal: 5n, outside: 2n }]);

   const never = new CoordinateRay({ bounds: [4n, 4n], ranges: [4n, 4n], start: [5n, 0n], direction: [0n, 1n], count: 3n });
   assert.deepEqual([...never.entries()], [{ ordinal: 0n, outside: 3n }]);
   assert.equal(never.total(), 0n);
});

test('supports exact walks from huge ordinals', () => {
   const count = 10n ** 24n;
   const ray = new CoordinateRay({ bounds: [null], start: [7n], direction: [3n], count });
   assert.deepEqual(points(ray, count - 2n), [[7n + 3n * (count - 2n)], [7n + 3n * (count - 1n)]]);
});

test('rejects malformed rays, including the removed step', () => {
   const invalid = [
      () => new CoordinateRay({ bounds: [null], start: [-1n], direction: [1n], count: 4n }),
      () => new CoordinateRay({ bounds: [10n], start: [0n], direction: [0n], count: 2n }),
      () => new CoordinateRay({ bounds: [10n], start: [0n, 1n], direction: [1n], count: 2n }),
      () => new CoordinateRay({ bounds: [10n], start: [0n], direction: [1], count: 2n }),
      () => new CoordinateRay({ bounds: [10n], start: [0n], direction: [1n], step: 2n, count: 2n }),
      () => new CoordinateRay({ bounds: [10n], start: [0n], direction: [1n], count: -1n }),
   ];
   for (const construct of invalid) assert.throws(construct, { name: /TypeError|RangeError/ });
});

test('a list walks explicit coordinates, reporting each out-of-limit one as outside', () => {
   const list = new CoordinateList({ bounds: [4n, null], ranges: [4n, 2n], coordinates: [[0n, 0n], [4n, 0n], [-1n, 1n], [3n, 1n], [3n, 2n]] });
   assert.equal(assertWalker(list), list);
   assert.deepEqual([...list.entries()], [
      { ordinal: 0n, coordinate: [0n, 0n] },
      { ordinal: 1n, outside: 1n },
      { ordinal: 2n, outside: 1n },
      { ordinal: 3n, coordinate: [3n, 1n] },
      { ordinal: 4n, outside: 1n },
   ]);
   assert.equal(list.total(), 2n);
   assert.equal(list.total(1n, 3n), 0n);
   assert.deepEqual(list.box(), [{ min: -1n, max: 4n }, { min: 0n, max: 2n }]);
   assert.throws(() => new CoordinateList({ bounds: [4n], coordinates: [[0n, 1n]] }), TypeError);
   assert.throws(() => new CoordinateList({ bounds: [4n], coordinates: [[0]] }), TypeError);
});
