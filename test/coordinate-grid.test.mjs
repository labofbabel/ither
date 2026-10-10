import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CoordinateGrid } from '../src/query/CoordinateGrid.js';
import { assertWalker } from '../src/query/Walker.js';

// the in-range coordinates a walker yields from an offset
const points = (walker, offset = 0n) => [...walker.entries({ offset })].filter(entry => 'coordinate' in entry).map(entry => entry.coordinate);

test('a grid satisfies the walker protocol', () => {
   const grid = new CoordinateGrid({ bounds: [4n, 3n], axes: [{ start: 0n, end: 3n }, { start: 0n, end: 2n }] });
   assert.equal(assertWalker(grid, { axisCount: 2, bounds: [4n, 3n] }), grid);
   for (const name of ['at', 'iterate']) assert.equal(name in grid, false, `one way to walk: entries (${name})`);
});

test('enumerates inclusive single-axis ranges, including one-point axes', () => {
   const full = new CoordinateGrid({ bounds: [6n], axes: [{ start: 0n, end: 5n }] });
   assert.equal(full.axisCount, 1);
   assert.equal(full.count, 6n);
   assert.deepEqual(points(full), [[0n], [1n], [2n], [3n], [4n], [5n]]);

   const point = new CoordinateGrid({ bounds: [6n], axes: [{ start: 4n, end: 4n }] });
   assert.equal(point.count, 1n);
   assert.deepEqual(points(point), [[4n]]);
});

test('each axis has its own step, 1 by default; the first value is start', () => {
   const grid = new CoordinateGrid({
      bounds: [10n, 10n],
      axes: [{ start: 1n, end: 9n, step: 3n }, { start: 3n, end: 9n, step: 4n }],
   });
   assert.deepEqual(grid.axisCounts, [3n, 2n]);
   assert.equal(grid.count, 6n);
   assert.deepEqual(points(grid), [[1n, 3n], [1n, 7n], [4n, 3n], [4n, 7n], [7n, 3n], [7n, 7n]]);
   assert.deepEqual(grid.box(), [{ min: 1n, max: 7n }, { min: 3n, max: 7n }]);
});

test('enumerates four axes with the last axis advancing fastest', () => {
   const grid = new CoordinateGrid({
      bounds: [3n, 4n, 5n, 6n],
      axes: [{ start: 0n, end: 1n }, { start: 1n, end: 3n }, { start: 2n, end: 3n }, { start: 4n, end: 5n }],
   });
   const all = points(grid);
   assert.equal(grid.count, 24n);
   assert.deepEqual(all[0], [0n, 1n, 2n, 4n]);
   assert.deepEqual(all[1], [0n, 1n, 2n, 5n]);
   assert.deepEqual(all[2], [0n, 1n, 3n, 4n]);
   assert.deepEqual(all[23], [1n, 3n, 3n, 5n]);
});

test('walking from any offset matches the uninterrupted walk', () => {
   const grid = new CoordinateGrid({
      bounds: [12n, 15n, 9n],
      axes: [{ start: 1n, end: 11n, step: 3n }, { start: 3n, end: 14n, step: 4n }, { start: 0n, end: 8n, step: 2n }],
   });
   const all = points(grid);
   assert.equal(BigInt(all.length), grid.count);
   for (const offset of [0n, 1n, 17n, grid.count - 1n, grid.count]) assert.deepEqual(points(grid, offset), all.slice(Number(offset)));
});

test('uses finite axis extents on axes with no known Space bound', () => {
   const grid = new CoordinateGrid({ bounds: [null, 5n], axes: [{ start: 100n, end: 104n, step: 2n }, { start: 1n, end: 2n }] });
   assert.equal(grid.count, 6n);
   assert.deepEqual(points(grid), [[100n, 1n], [100n, 2n], [102n, 1n], [102n, 2n], [104n, 1n], [104n, 2n]]);
   assert.equal(grid.total(), 6n);
});

test('keeps huge counts and coordinates exact without materializing', () => {
   const bound = 10n ** 30n;
   const grid = new CoordinateGrid({ bounds: [bound, bound], axes: [{ start: 0n, end: bound - 1n }, { start: 0n, end: bound - 1n }] });
   assert.equal(grid.count, bound * bound);
   assert.deepEqual(points(grid, grid.count - 2n), [[bound - 1n, bound - 2n], [bound - 1n, bound - 1n]]);
   assert.equal(grid.total(grid.count - 2n), 2n);
});

test('copies its specification and yields fresh coordinate arrays', () => {
   const bounds = [4n, 4n];
   const axes = [{ start: 0n, end: 1n }, { start: 0n, end: 1n }];
   const grid = new CoordinateGrid({ bounds, axes });
   bounds[0] = 99n;
   axes[0].end = 3n;
   assert.deepEqual(grid.bounds, [4n, 4n]);
   assert.equal(grid.count, 4n);

   const iterator = grid.entries();
   iterator.next().value.coordinate[0] = 99n;
   assert.deepEqual(iterator.next().value.coordinate, [0n, 1n]);
   assert.deepEqual(points(grid)[0], [0n, 0n]);
});

test('intersects each axis with its bound and reports the rest as out-of-range runs', () => {
   const grid = new CoordinateGrid({ bounds: [4n, null], axes: [{ start: 2n, end: 6n }, { start: 0n, end: 1n }] });
   assert.equal(grid.count, 10n);
   assert.equal(grid.total(), 4n);
   assert.equal(grid.total(3n), 1n);
   assert.equal(grid.total(0n, 3n), 3n);
   assert.deepEqual([...grid.entries()], [
      { ordinal: 0n, coordinate: [2n, 0n] },
      { ordinal: 1n, coordinate: [2n, 1n] },
      { ordinal: 2n, coordinate: [3n, 0n] },
      { ordinal: 3n, coordinate: [3n, 1n] },
      { ordinal: 4n, outside: 6n },
   ]);
});

test('walks ranges that depend on another axis, skipping each narrowed range in one run', () => {
   // axis 1's range is axis 0's value: nothing at 0, one value at 1, two at 2
   const calls = [];
   const grid = new CoordinateGrid({
      bounds: [null, null],
      axes: [{ start: 0n, end: 2n }, { start: 0n, end: 3n }],
      dependencies: [[], [0]],
      ranges: coordinate => { calls.push(coordinate[0]); return [null, coordinate[0]]; },
   });

   assert.equal(grid.total(), null);
   assert.deepEqual([...grid.entries()], [
      { ordinal: 0n, outside: 4n },
      { ordinal: 4n, coordinate: [1n, 0n] },
      { ordinal: 5n, outside: 3n },
      { ordinal: 8n, coordinate: [2n, 0n] },
      { ordinal: 9n, coordinate: [2n, 1n] },
      { ordinal: 10n, outside: 2n },
   ]);
   assert.deepEqual(calls, [0n, 1n, 2n], 'ranges are resolved once per value of the axis they depend on');
   assert.deepEqual([...grid.entries({ offset: 5n })][0], { ordinal: 5n, outside: 3n });
});

test('rejects malformed grid specifications, including the removed phase and top-level step', () => {
   const invalid = [
      () => new CoordinateGrid(),
      () => new CoordinateGrid({ bounds: [], axes: [] }),
      () => new CoordinateGrid({ bounds: [undefined], axes: [{ start: 0n, end: 0n }] }),
      () => new CoordinateGrid({ bounds: [4], axes: [{ start: 0n, end: 0n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ end: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0, end: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: -1n, end: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 2n, end: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n, 4n], axes: [{ start: 0n, end: 1n }, { start: 0n, end: 1n }], dependencies: [[], [0]] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n }], dependencies: [[0]], ranges: () => [4n] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n }], ranges: [4n] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n }], step: 2n }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n, step: 0n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n, phase: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n, typo: 1n }] }),
      () => new CoordinateGrid({ bounds: [4n], axes: [{ start: 0n, end: 1n }], typo: true }),
   ];
   for (const construct of invalid) assert.throws(construct, { name: /TypeError|RangeError/ });
});

test('validates walk offsets without silently coercing values', () => {
   const grid = new CoordinateGrid({ bounds: [3n], axes: [{ start: 0n, end: 2n }] });
   assert.throws(() => grid.entries({ offset: 0 }), TypeError);
   assert.throws(() => grid.entries({ offset: 4n }), RangeError);
   assert.throws(() => grid.entries({ typo: 1n }), TypeError);
   assert.throws(() => grid.total(0n, 4n), RangeError);
   assert.throws(() => grid.total(2n, 1n), RangeError);
});

test('the grid module imports only the walker protocol', async () => {
   const source = await readFile(new URL('../src/query/CoordinateGrid.js', import.meta.url), 'utf8');
   assert.deepEqual([...source.matchAll(/^\s*import\s.*from\s+'([^']+)'/gm)].map(match => match[1]), ['./Walker.js']);
});
