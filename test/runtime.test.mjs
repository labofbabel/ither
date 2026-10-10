import test from 'node:test';
import assert from 'node:assert/strict';

import * as publicApi from '../src/index.js';

const { Ither, Space } = publicApi;

function formula() {
   return {
      layers: {
         point: {
            type: 'NUM',
            domains: { x: { min: 0, max: 1, steps: 3 }, y: { min: 0, max: 1, steps: 2 } },
         },
      },
      projection: [['point.x'], ['point.y']],
   };
}

const grid = {
   decode: { type: 'grid', axes: [{ start: 0n, end: 2n }, { start: 0n, end: 1n }] },
};

test('callable Ither resolves a formula to a Space in a Promise result envelope', async () => {
   const pending = Ither({ space: formula() });
   assert.equal(typeof pending.then, 'function');
   const result = await pending;

   assert.deepEqual(Object.keys(result), ['space']);
   assert.ok(result.space instanceof Space);
   assert.ok(Object.isFrozen(result));
});

test('callable Ither reuses an existing Space by identity', async () => {
   const space = Ither.from(formula());
   const result = await Ither({ space });
   assert.equal(result.space, space);
});

test('Ither is a verb, not a constructor: a space is defined by a formula', () => {
   assert.throws(() => new Ither({ type: 'OBJ', domains: { value: ['a', 'b'] } }), /not a constructor/);
   assert.equal(Ither.version, '0.3.0');
   assert.equal('intToMixed' in Ither, false, 'the imperative engine\'s statics are not on the façade');
});

test('the public surface is the three-tier façade, the space it compiles, and description', () => {
   assert.deepEqual(Object.keys(publicApi).sort(), ['Codec', 'Ither', 'Space', 'capabilities', 'formulaSchema']);
   const caps = publicApi.capabilities();
   assert.equal('reportKinds' in caps, false, 'the legacy report system is not advertised');
   assert.equal('reports' in caps.api, false);
});

test('Space compiled configuration is deeply immutable and detached from its caller', () => {
   const input = formula();
   const space = Ither.from(input);
   input.layers.point.domains.x.steps = 100;

   assert.equal(space.formula.layers.point.domains.x.steps, 3);
   assert.ok(Object.isFrozen(space.formula));
   assert.ok(Object.isFrozen(space.formula.layers.point.domains.x));
   assert.throws(() => { space.formula.layers.point.domains.x.steps = 9; }, TypeError);
   assert.throws(() => { space.formula = formula(); }, TypeError);
   assert.equal('options' in space, false, 'options are read from space.formula.options');
   assert.ok(Object.isFrozen(space.formula.options));
   assert.equal(space.axisBounds()[0], 3n);
});

test('query writes records and returns the final report', async () => {
   const rows = [];
   const result = await Ither({
      space: formula(),
      query: { ...grid, write: record => rows.push(record) },
   });

   assert.deepEqual(Object.keys(result), ['space', 'query']);
   assert.equal(rows.length, 6);
   assert.equal(result.query.records, 6n);
   assert.equal(result.query.complete, true);
   assert.equal(result.query.nextOffset, 6n);
});

test('a live query can feed analysis without materialising its records', async () => {
   const result = await Ither({
      space: formula(),
      query: grid,
      analysis: { suite: ['dataset-integrity'] },
   });
   const integrity = result.analysis.results[0];

   assert.deepEqual(Object.keys(result), ['space', 'query', 'analysis']);
   assert.equal(integrity.status, 'pass');
   assert.equal(integrity.metrics.records, 6n);
   assert.equal(integrity.metrics.structures, 6n);
   assert.equal(integrity.metrics.axisCount, 2);
});

test('an adapter owns the storage format: it converts saved rows back into records', async () => {
   const records = [
      { at: ['3', '8'], payload: 'alpha' },
      { at: ['3', '9'], payload: 'beta' },
   ];
   const result = await Ither({
      analysis: {
         records,
         suite: ['dataset-integrity'],
         context: { origin: [10n, 20n] },
         adapt(row, position, context) {
            if (row.payload === 'beta' && position !== 1n) throw new Error('rows are numbered from 0');
            return {
               ordinal: position,
               coordinate: row.at.map((value, axis) => BigInt(value) + context.origin[axis]),
               status: 'structure',
               structure: row.payload,
            };
         },
      },
   });
   const integrity = result.analysis.results[0];

   assert.equal(integrity.status, 'pass');
   assert.equal(integrity.metrics.records, 2n);
   assert.equal(integrity.metrics.axisCount, 2);
   assert.equal(result.analysis.provenance.mapping, 'unverified');

   const failing = await Ither({ analysis: { records, suite: ['dataset-integrity'], adapt: () => { throw new Error('unreadable'); } } });
   assert.deepEqual(failing.analysis.results[0].issues.map(issue => [issue.code, issue.row, issue.message]), [
      ['adapter-error', 0n, 'unreadable'], ['adapter-error', 1n, 'unreadable'],
   ]);
   assert.equal(failing.analysis.results[0].metrics.adapterErrors, 2n);
});

test('facade rejects ambiguous or lossy request combinations', async () => {
   await assert.rejects(Ither({ query: grid }), /query requires request\.space/);
   await assert.rejects(Ither({ space: formula(), query: grid }), /query\.write/);
   await assert.rejects(Ither({ analysis: {} }), /analysis\.suite is required/);
   await assert.rejects(Ither({
      space: formula(),
      query: grid,
      analysis: { suite: ['dataset-integrity'], records: [] },
   }), /cannot be combined with a live query/);
   await assert.rejects(Ither({
      space: formula(),
      query: { ...grid, write: async () => undefined },
   }), /must be synchronous/);
});

test('pack, unpack, encode, and decode remain operations of Space', async () => {
   const space = (await Ither({ space: formula() })).space;
   const coordinate = space.encode({ point: { x: 0.5, y: 1 } });
   assert.deepEqual(space.decode(coordinate), { point: { x: 0.5, y: 1 } });

   const unpacked = Space.unpack(space.pack());
   assert.deepEqual(unpacked.formula, space.formula);
   assert.deepEqual(unpacked.decode(coordinate), space.decode(coordinate));
});

test('the disconnected process-wide feedback singleton is not public', () => {
   assert.equal('feedback' in publicApi, false);
});
