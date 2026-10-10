import test from 'node:test';
import assert from 'node:assert/strict';

import { Ither } from '../src/index.js';
import { CoordinateGrid } from '../src/query/CoordinateGrid.js';
import { WalkerError, assertWalker } from '../src/query/Walker.js';
import { SpaceQuery } from '../src/query/SpaceQuery.js';
import { DEFAULT_POLICY } from '../src/query/Query.js';

function listWalker(bounds, coordinates, overrides = {}) {
   const walker = {
      axisCount: bounds.length,
      bounds: bounds.slice(),
      count: BigInt(coordinates.length),
      entries({ offset = 0n } = {}) {
         const self = this;
         return (function* () {
            for (let i = offset; i < self.count; i++) yield { ordinal: i, coordinate: coordinates[Number(i)].slice() };
         })();
      },
      total(offset = 0n, end = this.count) { return end - offset; },
   };
   return Object.assign(walker, overrides);
}

const walk = (query, offset = 0n, end = query.count, policy = DEFAULT_POLICY) => [...query.iterate({ offset, end, policy })];

function twoDimensionalSpace() {
   return Ither.from({
      layers: { point: { type: 'NUM', domains: { x: { min: 0, max: 1, steps: 4 }, y: { min: 0, max: 1, steps: 3 } } } },
      projection: [['point.x'], ['point.y']],
   });
}

test('queries a real projected Space lazily and preserves exact coordinates', () => {
   const space = twoDimensionalSpace();
   const grid = new CoordinateGrid({ bounds: space.axisBounds(), axes: [{ start: 1n, end: 3n }, { start: 0n, end: 2n, step: 2n }] });
   const records = walk(new SpaceQuery(space, grid, 'decode'));
   assert.deepEqual(records.map(record => record.ordinal), [0n, 1n, 2n, 3n, 4n, 5n]);
   assert.deepEqual(records.map(record => record.coordinate), [[1n, 0n], [1n, 2n], [2n, 0n], [2n, 2n], [3n, 0n], [3n, 2n]]);
   assert.ok(records.every(record => record.status === 'structure'));
   for (const record of records) assert.deepEqual(space.encode(record.structure), record.coordinate);
});

test('represents structures, holes, and decode errors without aborting the sequence', () => {
   const space = {
      axisCount: 1,
      axisBounds: () => [5n],
      decode([coordinate]) {
         if (coordinate === 1n) return Ither.HOLE;
         if (coordinate === 2n) throw new RangeError('injected decode failure');
         return `structure-${coordinate}`;
      },
   };
   const grid = new CoordinateGrid({ bounds: [5n], axes: [{ start: 0n, end: 4n }] });
   const records = walk(new SpaceQuery(space, grid, 'decode'));
   assert.deepEqual(records.map(record => record.status), ['structure', 'hole', 'error', 'structure', 'structure']);
   assert.equal(records[0].structure, 'structure-0');
   assert.equal('structure' in records[1], false);
   assert.deepEqual(records[2].error, { name: 'RangeError', message: 'injected decode failure' });

   const omitting = walk(new SpaceQuery(space, grid, 'decode'), 0n, 5n, { hole: 'omit', outside: 'omit' });
   assert.deepEqual(omitting[1], { ordinal: 1n, omitted: 'hole', length: 1n });
});

test('an OUTSIDE decode is an omission, and outside runs are clipped to the page', () => {
   const space = { axisCount: 1, axisBounds: () => [null], decode: ([c]) => (c === 1n ? Ither.OUTSIDE : c) };
   const walker = listWalker([null], [[0n], [1n], [2n]], {
      entries({ offset = 0n } = {}) {
         return [{ ordinal: 0n, coordinate: [0n] }, { ordinal: 1n, coordinate: [1n] }, { ordinal: 2n, outside: 1n }].slice(Number(offset))[Symbol.iterator]();
      },
   });
   const query = new SpaceQuery(space, walker, 'decode');
   assert.deepEqual(walk(query), [
      { ordinal: 0n, coordinate: [0n], status: 'structure', structure: 0n },
      { ordinal: 1n, omitted: 'outside', length: 1n },
      { ordinal: 2n, omitted: 'outside', length: 1n },
   ]);

   const grid = new CoordinateGrid({ bounds: [2n], axes: [{ start: 0n, end: 9n }] });
   const clipped = walk(new SpaceQuery({ axisCount: 1, axisBounds: () => [2n], decode: ([c]) => c }, grid, 'decode'), 1n, 5n);
   assert.deepEqual(clipped, [
      { ordinal: 1n, coordinate: [1n], status: 'structure', structure: 1n },
      { ordinal: 2n, omitted: 'outside', length: 3n },
   ]);
});

test('supports huge walks through bounded pages', () => {
   const bound = 10n ** 25n;
   const grid = new CoordinateGrid({ bounds: [bound], axes: [{ start: 0n, end: bound - 1n }] });
   const space = { axisCount: 1, axisBounds: () => [bound], decode: ([c]) => c * 2n };
   const query = new SpaceQuery(space, grid, 'decode');
   const records = walk(query, bound - 2n);
   assert.equal(query.count, bound);
   assert.deepEqual(records.map(record => record.structure), [(bound - 2n) * 2n, (bound - 1n) * 2n]);
});

test('rejects malformed walkers and Space/walker metadata mismatches', () => {
   const valid = listWalker([3n], [[0n], [1n], [2n]]);
   const malformed = [null, {}, { ...valid, axisCount: 0 }, { ...valid, bounds: [undefined] }, { ...valid, count: -1n }, { ...valid, entries: null }, { ...valid, total: null }];
   for (const walker of malformed) assert.throws(() => assertWalker(walker), WalkerError);

   const space = { axisCount: 1, axisBounds: () => [3n], decode: value => value };
   assert.throws(() => new SpaceQuery(space, listWalker([4n], [[0n]]), 'decode'), WalkerError);
   assert.throws(() => new SpaceQuery({ ...space, axisCount: 2 }, valid, 'decode'), WalkerError);
   assert.throws(() => new SpaceQuery(space, valid, 'sideways'), TypeError);
});

test('throws walker errors for invalid coordinates instead of reporting decode errors', () => {
   const space = { axisCount: 1, axisBounds: () => [3n], decode: value => value };
   for (const coordinate of [[0], [3n], [0n, 1n]]) {
      const walker = listWalker([3n], [coordinate]);
      assert.throws(() => walk(new SpaceQuery(space, walker, 'decode')), WalkerError);
   }
});

test('detects walkers that do not account for every ordinal exactly once', () => {
   const coordinates = [[0n], [1n], [2n]];
   const space = { axisCount: 1, axisBounds: () => [3n], decode: value => value };
   const withEntries = entries => listWalker([3n], coordinates, { entries() { return entries[Symbol.iterator](); } });

   assert.throws(() => walk(new SpaceQuery(space, withEntries([{ ordinal: 0n, coordinate: [0n] }]), 'decode')), /ended at ordinal 1/);
   assert.throws(() => walk(new SpaceQuery(space, withEntries([{ ordinal: 0n, coordinate: [0n] }, { ordinal: 2n, coordinate: [2n] }]), 'decode')), /must have ordinal 1/);
   assert.throws(() => walk(new SpaceQuery(space, withEntries([{ ordinal: 0n, coordinate: [0n] }, { ordinal: 1n, outside: 5n }]), 'decode')), /invalid out-of-range run/);
   assert.deepEqual(walk(new SpaceQuery(space, withEntries([{ ordinal: 0n, coordinate: [0n] }, { ordinal: 1n, outside: 2n }]), 'decode')).map(item => item.ordinal), [0n, 1n]);
   const malformedResult = listWalker([3n], coordinates, { entries() { return { next: () => 42, [Symbol.iterator]() { return this; } }; } });
   assert.throws(() => walk(new SpaceQuery(space, malformedResult, 'decode')), /invalid iterator result/);
});
