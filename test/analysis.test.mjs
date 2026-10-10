// Tier 3 — the analysis contract, and the vocabulary it shares with the
// other tiers (§6.1).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Ither } from '../src/index.js';
import { makeWalker } from '../src/query/Geometry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

//////////////////////////////////////////////////////////////////////////////
// 6.1 one vocabulary
//////////////////////////////////////////////////////////////////////////////

test('6.1 axis is the one name: the Space and every walker say axis, never dimension', () => {
   const space = Ither.from({
      layers: { p: { type: 'NUM', domains: { x: { min: 0, max: 1, steps: 3 }, y: { min: 0, max: 1, steps: 2 } } } },
      projection: [['p.x'], ['p.y']],
   });
   assert.equal(space.axisCount, 2);
   assert.deepEqual(space.axisBounds(), [3n, 2n]);
   assert.deepEqual(space.axisDependencies(), [[], []]);
   for (const name of ['dimensions', 'dimensionBounds', 'dimensionDependencies', '_dimensionRanges']) {
      assert.equal(name in space, false, `space.${name}`);
   }
   const walkers = [
      makeWalker(space, 'decode', { type: 'grid', axes: [{ start: 0n, end: 1n, step: 1n }, { start: 0n, end: 1n, step: 1n }] }),
      makeWalker(space, 'decode', { type: 'ray', start: [0n, 0n], direction: [1n, 0n], count: 2n }),
      makeWalker(space, 'decode', { type: 'list', coordinates: [[0n, 0n]] }),
   ];
   for (const walker of walkers) {
      assert.equal(walker.axisCount, 2);
      assert.equal('dimensions' in walker, false);
   }
   // no code outside quarantine uses the old name
   const offenders = [];
   for (const dir of ['formula', 'query', 'analysis']) {
      for (const file of readdirSync(join(root, 'src', dir))) {
         if (/dimension/i.test(readFileSync(join(root, 'src', dir, file), 'utf8'))) offenders.push(`${dir}/${file}`);
      }
   }
   for (const file of ['Ither.js', 'Capabilities.js', 'index.js']) {
      if (/dimension/i.test(readFileSync(join(root, 'src', file), 'utf8'))) offenders.push(file);
   }
   assert.deepEqual(offenders, []);
});

//////////////////////////////////////////////////////////////////////////////
// fixtures
//////////////////////////////////////////////////////////////////////////////

const pointFormula = () => ({
   layers: { p: { type: 'NUM', domains: { x: { min: 0, max: 1, steps: 3 }, y: { min: 0, max: 1, steps: 2 } } } },
   projection: [['p.x'], ['p.y']],
});
const pointGrid = { type: 'grid', axes: [{ start: 0n, end: 2n }, { start: 0n, end: 1n }] };
const chainedFormula = () => ({
   layers: {
      topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 5 } },
      expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
   },
   projection: [['topo'], ['expr']],
});
const chainedGrid = { type: 'grid', axes: [{ start: 0n, end: 9n }, { start: 0n, end: 31n }] };

const resultOf = (analysis, type) => analysis.results.find(result => result.type === type);

// a capsule that records the inputs it was handed
function spy(type, requires, seen) {
   return {
      type, category: 'probe', version: 1, requires,
      create({ inputs }) {
         seen.create = Object.keys(inputs).sort();
         return { finish({ inputs: finished }) { seen.finish = { ...finished }; return { status: 'pass' }; } };
      },
   };
}

async function saved(space, decode) {
   const records = [];
   const { manifest } = await Ither({ space, query: { decode, manifest: true, write: record => { records.push(record); } } });
   return { records, manifest };
}

//////////////////////////////////////////////////////////////////////////////
// 6.1 the request
//////////////////////////////////////////////////////////////////////////////

test('6.1 an analysis names its suite; a request without analysis is fine', async () => {
   await assert.rejects(Ither({ space: pointFormula(), analysis: {} }), /analysis\.suite is required/);
   await assert.rejects(Ither({ space: pointFormula(), analysis: { suite: [] } }), /non-empty array/);
   const rows = [];
   const plain = await Ither({ space: pointFormula(), query: { decode: pointGrid, write: record => { rows.push(record); } } });
   assert.equal('analysis' in plain, false);
   assert.equal(rows.length, 6);
});

test('6.1 the report: kind, version, provenance, summary and one result per capsule', async () => {
   const { analysis } = await Ither({ space: pointFormula(), analysis: { suite: ['space-summary'] } });
   assert.deepEqual(Object.keys(analysis), ['kind', 'version', 'provenance', 'summary', 'results']);
   assert.equal(analysis.kind, 'analysis-report');
   assert.equal(analysis.version, 1);
   assert.deepEqual(Object.keys(analysis.summary), ['requested', 'status', 'counts', 'categories']);
   assert.deepEqual(analysis.summary.counts, { pass: 1n, warn: 0n, fail: 0n, inapplicable: 0n, error: 0n });
   assert.deepEqual(Object.keys(resultOf(analysis, 'space-summary')).slice(0, 4), ['type', 'category', 'version', 'status']);
   assert.ok(Object.isFrozen(analysis.results[0]));
});

test('6.1 a capsule declares its inputs by name and is handed only those', async () => {
   const space = Ither.from(pointFormula());
   const seen = {};
   await Ither({ space, analysis: { capsules: [spy('only-space', ['space'], seen)], suite: ['only-space'] } });
   assert.deepEqual(seen.create, ['space']);
   assert.deepEqual(Object.keys(seen.finish), ['space']);

   const live = {};
   await Ither({
      space, query: { decode: pointGrid },
      analysis: { capsules: [spy('all-live', ['space', 'geometry', 'records', 'manifest'], live)], suite: ['all-live'] },
   });
   // records flow through observe; their direction is part of the records input; a live
   // manifest exists only once the walk has ended, so it reaches finish
   assert.deepEqual(live.create, ['direction', 'geometry', 'space']);
   assert.deepEqual(Object.keys(live.finish).sort(), ['direction', 'geometry', 'manifest', 'space']);
   assert.equal(live.finish.direction, 'decode');
   assert.equal(live.finish.manifest.kind, 'query-manifest');
   assert.deepEqual(live.finish.geometry, { type: 'grid', axes: [{ start: 0n, end: 2n, step: 1n }, { start: 0n, end: 1n, step: 1n }] });

   await assert.rejects(Ither({
      space, analysis: { capsules: [spy('bad-input', ['space', 'formula'], {})], suite: ['bad-input'] },
   }), /requires: unknown input 'formula'/);
   await assert.rejects(Ither({
      space, analysis: { capsules: [{ ...spy('bad-requires', [], {}), requires: { space: true } }], suite: ['bad-requires'] },
   }), /requires must be an array/);
});

test('6.1 categories are an open label', async () => {
   const { analysis } = await Ither({
      analysis: { capsules: [spy('lab-check', [], {})], suite: ['lab-check'] },
   });
   assert.equal(resultOf(analysis, 'lab-check').category, 'probe');
   assert.deepEqual(analysis.summary.categories.probe, { status: 'pass', counts: { pass: 1n, warn: 0n, fail: 0n, inapplicable: 0n, error: 0n } });
   await assert.rejects(Ither({
      analysis: { capsules: [{ ...spy('bad-category', [], {}), category: 'Not A Label' }], suite: ['bad-category'] },
   }), /category must be a lowercase hyphenated label/);
});

test('6.1 each input has one source: two are a malformed request', async () => {
   const space = Ither.from(pointFormula());
   const { records, manifest } = await saved(space, pointGrid);
   const live = { space, query: { decode: pointGrid } };
   await assert.rejects(Ither({ ...live, analysis: { suite: ['dataset-integrity'], records } }), /analysis\.records.*live query/);
   await assert.rejects(Ither({ ...live, analysis: { suite: ['dataset-integrity'], manifest } }), /analysis\.manifest.*live query/);
   await assert.rejects(Ither({ ...live, analysis: { suite: ['geometry-summary'], geometry: pointGrid } }), /analysis\.geometry.*live query/);
   await assert.rejects(Ither({ space, analysis: { suite: ['geometry-summary'], geometry: pointGrid, manifest } }), /analysis\.geometry.*manifest/);
   await assert.rejects(Ither({ analysis: { suite: ['geometry-summary'], geometry: pointGrid } }), /analysis\.geometry needs request\.space/);
   await assert.rejects(Ither({ space, analysis: { suite: ['dataset-integrity'], adapt: row => row } }), /analysis\.adapt needs analysis\.records/);
   await assert.rejects(Ither({ space, analysis: { suite: ['dataset-integrity'], records, manifest: { ...manifest, kind: 'other' } } }), /query manifest/);
   await assert.rejects(Ither({ space, analysis: { suite: ['dataset-integrity'], records: 'rows' } }), /iterable/);
   await assert.rejects(Ither({ space, analysis: { suite: ['dataset-integrity'], source: records } }), /unknown property 'source'/);
});

test('6.1 live and saved records are the same inputs and give the same results', async () => {
   const space = Ither.from(chainedFormula());
   const suite = ['dataset-integrity', 'dataset-coverage', 'structure-distribution', 'mapping-roundtrip', 'geometry-summary'];
   const live = await Ither({ space, query: { decode: chainedGrid }, analysis: { suite } });
   const { records, manifest } = await saved(space, chainedGrid);
   const cold = await Ither({ space, analysis: { suite, records, manifest } });
   assert.deepEqual(cold.analysis.results, live.analysis.results);
   assert.ok(live.analysis.results.every(result => result.status === 'pass'), JSON.stringify(live.analysis.summary.counts, (_, v) => (typeof v === 'bigint' ? `${v}` : v)));
});

test('6.1 a live query builds its manifest for a capsule that requires one, and returns it only when asked', async () => {
   const space = Ither.from(pointFormula());
   const seen = {};
   const result = await Ither({ space, query: { decode: pointGrid }, analysis: { capsules: [spy('needs-manifest', ['manifest'], seen)], suite: ['needs-manifest'] } });
   assert.equal(seen.finish.manifest.nextOffset, 6n);
   assert.equal('manifest' in result, false);
   const asked = await Ither({ space, query: { decode: pointGrid, manifest: true }, analysis: { suite: ['space-summary'] } });
   assert.equal(asked.manifest.kind, 'query-manifest');
});

//////////////////////////////////////////////////////////////////////////////
// 6.1 provenance (A6)
//////////////////////////////////////////////////////////////////////////////

test('6.1 provenance: live, manifest-matches / -differs, unverified, or null when there is no data', async () => {
   const space = Ither.from(chainedFormula());
   const { records, manifest } = await saved(space, chainedGrid);
   const mappingOf = async request => (await Ither(request)).analysis.provenance;

   assert.deepEqual(await mappingOf({ space, query: { decode: chainedGrid }, analysis: { suite: ['dataset-integrity'] } }),
      { itherVersion: Ither.version, packedBy: null, mapping: 'live', manifest: null });
   assert.equal((await mappingOf({ space, analysis: { suite: ['dataset-integrity'], records, manifest } })).mapping, 'manifest-matches');
   const older = await mappingOf({ space, analysis: { suite: ['dataset-integrity'], records, manifest: { ...manifest, itherVersion: '0.1.0' } } });
   assert.equal(older.mapping, 'manifest-differs');
   assert.deepEqual(older.manifest, { itherVersion: '0.1.0', packedBy: null, sameVersion: false, sameFormula: true });
   const other = Ither.from({ ...space.formula, options: { combine: 'gray' } });
   assert.equal((await mappingOf({ space: other, analysis: { suite: ['dataset-integrity'], records, manifest } })).manifest.sameFormula, false);
   assert.equal((await mappingOf({ space, analysis: { suite: ['dataset-integrity'], records } })).mapping, 'unverified');
   const bare = await mappingOf({ analysis: { suite: ['dataset-integrity'], records, manifest } });
   assert.equal(bare.mapping, 'unverified');
   assert.deepEqual([bare.manifest.sameVersion, bare.manifest.sameFormula], [true, null]);
   assert.equal((await mappingOf({ space, analysis: { suite: ['space-summary'] } })).mapping, null);
});

//////////////////////////////////////////////////////////////////////////////
// 6.3 does not apply
//////////////////////////////////////////////////////////////////////////////

const ONE_OF_EACH = ['space-summary', 'geometry-summary', 'dataset-integrity', 'dataset-coverage'];

test('6.3 a capsule whose inputs are missing is inapplicable, names them, and the request completes', async () => {
   const nothing = (await Ither({ analysis: { suite: ONE_OF_EACH } })).analysis;
   assert.equal(nothing.summary.status, 'inapplicable');
   assert.deepEqual(nothing.results.map(result => [result.type, result.status, result.reason]), [
      ['space-summary', 'inapplicable', "missing input 'space'"],
      ['geometry-summary', 'inapplicable', "missing inputs 'space', 'geometry'"],
      ['dataset-integrity', 'inapplicable', "missing input 'records'"],
      ['dataset-coverage', 'inapplicable', "missing inputs 'records', 'manifest'"],
   ]);

   const space = Ither.from(pointFormula());
   const spaceOnly = (await Ither({ space, analysis: { suite: ONE_OF_EACH } })).analysis;
   assert.deepEqual(spaceOnly.results.map(result => result.status), ['pass', 'inapplicable', 'inapplicable', 'inapplicable']);
   assert.equal(spaceOnly.summary.status, 'pass', 'the roll-up is over what ran');
   assert.equal(spaceOnly.summary.counts.inapplicable, 3n);

   const withGeometry = (await Ither({ space, analysis: { suite: ONE_OF_EACH, geometry: pointGrid } })).analysis;
   assert.deepEqual(withGeometry.results.map(result => result.status), ['pass', 'pass', 'inapplicable', 'inapplicable']);

   const { records, manifest } = await saved(space, pointGrid);
   const recordsOnly = (await Ither({ analysis: { suite: ONE_OF_EACH, records } })).analysis;
   assert.deepEqual(recordsOnly.results.map(result => result.status), ['inapplicable', 'inapplicable', 'pass', 'inapplicable']);
   assert.equal(resultOf(recordsOnly, 'dataset-coverage').reason, "missing input 'manifest'");

   const everything = (await Ither({ space, analysis: { suite: ONE_OF_EACH, records, manifest } })).analysis;
   assert.deepEqual(everything.results.map(result => result.status), ['pass', 'pass', 'pass', 'pass'], 'a saved manifest supplies the geometry');
});

test('6.3 a capsule after one that did not run does not run either', async () => {
   const rate = {
      type: 'structure-rate', category: 'query', version: 1, requires: [], after: ['dataset-integrity'],
      create: () => ({
         finish({ results }) {
            const { records, structures } = results.get('dataset-integrity').metrics;
            return { status: 'pass', metrics: { rate: Number(structures) / Number(records) } };
         },
      }),
   };
   const without = (await Ither({ analysis: { capsules: [rate], suite: ['structure-rate'] } })).analysis;
   assert.deepEqual(resultOf(without, 'structure-rate'), {
      type: 'structure-rate', category: 'query', version: 1, status: 'inapplicable', reason: "'dataset-integrity' did not run",
   });
   const { records } = await saved(Ither.from(pointFormula()), pointGrid);
   const withRecords = (await Ither({ analysis: { capsules: [rate], suite: ['structure-rate'], records } })).analysis;
   assert.equal(resultOf(withRecords, 'structure-rate').metrics.rate, 1);
});

test('6.3 a capsule that throws, or returns what the contract does not allow, is an error; the others still run', async () => {
   const throwing = where => ({
      type: `throws-in-${where}`, category: 'probe', version: 1, requires: ['records'],
      create: () => ({
         observe() { if (where === 'observe') throw new Error('observe broke'); },
         finish() { if (where === 'finish') throw new Error('finish broke'); return { status: 'pass' }; },
      }),
   });
   const returning = (type, value) => ({ type, category: 'probe', version: 1, create: () => ({ finish: () => value }) });
   const cycle = {};
   cycle.self = cycle;
   const capsules = [
      throwing('observe'), throwing('finish'),
      returning('bad-status', { status: 'great' }),
      returning('reserved-error', { status: 'error' }),
      returning('silent-inapplicable', { status: 'inapplicable' }),
      returning('cyclic', { status: 'pass', metrics: cycle }),
      returning('function-valued', { status: 'pass', metrics: { f() {} } }),
   ];
   const { records } = await saved(Ither.from(pointFormula()), pointGrid);
   const { analysis } = await Ither({ analysis: { capsules, records, suite: [...capsules.map(c => c.type), 'dataset-integrity'] } });

   const byStatus = Object.fromEntries(analysis.results.map(result => [result.type, [result.status, result.reason]]));
   assert.deepEqual(byStatus['throws-in-observe'], ['error', 'observe broke']);
   assert.deepEqual(byStatus['throws-in-finish'], ['error', 'finish broke']);
   assert.equal(byStatus['bad-status'][0], 'error');
   assert.match(byStatus['bad-status'][1], /status must be/);
   assert.equal(byStatus['reserved-error'][0], 'error');
   assert.match(byStatus['silent-inapplicable'][1], /inapplicable result needs a reason/);
   assert.match(byStatus.cyclic[1], /cycles/);
   assert.match(byStatus['function-valued'][1], /data values/);
   assert.deepEqual(byStatus['dataset-integrity'], ['pass', undefined]);
   assert.equal(analysis.summary.status, 'error', 'a broken capsule is never hidden by the others passing');
   assert.equal(analysis.summary.counts.error, 7n);
});

test('6.3 only a malformed request rejects: bad parameters, an unknown type, a bad definition', async () => {
   await assert.rejects(Ither({ analysis: { suite: [{ type: 'structure-distribution', parameters: { mystery: true } }] } }), /capsule 'structure-distribution' has no parameter 'mystery'/);
   await assert.rejects(Ither({ analysis: { suite: ['no-such-capsule'] } }), /unknown capsule 'no-such-capsule'/);
   await assert.rejects(Ither({ analysis: { suite: ['space-bounds'] } }), /unknown capsule 'space-bounds'/);
   await assert.rejects(Ither({ analysis: { capsules: [{ type: 'no-create', category: 'probe', version: 1 }], suite: ['no-create'] } }), /create must be a function/);
   await assert.rejects(Ither({
      analysis: {
         capsules: [
            { type: 'cycle-a', category: 'probe', version: 1, after: ['cycle-b'], create: () => ({ finish: () => ({ status: 'pass' }) }) },
            { type: 'cycle-b', category: 'probe', version: 1, after: ['cycle-a'], create: () => ({ finish: () => ({ status: 'pass' }) }) },
         ],
         suite: ['cycle-a'],
      },
   }), /dependency cycle/);
   await assert.rejects(Ither({
      analysis: { capsules: [{ type: 'dataset-integrity', category: 'query', version: 1, create: () => ({ finish: () => ({ status: 'pass' }) }) }], suite: ['dataset-integrity'] },
   }), /already defined/);
});

test('6.3 a suite rolls up the members that ran', async () => {
   const space = Ither.from(pointFormula());
   const geometryOnly = (await Ither({ space, analysis: { suite: ['query-suite'], geometry: pointGrid } })).analysis;
   const suite = resultOf(geometryOnly, 'query-suite');
   assert.equal(suite.status, 'pass', 'only geometry-summary can run without records, and it passed');
   assert.deepEqual(suite.members.map(member => member.status), ['inapplicable', 'inapplicable', 'inapplicable', 'pass']);
   assert.deepEqual(suite.members.map(member => member.type), ['dataset-integrity', 'dataset-coverage', 'structure-distribution', 'geometry-summary']);
   assert.equal('summary' in suite, false);

   const nothing = (await Ither({ analysis: { suite: ['query-suite'] } })).analysis;
   assert.equal(resultOf(nothing, 'query-suite').status, 'inapplicable');
   assert.equal(resultOf(nothing, 'query-suite').reason, 'no member ran');
});

test('6.3 a capsule with nothing to judge says so instead of passing or warning', async () => {
   const space = Ither.from(pointFormula());
   const empty = (await Ither({ space, analysis: { suite: ['mapping-roundtrip'], records: [], manifest: (await saved(space, pointGrid)).manifest } })).analysis;
   assert.deepEqual([resultOf(empty, 'mapping-roundtrip').status, resultOf(empty, 'mapping-roundtrip').reason], ['inapplicable', 'no structure record to check']);
});

//////////////////////////////////////////////////////////////////////////////
// 6.5 records of both directions
//////////////////////////////////////////////////////////////////////////////

test('6.5 encode records: integrity counts them, the roundtrip decodes each coordinate back to its structure', async () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { k: [0, 1, 2, 3] } }, n: { type: 'NUM', domains: { v: { min: 0, max: 1, steps: 3 } } } } });
   const encode = { type: 'list', structures: [{ a: { k: 2 }, n: { v: 0.5 } }, { a: { k: 7 }, n: { v: 0 } }, { a: { k: 1 }, n: { v: 0.4 } }] };
   const { analysis, query } = await Ither({ space, query: { encode }, analysis: { suite: ['dataset-integrity', 'mapping-roundtrip'] } });
   assert.equal(query.errors, 1n);

   const integrity = resultOf(analysis, 'dataset-integrity');
   assert.equal(integrity.status, 'pass');
   assert.deepEqual([integrity.metrics.records, integrity.metrics.structures, integrity.metrics.errors], [3n, 2n, 1n]);

   const roundtrip = resultOf(analysis, 'mapping-roundtrip');
   assert.equal(roundtrip.status, 'fail');
   assert.equal(roundtrip.metrics.direction, 'encode');
   assert.equal(roundtrip.metrics.checked, 2n);
   // NUM snaps 0.4 to 0.5 (§5.4): the coordinate names another structure, which the roundtrip reports
   assert.deepEqual(roundtrip.issues.map(issue => [issue.ordinal, issue.code]), [[1n, 'encode-error'], [2n, 'roundtrip-mismatch']]);
});

test('6.5 decode records: an error record is a decode-error, a structure re-encodes to its coordinate', async () => {
   const space = Ither.from(pointFormula());
   const { analysis } = await Ither({ space, query: { decode: pointGrid }, analysis: { suite: ['mapping-roundtrip'] } });
   const roundtrip = resultOf(analysis, 'mapping-roundtrip');
   assert.deepEqual([roundtrip.status, roundtrip.metrics.direction, roundtrip.metrics.checked], ['pass', 'decode', 6n]);

   const broken = [{ ordinal: 0n, coordinate: [0n, 0n], status: 'error', error: { name: 'Error', message: 'boom' } }];
   const { manifest } = await saved(space, pointGrid);
   const failed = resultOf((await Ither({ space, analysis: { suite: ['mapping-roundtrip'], records: broken, manifest } })).analysis, 'mapping-roundtrip');
   assert.deepEqual(failed.issues.map(issue => issue.code), ['decode-error']);
});

test('6.5 saved records of unknown direction: the roundtrip cannot tell which way to check', async () => {
   const space = Ither.from(pointFormula());
   const { records } = await saved(space, pointGrid);
   const { analysis } = await Ither({ space, analysis: { suite: ['mapping-roundtrip', 'dataset-integrity'], records } });
   assert.deepEqual([resultOf(analysis, 'mapping-roundtrip').status, resultOf(analysis, 'mapping-roundtrip').reason],
      ['inapplicable', 'the records\' direction is unknown: pass the manifest they were saved with']);
   assert.equal(resultOf(analysis, 'dataset-integrity').status, 'pass');
});

//////////////////////////////////////////////////////////////////////////////
// 6.2 space and geometry: the dry run
//////////////////////////////////////////////////////////////////////////////

test('6.2 geometry-summary counts a grid, a ray and a list without decoding anything', async () => {
   const space = Ither.from(pointFormula());
   let decodes = 0;
   const decode = space.decode.bind(space);
   space.decode = coordinate => { decodes++; return decode(coordinate); };
   const summarize = async geometry => resultOf((await Ither({ space, analysis: { suite: ['geometry-summary'], geometry } })).analysis, 'geometry-summary');

   const grid = await summarize({ type: 'grid', axes: [{ start: 0n, end: 5n }, { start: 0n, end: 1n }] });
   assert.deepEqual([grid.status, grid.metrics], ['pass', { type: 'grid', count: 12n, total: 6n, box: [{ min: 0n, max: 5n }, { min: 0n, max: 1n }], dependentAxes: [] }]);
   const ray = await summarize({ type: 'ray', start: [0n, 0n], direction: [1n, 1n], count: 4n });
   assert.deepEqual([ray.metrics.count, ray.metrics.total], [4n, 2n]);
   const list = await summarize({ type: 'list', coordinates: [[0n, 0n], [9n, 0n]] });
   assert.deepEqual([list.metrics.count, list.metrics.total, list.metrics.box], [2n, 1n, [{ min: 0n, max: 9n }, { min: 0n, max: 0n }]]);
   const empty = await summarize({ type: 'list', coordinates: [] });
   assert.deepEqual([empty.metrics.count, empty.metrics.total, empty.metrics.box], [0n, 0n, null]);
   assert.equal(decodes, 0);
   await assert.rejects(summarize({ type: 'grid', axes: [] }), /grid needs 2 axes/);
});

test('6.2 on a chained space the in-range count is unknown up front, and the axes that make it so are named', async () => {
   const space = Ither.from(chainedFormula());
   const { analysis } = await Ither({ space, analysis: { suite: ['geometry-summary'], geometry: chainedGrid } });
   const summary = resultOf(analysis, 'geometry-summary');
   assert.deepEqual([summary.status, summary.metrics.count, summary.metrics.total, summary.metrics.dependentAxes], ['pass', 320n, null, [1]]);
   const live = await Ither({ space, query: { decode: chainedGrid }, analysis: { suite: ['geometry-summary'] } });
   assert.deepEqual(resultOf(live.analysis, 'geometry-summary'), summary);
});

test('6.2 an encode query has no geometry', async () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { k: [0, 1] } } } });
   const { analysis } = await Ither({ space, query: { encode: { type: 'list', structures: [{ a: { k: 1 } }] } }, analysis: { suite: ['geometry-summary'] } });
   assert.deepEqual([resultOf(analysis, 'geometry-summary').status, resultOf(analysis, 'geometry-summary').reason], ['inapplicable', "missing input 'geometry'"]);
});

//////////////////////////////////////////////////////////////////////////////
// 6.4 one set of space facts
//////////////////////////////////////////////////////////////////////////////

test('6.4 the space suite reports each fact once', async () => {
   const { analysis } = await Ither({ space: chainedFormula(), analysis: { suite: ['space-suite'] } });
   assert.deepEqual(resultOf(analysis, 'space-suite').members.map(member => member.type), ['space-summary', 'space-axes', 'space-layers', 'space-checks']);
   const keys = ['space-summary', 'space-axes', 'space-layers'].map(type => Object.keys(resultOf(analysis, type).metrics));
   const all = keys.flat();
   assert.equal(new Set(all).size, all.length, `a metric reported twice: ${all}`);
   assert.deepEqual(Object.keys(resultOf(analysis, 'space-summary').metrics).sort(),
      ['axisCount', 'coordinateCardinality', 'finite', 'itherVersion', 'layerNames', 'packedBy', 'structureCardinality']);
   assert.deepEqual(Object.keys(resultOf(analysis, 'space-axes').metrics), ['axes']);
});

test('6.4 space-axes: per axis its bound and why, what it depends on, its combine and its sources', async () => {
   const { analysis } = await Ither({
      space: {
         layers: {
            config: { type: 'OBJ', domains: { a: [1, 2], b: [3, 4] }, shape: ['a', 'b'] },
            label: { type: 'STR', domains: { x: ['red', 'blue'] }, shape: 'x' },
            t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 3 } },
            e: { type: 'STR', from: 't', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
         },
         projection: [['config.a', 'label'], ['config.b'], ['t'], ['e']],
      },
      analysis: { suite: ['space-axes'] },
   });
   assert.deepEqual(resultOf(analysis, 'space-axes').metrics.axes, [
      { axis: 0, bound: 4n, boundReason: 'fixed', dependsOn: [], combine: 'box', sources: [{ layer: 'config', route: 'part', part: 'a' }, { layer: 'label', route: 'whole' }] },
      { axis: 1, bound: 2n, boundReason: 'fixed', dependsOn: [], combine: 'box', sources: [{ layer: 'config', route: 'part', part: 'b' }] },
      { axis: 2, bound: null, boundReason: 'capped', dependsOn: [], combine: 'box', sources: [{ layer: 't', route: 'whole' }] },
      { axis: 3, bound: null, boundReason: 'dependent', dependsOn: [2], combine: 'box', sources: [{ layer: 'e', route: 'whole' }] },
   ]);
});

test('6.4 space-checks warns about a degenerate axis', async () => {
   const { analysis } = await Ither({ space: { layers: { one: { type: 'OBJ', domains: { k: ['only'] } } } }, analysis: { suite: ['space-checks'] } });
   const checks = resultOf(analysis, 'space-checks');
   assert.equal(checks.status, 'warn');
   assert.deepEqual(checks.checks, { noEmptyDomains: true, noDegenerateAxes: false });
   assert.equal(checks.notices[0].code, 'space.degenerate-axis');
});

test('6.4 capsules read engine facts through one private accessor', () => {
   for (const file of readdirSync(join(root, 'src', 'analysis'))) {
      assert.doesNotMatch(readFileSync(join(root, 'src', 'analysis', file), 'utf8'), /_engine/, file);
   }
});
