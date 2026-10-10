// Bounds and the no-alias guarantee.
//
// A query never returns a structure for a coordinate that has none. A coordinate
// past a range the library knows — fixed by the formula, or resolved from the
// template a chained layer took from its source — is OUTSIDE: skipped by a query,
// counted in its summary, and returned as Ither.OUTSIDE by decode. An in-range
// coordinate that names no structure (a sparse Cantor or split axis) is a HOLE.
// Nothing is clamped, and no fact about a Space depends on what was decoded last.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Ither } from '../src/index.js';
import { loadAll } from '../formulas/bank.mjs';

async function compilableBank() {
   const entries = await loadAll();
   for (const entry of entries)
      assert.doesNotThrow(() => Ither.from(entry.formula), entry.name);
   return entries;
}

const text = value => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));

// The formula behind the experiment that found the aliasing (225 records, 45 distinct).
const gradNoise = (projection = [['topo'], ['expr.x'], ['expr.o1'], ['expr.o2']]) => ({
   layers: {
      topo: { type: 'AST', domains: { x: ['x'], o1: ['o1'], o2: ['o2'] } },
      expr: {
         type: 'STR', from: 'topo', domains: {
            x: ['P', 'D', 'R', 'C'],
            o1: ['sqt', 'log', 'frc', 'flr', 'cil', 'sgn', 'nrm'],
            o2: ['add', 'sub', 'mlt', 'div', 'pow', 'mod', 'lrg', 'eql', 'min', 'max', 'dot', 'dst'],
         },
      },
   },
   projection,
});

const wholeChain = () => ({
   layers: {
      topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 3 } },
      expr: { type: 'STR', from: 'topo', domains: { x: ['P', 'D'], o2: ['add', 'mul', 'sub'] } },
   },
   projection: [['topo'], ['expr']],
});

const axes = (...ranges) => ranges.map(([start, end]) => ({ start, end }));

async function runGrid(space, gridAxes, extra = {}) {
   const records = [];
   const result = await Ither({
      space,
      query: { decode: { type: 'grid', axes: gridAxes }, ...extra, write: record => records.push(record) },
   });
   return { records, query: result.query };
}

function assertNoAliases(space, records, label) {
   const seen = new Map();
   for (const record of records) {
      assert.notEqual(record.status, 'outside', `${label}: a query must not emit an out-of-range record`);
      if (record.status !== 'structure') continue;
      const key = text(record.structure);
      assert.ok(!seen.has(key), `${label}: ${record.coordinate} repeats the structure at ${seen.get(key)}`);
      seen.set(key, record.coordinate.join(','));
      assert.deepEqual(space.encode(record.structure), record.coordinate, `${label}: ${record.coordinate} does not round-trip`);
   }
   return seen.size;
}

//////////////////////////////////////////////////////////////////////////////
// decode
//////////////////////////////////////////////////////////////////////////////

test('decode returns OUTSIDE past a fixed range instead of clamping', () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { p: ['a', 'b', 'c'], q: [0, 1] } } } });
   assert.equal(space.axisBounds()[0], 6n);
   assert.notEqual(space.decode([5n]), Ither.OUTSIDE);
   assert.equal(space.decode([6n]), Ither.OUTSIDE);
   assert.equal(space.decode([-1n]), Ither.OUTSIDE);
   assert.notEqual(Ither.OUTSIDE, Ither.HOLE);
});

test('decode returns OUTSIDE past every layer type\'s range', () => {
   const cases = [
      { layers: { t: { type: 'TRI', shape: { n: 5 } } } },
      { layers: { p: { type: 'PERM', shape: { n: 3 } } } },
      { layers: { n: { type: 'NUM', domains: { v: { min: 0, max: 1, steps: 5 } } } } },
      { layers: { s: { type: 'STR', shape: 'a+b', domains: { a: ['1', '2'], b: ['3', '4', '5'] } } } },
      { layers: { r: { type: 'ARR', shape: ['a', 'a'], domains: { a: ['x', 'y'] } } } },
   ];
   for (const formula of cases) {
      const space = Ither.from(formula);
      const bound = space.axisBounds()[0];
      assert.ok(bound > 0n);
      assert.notEqual(space.decode([bound - 1n]), Ither.OUTSIDE, text(formula));
      assert.equal(space.decode([bound]), Ither.OUTSIDE, text(formula));
   }
});

test('an AST cap is not a bound, and coordinates past it are OUTSIDE', () => {
   // maxNodes 2 over one leaf and one binary operator: 1 + 1 + 2 = 4 trees
   const space = Ither.from({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'] }, options: { maxNodes: 2 } } } });
   assert.deepEqual(space.axisBounds(), [null]);
   assert.equal(space.cardinality, null);
   assert.notEqual(space.decode([3n]), Ither.OUTSIDE);
   assert.equal(space.decode([4n]), Ither.OUTSIDE);
   assert.equal(space.decode([10n ** 60n]), Ither.OUTSIDE);
});

test('a part of a chained layer is checked against the template its topology produced', () => {
   const space = Ither.from(gradNoise());
   assert.equal(space.decode([6n, 0n, 0n, 0n]).topo, 'o2(x,o2(x,x))');
   assert.equal(space.decode([6n, 0n, 1n, 0n]), Ither.OUTSIDE, 'topology 6 has no o1 slot');
   assert.notEqual(space.decode([7n, 15n, 6n, 11n]), Ither.OUTSIDE);
   assert.equal(space.decode([7n, 16n, 0n, 0n]), Ither.OUTSIDE);
   assert.equal(space.decode([7n, 0n, 7n, 0n]), Ither.OUTSIDE);
   assert.equal(space.decode([7n, 0n, 0n, 12n]), Ither.OUTSIDE);
});

test('a whole chained layer is checked against its template', () => {
   const space = Ither.from(wholeChain());
   assert.equal(space.decode([8n, 0n]).topo, 'o2(o2(o2(x,x),x),x)');
   assert.notEqual(space.decode([8n, 431n]), Ither.OUTSIDE);
   assert.equal(space.decode([8n, 432n]), Ither.OUTSIDE);
});

test('an in-range coordinate on a sparse axis that names no structure is a HOLE', () => {
   const cantor = Ither.from({
      layers: {
         a: { type: 'OBJ', domains: { v: ['a', 'b', 'c'] } },
         b: { type: 'OBJ', domains: { w: [0, 1] } },
      },
      projection: [['a', 'b']],
      options: { combine: 'cantor' },
   });
   const split = Ither.from({
      layers: { a: { type: 'OBJ', domains: { p: ['a', 'b', 'c'], q: [0, 1, 2] } } },
      projection: [['a'], ['a']],
      options: { combine: 'cantor' },
   });

   for (const [space, structures, grid] of [
      [cantor, ['a', 'b', 'c'].flatMap(v => [0, 1].map(w => ({ a: { v }, b: { w } }))), n => [[n]]],
      [split, ['a', 'b', 'c'].flatMap(p => [0, 1, 2].map(q => ({ a: { p, q } }))), n => Array.from({ length: Number(n) }, (_, i) => [BigInt(i), n - 1n])],
   ]) {
      assert.ok(space.axisBounds().every(bound => bound === null));
      const encoded = structures.map(s => space.encode(s));
      const limit = encoded.flat().reduce((m, c) => (c > m ? c : m), 0n) + 1n;
      const found = new Set();
      for (const coordinate of cartesian(space.axisCount, limit)) {
         const value = space.decode(coordinate);
         assert.notEqual(value, Ither.OUTSIDE, `${coordinate} is inside an unbounded axis`);
         if (value === Ither.HOLE) continue;
         const key = text(value);
         assert.ok(!found.has(key), `${coordinate} repeats a structure`);
         found.add(key);
         assert.deepEqual(space.encode(value), coordinate);
      }
      assert.equal(found.size, structures.length);
      void grid;
   }
});

function* cartesian(axisCount, limit) {
   const total = limit ** BigInt(axisCount);
   for (let n = 0n; n < total; n++) {
      const c = new Array(axisCount);
      let r = n;
      for (let i = axisCount - 1; i >= 0; i--) { c[i] = r % limit; r /= limit; }
      yield c;
   }
}

//////////////////////////////////////////////////////////////////////////////
// bounds
//////////////////////////////////////////////////////////////////////////////

test('bounds separate fixed facts from facts resolved at a coordinate', () => {
   const space = Ither.from(gradNoise());
   assert.deepEqual(space.axisBounds(), [null, null, null, null]);
   assert.deepEqual(space.axisDependencies(), [[], [0], [0], [0]]);
   assert.deepEqual(space.axisBounds([6n, 0n, 0n, 0n]), [null, 64n, 1n, 144n]);
   assert.deepEqual(space.axisBounds([7n, 0n, 0n, 0n]), [null, 16n, 7n, 12n]);
   assert.equal(space.cardinality, null);

   const whole = Ither.from(wholeChain());
   assert.deepEqual(whole.axisBounds(), [null, null]);
   assert.deepEqual(whole.axisBounds([8n, 0n]), [null, 432n]);
});

test('no bound or cardinality depends on what was decoded before', async () => {
   const formulas = [
      ...(await compilableBank()).map(entry => [entry.name, entry.formula]),
      ['grad-noise', gradNoise()],
      ['whole chain', wholeChain()],
   ];
   for (const [name, formula] of formulas) {
      const space = Ither.from(formula);
      const before = text([space.axisBounds(), space.cardinality]);
      for (const first of [0n, 1n, 5n, 7n, 8n]) {
         const coordinate = Array.from({ length: space.axisCount }, (_, i) => (i === 0 ? first : 0n));
         space.decode(coordinate);
         assert.equal(text([space.axisBounds(), space.cardinality]), before, `${name} after decoding ${coordinate}`);
      }
   }
});

test('a chained layer may not share an axis with another source', () => {
   const cascade = {
      layers: {
         s0: { type: 'STR', shape: 'AB', domains: { A: ['a', 'b', 'c'], B: ['a', 'b', 'c'] } },
         s1: { type: 'STR', from: 's0', domains: { a: ['p', 'q'], b: ['p', 'q'], c: ['p', 'q'] } },
      },
   };
   assert.throws(() => Ither.from({ ...cascade, projection: [['s0', 's1']] }), /chained/);
   assert.throws(() => Ither.from(gradNoise([['topo', 'expr.x'], ['expr.o1'], ['expr.o2']])), /chained/);
   assert.doesNotThrow(() => Ither.from(gradNoise([['topo'], ['expr.x'], ['expr.o1', 'expr.o2']])));
});

//////////////////////////////////////////////////////////////////////////////
// grid queries
//////////////////////////////////////////////////////////////////////////////

test('the experiment that found the aliasing now returns each structure once', async () => {
   const space = Ither.from(gradNoise());
   const records = [];
   const result = await Ither({
      space,
      query: { decode: { type: 'grid', axes: axes([6n, 8n], [6n, 8n], [6n, 10n], [7n, 11n]) }, write: record => records.push(record) },
      analysis: { suite: ['dataset-integrity', 'structure-distribution', 'mapping-roundtrip'] },
   });

   assert.equal(result.query.count, 225n);
   assert.equal(result.query.records, 15n);
   assert.equal(result.query.structures, 15n);
   assert.equal(result.query.outside, 210n);
   assert.equal(result.query.complete, true);
   assert.equal(assertNoAliases(space, records, 'grad-noise'), 15);
   for (const outcome of result.analysis.results) assert.equal(outcome.status, 'pass', outcome.type);
});

test('a grid with one topology is sized by that topology\'s template', async () => {
   const space = Ither.from(gradNoise());
   const { records, query } = await runGrid(space, axes([7n, 7n], [0n, 19n], [0n, 19n], [0n, 19n]));
   assert.equal(query.count, 8000n);
   assert.equal(query.records, 16n * 7n * 12n);
   assert.equal(query.outside, 8000n - 16n * 7n * 12n);
   assert.equal(assertNoAliases(space, records, 'topology 7'), 16 * 7 * 12);
});

test('a fixed axis past its bound is intersected, and the rest counted as outside', async () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { p: ['a', 'b', 'c'], q: [0, 1] } } } });
   const progress = [];
   const records = [];
   const result = await Ither({
      space,
      query: { decode: { type: 'grid', axes: axes([3n, 9n]) }, write: record => { records.push(record); }, progress: p => { progress.push(p); } },
   });
   assert.deepEqual(records.map(r => r.coordinate), [[3n], [4n], [5n]]);
   assert.equal(result.query.count, 7n);
   assert.equal(result.query.outside, 4n);
   assert.equal(result.query.complete, true);
   assert.equal(progress.at(-1).total, 3n);
});

test('a grid past an AST cap skips the rest of the axis', async () => {
   const space = Ither.from({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'] }, options: { maxNodes: 2 } } } });
   const { records, query } = await runGrid(space, axes([0n, 10n ** 40n]));
   assert.equal(query.records, 4n);
   assert.equal(query.outside, 10n ** 40n + 1n - 4n);
   assert.equal(query.complete, true);
   assertNoAliases(space, records, 'capped AST');
});

test('paging a dependent grid with limit and nextOffset reproduces the whole run', async () => {
   const space = Ither.from(gradNoise());
   const gridAxes = axes([5n, 9n], [0n, 3n], [0n, 8n], [0n, 3n]);
   const whole = await runGrid(space, gridAxes);
   assert.equal(whole.query.nextOffset, whole.query.count);

   const pages = [];
   let offset = 0n;
   let outside = 0n;
   while (offset < whole.query.count) {
      const page = await runGrid(space, gridAxes, { offset, limit: 7n });
      assert.equal(page.query.complete, true);
      assert.ok(page.query.records <= 7n);
      assert.ok(page.query.nextOffset > offset, 'a page must make progress');
      pages.push(...page.records);
      outside += page.query.outside;
      offset = page.query.nextOffset;
   }
   assert.deepEqual(pages, whole.records);
   assert.equal(outside, whole.query.outside);
   assert.equal(whole.query.records + whole.query.outside, whole.query.count);
});

test('a progress total is known only when no axis depends on another', async () => {
   const totals = [];
   await Ither({
      space: gradNoise(),
      query: { decode: { type: 'grid', axes: axes([7n, 7n], [0n, 1n], [0n, 1n], [0n, 1n]) }, write: () => {}, progress: p => totals.push(p.total) },
   });
   assert.ok(totals.length > 0 && totals.every(total => total === null));
});

test('an axis that depends on a later axis is still walked without aliases', async () => {
   const natural = Ither.from(gradNoise());
   const reordered = Ither.from(gradNoise([['expr.x'], ['topo'], ['expr.o1'], ['expr.o2']]));
   assert.deepEqual(reordered.axisDependencies(), [[1], [], [1], [1]]);

   const a = await runGrid(natural, axes([5n, 8n], [0n, 3n], [0n, 8n], [0n, 3n]));
   const b = await runGrid(reordered, axes([0n, 3n], [5n, 8n], [0n, 8n], [0n, 3n]));
   assertNoAliases(reordered, b.records, 'reordered');
   const values = records => new Set(records.map(r => text(r.structure)));
   assert.deepEqual(values(b.records), values(a.records));
   assert.equal(b.query.outside, a.query.outside);
});

test('every bank formula queries without aliases', async () => {
   for (const { name, formula } of await compilableBank()) {
      const space = Ither.from(formula);
      const bounds = space.axisBounds();
      const gridAxes = bounds.map(bound => ({ start: 0n, end: (bound != null && bound < 4n ? bound : 4n) - 1n }));
      const wide = bounds.map(bound => (bound == null ? { start: 0n, end: 11n } : null));
      const plan = gridAxes.map((axis, i) => wide[i] ?? axis);
      const { records, query } = await runGrid(space, plan);
      assert.equal(query.errors, 0n, name);
      assert.equal(query.records + query.outside, query.count, name);
      assertNoAliases(space, records, name);
   }
});

//////////////////////////////////////////////////////////////////////////////
// reports
//////////////////////////////////////////////////////////////////////////////

test('space reports distinguish dependent axes from capped ones', async () => {
   const { analysis } = await Ither({
      space: gradNoise(),
      analysis: { suite: ['space-summary', 'space-axes', 'space-layers'] },
   });
   const byType = type => analysis.results.find(result => result.type === type);

   const summary = byType('space-summary').metrics;
   assert.equal(summary.finite, false);
   assert.equal(summary.coordinateCardinality, null);
   assert.equal(summary.structureCardinality, null);

   const axes = byType('space-axes').metrics.axes;
   assert.deepEqual(axes.map(axis => axis.bound), [null, null, null, null]);
   assert.deepEqual(axes.map(axis => axis.boundReason), ['capped', 'dependent', 'dependent', 'dependent']);
   assert.deepEqual(axes.map(axis => axis.dependsOn), [[], [0], [0], [0]]);
   const layers = byType('space-layers').metrics.layers;
   assert.equal(layers[0].cardinality, null);
   assert.equal(layers[0].bounded, false);
});
