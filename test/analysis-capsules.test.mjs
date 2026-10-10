// The built-in capsules' own behaviour. The contract they follow — inputs, applicability,
// results, provenance — is tested in test/analysis.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Ither, capabilities } from '../src/index.js';

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

function resultOf(report, type) {
   return report.results.find(result => result.type === type);
}

test('the space suite composes the four space capsules', async () => {
   const { analysis } = await Ither({ space: formula(), analysis: { suite: ['space-suite'] } });

   assert.deepEqual(analysis.summary.requested, ['space-suite']);
   assert.deepEqual(analysis.results.map(result => result.type), ['space-summary', 'space-axes', 'space-layers', 'space-checks', 'space-suite']);
   assert.equal(analysis.summary.status, 'pass');
   assert.equal(analysis.summary.categories.space.counts.pass, 5n);

   const summary = resultOf(analysis, 'space-summary');
   assert.equal(summary.category, 'space');
   assert.equal(summary.metrics.axisCount, 2);
   assert.deepEqual(resultOf(analysis, 'space-axes').metrics.axes.map(axis => axis.bound), [3n, 2n]);
   assert.equal(summary.metrics.finite, true);
   assert.equal(summary.metrics.coordinateCardinality, 6n);
   assert.equal(resultOf(analysis, 'space-suite').members.length, 4);
});

test('space-layers describes each layer; space-checks has nothing to report on a clean formula', async () => {
   const { analysis } = await Ither({
      space: {
         layers: {
            config: { type: 'OBJ', domains: { a: [1, 2], b: [3, 4] }, shape: ['a', 'b'] },
            label: { type: 'STR', domains: { x: ['red', 'blue'] }, shape: 'x' },
         },
         projection: [['config.a', 'label'], ['config.b']],
      },
      analysis: { suite: ['space-layers', 'space-checks'] },
   });
   assert.deepEqual(resultOf(analysis, 'space-layers').metrics.layers.map(layer => ({
      name: layer.name, type: layer.type, cardinality: layer.cardinality, partable: layer.partable, parting: layer.parting, chainedFrom: layer.chainedFrom,
   })), [
      { name: 'config', type: 'OBJ', cardinality: 4n, partable: true, parting: 'keys', chainedFrom: null },
      { name: 'label', type: 'STR', cardinality: 2n, partable: true, parting: 'variables', chainedFrom: null },
   ]);
   const checks = resultOf(analysis, 'space-checks');
   assert.equal(checks.status, 'pass');
   assert.deepEqual(checks.checks, { noEmptyDomains: true, noDegenerateAxes: true });
   assert.deepEqual(checks.notices, []);
});

test('space-axes names a split layer\'s segments', async () => {
   const { analysis } = await Ither({
      space: { layers: { a: { type: 'OBJ', domains: { k: [0, 1, 2] } } }, projection: [['a'], ['a']], options: { combine: 'cantor' } },
      analysis: { suite: ['space-axes'] },
   });
   assert.deepEqual(resultOf(analysis, 'space-axes').metrics.axes.map(axis => [axis.boundReason, axis.sources]), [
      ['sparse', [{ layer: 'a', route: 'split', segment: 0 }]],
      ['sparse', [{ layer: 'a', route: 'split', segment: 1 }]],
   ]);
});

test('space-checks fails honestly on a compiled Space with an empty domain', async () => {
   const { analysis } = await Ither({
      space: { layers: { empty: { type: 'OBJ', domains: { value: [] } } } },
      analysis: { suite: ['space-checks'] },
   });
   const checks = resultOf(analysis, 'space-checks');
   assert.equal(checks.status, 'fail');
   assert.equal(checks.checks.noEmptyDomains, false);
   assert.equal(checks.metrics.errors, 1n);
   assert.equal(checks.notices[0].code, 'space.empty-domain');
   // its sizes cannot be computed: the capsules that need them break, the request does not
   const facts = (await Ither({ space: { layers: { empty: { type: 'OBJ', domains: { value: [] } } } }, analysis: { suite: ['space-summary', 'space-layers'] } })).analysis;
   assert.deepEqual(facts.results.map(result => [result.status, result.reason]), [['error', 'Invalid base64 value: -1'], ['error', 'Invalid base64 value: -1']]);
});

test('space-layers does not leak a chained layer runtime template into Space facts', async () => {
   const space = Ither.from({
      layers: {
         template: { type: 'STR', domains: { x: ['a', 'b'] }, shape: 'x' },
         rendered: { type: 'STR', domains: { a: ['A'], b: ['B'] }, from: 'template' },
      },
   });
   const before = await Ither({ space, analysis: { suite: ['space-layers'] } });
   const live = await Ither({
      space,
      query: { decode: { type: 'grid', axes: [{ start: 0n, end: 1n }, { start: 0n, end: 0n }] } },
      analysis: { suite: ['space-layers'] },
   });
   assert.deepEqual(resultOf(live.analysis, 'space-layers'), resultOf(before.analysis, 'space-layers'));
   assert.equal(resultOf(live.analysis, 'space-layers').metrics.layers[1].cardinality, null);
   assert.equal(resultOf(live.analysis, 'space-layers').metrics.layers[1].bounded, false);
});

test('the query suite composes integrity, coverage, distribution and the geometry over one live stream', async () => {
   const { query, analysis } = await Ither({ space: formula(), query: grid, analysis: { suite: ['query-suite'] } });

   assert.equal(query.records, 6n);
   assert.deepEqual(analysis.results.map(result => result.type), [
      'dataset-integrity', 'dataset-coverage', 'structure-distribution', 'geometry-summary', 'query-suite',
   ]);
   assert.equal(resultOf(analysis, 'dataset-integrity').metrics.records, 6n);
   assert.equal(resultOf(analysis, 'dataset-coverage').metrics.covered, true);
   const distribution = resultOf(analysis, 'structure-distribution');
   assert.equal(distribution.metrics.structures, 6n);
   assert.equal(distribution.metrics.kinds.object, 6n);
   assert.equal(distribution.metrics.distinct, 6n);
   assert.equal(resultOf(analysis, 'geometry-summary').metrics.total, 6n);
   assert.equal(resultOf(analysis, 'query-suite').status, 'pass');
});

test('the lib suite composes roundtrip and serialization checks', async () => {
   const { analysis } = await Ither({ space: formula(), query: grid, analysis: { suite: ['lib-suite'] } });
   assert.deepEqual(analysis.results.map(result => result.type), ['mapping-roundtrip', 'space-serialization', 'lib-suite']);
   assert.equal(resultOf(analysis, 'mapping-roundtrip').metrics.checked, 6n);
   assert.equal(resultOf(analysis, 'mapping-roundtrip').status, 'pass');
   assert.equal(resultOf(analysis, 'space-serialization').status, 'pass');
   assert.equal(analysis.summary.categories.lib.status, 'pass');
});

test('a mega-suite runs each capsule once and keeps a summary per category', async () => {
   const { analysis } = await Ither({ space: formula(), query: grid, analysis: { suite: ['space-suite', 'query-suite', 'lib-suite'] } });
   assert.deepEqual(analysis.summary.requested, ['space-suite', 'query-suite', 'lib-suite']);
   assert.equal(new Set(analysis.results.map(result => result.type)).size, 13);
   assert.equal(analysis.results.length, 13);
   assert.deepEqual(Object.keys(analysis.summary.categories), ['space', 'query', 'lib']);
   assert.equal(analysis.summary.status, 'pass');
});

test('a request\'s own capsule can declare parameters and read a built-in\'s result', async () => {
   const structureRate = {
      type: 'structure-rate',
      category: 'query',
      version: 1,
      requires: ['records'],
      parameters: ['minimum'],
      after: ['dataset-integrity'],
      create({ parameters }) {
         return {
            finish({ results }) {
               const { records, structures } = results.get('dataset-integrity').metrics;
               const minimum = parameters.minimum ?? 1;
               const rate = records === 0n ? null : Number(structures) / Number(records);
               return { status: rate != null && rate >= minimum ? 'pass' : 'fail', metrics: { records, structures, rate, minimum } };
            },
         };
      },
   };

   const { analysis } = await Ither({
      space: formula(),
      query: grid,
      analysis: { capsules: [structureRate], suite: [{ type: 'structure-rate', parameters: { minimum: 0.9 } }] },
   });
   assert.deepEqual(analysis.results.map(result => result.type), ['dataset-integrity', 'structure-rate']);
   assert.equal(resultOf(analysis, 'structure-rate').metrics.rate, 1);
   assert.equal(resultOf(analysis, 'structure-rate').status, 'pass');

   await assert.rejects(Ither({ space: formula(), query: grid, analysis: { suite: ['structure-rate'] } }), /unknown capsule 'structure-rate'/);
});

test('structure-distribution makes its distinct cap explicit', async () => {
   const records = Array.from({ length: 5 }, (_, ordinal) => ({ ordinal: BigInt(ordinal), status: 'structure', structure: ordinal }));
   const { analysis } = await Ither({ analysis: { records, suite: [{ type: 'structure-distribution', parameters: { maxDistinct: 2 } }] } });
   const distribution = resultOf(analysis, 'structure-distribution');
   assert.equal(distribution.metrics.distinct, 2n);
   assert.equal(distribution.metrics.distinctTruncated, true);
   assert.equal(distribution.metrics.maxDistinct, 2n);
   assert.equal(distribution.status, 'warn');
   await assert.rejects(Ither({ analysis: { records, suite: [{ type: 'structure-distribution', parameters: { maxDistinct: 0 } }] } }), /positive safe integer/);
});

test('capabilities publish the built-in types, their categories, and the inputs', () => {
   const caps = capabilities();
   assert.deepEqual(caps.analysisCategories.space, ['space-summary', 'space-axes', 'space-layers', 'space-checks', 'space-suite']);
   assert.deepEqual(caps.analysisCategories.query, ['dataset-integrity', 'dataset-coverage', 'structure-distribution', 'geometry-summary', 'query-suite']);
   assert.deepEqual(caps.analysisCategories.lib, ['mapping-roundtrip', 'space-serialization', 'lib-suite']);
   assert.deepEqual(caps.analysisTypes, [...caps.analysisCategories.space, ...caps.analysisCategories.query, ...caps.analysisCategories.lib]);
   assert.deepEqual(caps.analysisInputs, ['space', 'geometry', 'records', 'manifest']);
   assert.equal('analysisKinds' in caps, false);
});

test('capabilities describe each built-in capsule as data, without its code', () => {
   const caps = capabilities();
   assert.deepEqual(Object.keys(caps.analysisCapsules), caps.analysisTypes);
   for (const [type, capsule] of Object.entries(caps.analysisCapsules)) {
      assert.equal(capsule.type, type);
      assert.equal(typeof capsule.description, 'string', type);
      assert.equal('create' in capsule, false, type);
      if (capsule.members) assert.ok(capsule.members.every(member => member in caps.analysisCapsules), type);
      else for (const input of capsule.requires) assert.ok(caps.analysisInputs.includes(input), type);
   }
   assert.deepEqual(caps.analysisCapsules['dataset-coverage'].requires, ['records', 'manifest']);
   assert.deepEqual(caps.analysisCapsules['structure-distribution'].parameters, ['maxDistinct']);
   caps.analysisCapsules['space-summary'].requires.push('records');
   assert.deepEqual(capabilities().analysisCapsules['space-summary'].requires, ['space'], 'a snapshot, not the live definition');
});

test('a custom capsule may carry a description, and it must be a string', async () => {
   const capsule = description => ({ type: 'described', category: 'custom', version: 1, description, create: () => ({ finish: () => ({ status: 'pass' }) }) });
   const { analysis } = await Ither({ analysis: { capsules: [capsule('says what it does')], suite: ['described'] } });
   assert.equal(analysis.results[0].status, 'pass');
   await assert.rejects(Ither({ analysis: { capsules: [capsule(7)], suite: ['described'] } }), /description must be a string/);
});

test('a capsule\'s result is copied and frozen, detached from what it returned', async () => {
   const callerOwned = { nested: { value: 1 } };
   const copyCapsule = { type: 'copy-check', category: 'probe', version: 1, create: () => ({ finish: () => ({ status: 'pass', metrics: callerOwned }) }) };
   const { analysis } = await Ither({ analysis: { capsules: [copyCapsule], suite: ['copy-check'] } });
   assert.notEqual(resultOf(analysis, 'copy-check').metrics, callerOwned);
   assert.equal(Object.isFrozen(resultOf(analysis, 'copy-check').metrics.nested), true);
   assert.equal(Object.isFrozen(callerOwned.nested), false);
});

//////////////////////////////////////////////////////////////////////////////
// records against their manifest
//////////////////////////////////////////////////////////////////////////////

const chainedSpace = () => Ither.from({
   layers: {
      topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 5 } },
      expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
   },
   projection: [['topo'], ['expr']],
});
const chainedGrid = { type: 'grid', axes: [{ start: 0n, end: 9n }, { start: 0n, end: 31n }] };

test('dataset-coverage: records and the manifest\'s omitted runs cover [offset, nextOffset) exactly', async () => {
   const space = chainedSpace();
   const rows = [];
   const { manifest, query } = await Ither({
      space, query: { decode: chainedGrid, offset: 5n, limit: 200n, manifest: true, write: record => rows.push(record) },
   });
   assert.ok(query.outside > 0n);

   const check = async records => resultOf((await Ither({ space, analysis: { records, manifest, suite: ['dataset-coverage'] } })).analysis, 'dataset-coverage');

   const whole = await check(rows);
   assert.equal(whole.status, 'pass');
   assert.deepEqual([whole.metrics.covered, whole.metrics.offset, whole.metrics.nextOffset], [true, 5n, 205n]);

   const dropped = await check(rows.filter((_, i) => i !== 3));
   assert.equal(dropped.status, 'fail');
   assert.equal(dropped.metrics.covered, false);
   assert.ok(dropped.issues.some(issue => issue.code === 'coverage-gap'));

   const run = manifest.omitted.outside[0];
   const inside = await check([...rows, { ordinal: run[0], coordinate: [0n, 0n], status: 'hole' }].sort((a, b) => (a.ordinal < b.ordinal ? -1 : 1)));
   assert.equal(inside.metrics.covered, false);
   assert.ok(inside.issues.some(issue => issue.code === 'coverage-overlap'));
});

test('dataset-integrity: a malformed saved set gives a bounded failure report naming rows and ordinals', async () => {
   const { analysis } = await Ither({
      analysis: {
         records: [{ ordinal: 0n, status: 'structure' }, { ordinal: 1n, status: 'wat' }, { status: 'hole' }],
         suite: ['dataset-integrity'],
      },
   });
   const integrity = resultOf(analysis, 'dataset-integrity');
   assert.equal(integrity.status, 'fail');
   assert.equal(integrity.metrics.records, 3n);
   assert.deepEqual(integrity.issues.map(issue => [issue.code, issue.row, issue.ordinal]), [
      ['missing-structure', 0n, 0n], ['invalid-status', 1n, 1n], ['invalid-ordinal', 2n, null],
   ]);
});
