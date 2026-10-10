// Tier 2 — the query contract.
//
// A query walks a geometry (coordinates in, structures out) or a list of structures
// (structures in, coordinates out) and delivers one record per point to `write`, a
// progress report by time to `progress`, and ends with a final report — plus, when asked,
// a manifest naming everything needed to repeat it and every ordinal it omitted.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as publicApi from '../src/index.js';
import { runQuery, DEFAULT_POLICY } from '../src/query/Query.js';
import { describeGeometry } from '../src/query/Geometry.js';

const { Ither } = publicApi;

function pointFormula() {
   return {
      layers: {
         point: {
            type: 'NUM',
            domains: { x: { min: 0, max: 1, steps: 4 }, y: { min: 0, max: 1, steps: 3 } },
         },
      },
      projection: [['point.x'], ['point.y']],
   };
}

function sparseFormula() {
   return {
      layers: {
         left: { type: 'OBJ', domains: { value: ['a', 'b'] } },
         right: { type: 'OBJ', domains: { value: [0, 1] } },
      },
      projection: [['left', 'right']],
      options: { combine: 'cantor' },
   };
}

// a chained space: most points of a box are outside the range their topology gives them
function chainedFormula() {
   return {
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 5 } },
         expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      },
      projection: [['topo'], ['expr']],
   };
}

// uncapped: a grid over topologies up to 10^7 is walked point by point along axis 0
function uncappedChainedFormula() {
   return {
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      },
      projection: [['topo'], ['expr']],
   };
}

const collect = async (space, query) => {
   const records = [];
   const result = await Ither({ space, query: { write: record => { records.push(record); }, ...query } });
   return { records, ...result };
};

const REPORT_KEYS = [
   'complete', 'count', 'elapsedMs', 'errors', 'fraction', 'holes', 'kind', 'limit', 'nextOffset', 'offset',
   'outside', 'records', 'recordsPerSecond', 'remaining', 'remainingMs', 'stop', 'structures', 'total', 'version',
].sort();

//////////////////////////////////////////////////////////////////////////////
// 5.1 one entry point, one record
//////////////////////////////////////////////////////////////////////////////

test('5.1 a grid is a geometry value under query.decode; each record carries its ordinal, coordinate, status and structure', async () => {
   const space = Ither.from(pointFormula());
   const { records, query } = await collect(space, {
      decode: { type: 'grid', axes: [{ start: 1n, end: 3n }, { start: 0n, end: 2n, step: 2n }] },
   });
   assert.deepEqual(records.map(record => record.coordinate), [[1n, 0n], [1n, 2n], [2n, 0n], [2n, 2n], [3n, 0n], [3n, 2n]]);
   assert.deepEqual(Object.keys(records[0]).sort(), ['coordinate', 'ordinal', 'status', 'structure']);
   assert.deepEqual(records.map(record => record.ordinal), [0n, 1n, 2n, 3n, 4n, 5n]);
   assert.ok(records.every(record => record.status === 'structure'));
   assert.deepEqual(Object.keys(query).sort(), REPORT_KEYS);
   assert.equal(query.records, 6n);
   assert.equal(query.structures, 6n);
   assert.equal(query.stop, 'end');
   assert.equal(query.kind, 'query-report', '6.1 every report names its kind');
   assert.equal(query.version, 1);
});

test('5.1 a query batches the single decode: each record holds exactly what space.decode returns', async () => {
   const space = Ither.from(chainedFormula());
   const calls = [];
   const decode = space.decode.bind(space);
   const spy = Object.create(space, { decode: { value: coordinate => { calls.push(coordinate); return decode(coordinate); } } });
   const { records } = await collect(spy, { decode: { type: 'grid', axes: [{ start: 0n, end: 3n }, { start: 0n, end: 5n }] } });
   assert.ok(records.length > 0);
   for (const record of records) assert.deepEqual(record.structure, space.decode(record.coordinate));
   assert.equal(calls.length, records.length, 'grid skips outside runs arithmetically; every other point goes through decode');
});

test('5.1 a list of one coordinate is the single decode as a query', async () => {
   const space = Ither.from(pointFormula());
   const { records, query } = await collect(space, { decode: { type: 'list', coordinates: [[2n, 1n]] } });
   assert.deepEqual(records, [{ ordinal: 0n, coordinate: [2n, 1n], status: 'structure', structure: space.decode([2n, 1n]) }]);
   const outside = await collect(space, { decode: { type: 'list', coordinates: [[4n, 0n]] } });
   assert.deepEqual(outside.records, []);
   assert.equal(outside.query.outside, 1n);
   assert.equal(outside.query.complete, true);
});

test('5.1 D2 one input form per geometry: phase, top-level step and ray step are gone, and geometry is a value', async () => {
   const space = Ither.from(pointFormula());
   const run = query => Ither({ space, query: { write() {}, ...query } });
   await assert.rejects(run({ decode: { type: 'grid', axes: [{ start: 0n, end: 1n, phase: 1n }, { start: 0n, end: 1n }] } }), /unknown grid axis key 'phase'/);
   await assert.rejects(run({ decode: { type: 'grid', step: 2n, axes: [{ start: 0n, end: 1n }, { start: 0n, end: 1n }] } }), /unknown grid key 'step'/);
   await assert.rejects(run({ decode: { type: 'ray', start: [0n, 0n], direction: [1n, 0n], step: 2n, count: 2n } }), /unknown ray key 'step'/);
   await assert.rejects(run({ geometry: 'grid', axes: [] }), /unknown query key 'geometry'/);
   await assert.rejects(run({ decode: { type: 'sphere' } }), /type/);
   await assert.rejects(run({}), /decode or query\.encode/);
   await assert.rejects(run({ decode: { type: 'list', coordinates: [] }, encode: { type: 'list', structures: [] } }), /not both/);
});

test('5.1 malformed geometry is refused up front', async () => {
   const space = Ither.from(pointFormula());
   const run = decode => Ither({ space, query: { decode, write() {} } });
   await assert.rejects(run({ type: 'grid', axes: [{ start: -1n, end: 1n }, { start: 0n, end: 1n }] }), /start/);
   await assert.rejects(run({ type: 'grid', axes: [{ start: 2n, end: 1n }, { start: 0n, end: 1n }] }), /start/);
   await assert.rejects(run({ type: 'grid', axes: [{ start: 0n, end: 1n }] }), /2 axes/);
   await assert.rejects(run({ type: 'ray', start: [-1n, 0n], direction: [1n, 0n], count: 1n }), /start/);
   await assert.rejects(run({ type: 'ray', start: [0n, 0n], direction: [0n, 0n], count: 1n }), /direction/);
   await assert.rejects(run({ type: 'ray', start: [0n, 0n], direction: [1n, 0n], count: -1n }), /count/);
   await assert.rejects(run({ type: 'list', coordinates: [[0n]] }), /2 BigInt/);
   await assert.rejects(run({ type: 'list', coordinates: [[0n, 1]] }), /BigInt/);
   await assert.rejects(run({ type: 'list', coordinates: 'nope' }), /array/);
});

//////////////////////////////////////////////////////////////////////////////
// 5.1 one bounds rule: skipped and counted, for every geometry
//////////////////////////////////////////////////////////////////////////////

test('5.1 a ray past a fixed bound or below zero is skipped and counted, not refused', async () => {
   const space = Ither.from(pointFormula()); // bounds [4, 3]
   const { records, query } = await collect(space, {
      decode: { type: 'ray', start: [0n, 2n], direction: [1n, -1n], count: 6n },
   });
   // k: 0 [0,2] · 1 [1,1] · 2 [2,0] · 3 [3,-1] out · 4 [4,-2] out · 5 [5,-3] out
   assert.deepEqual(records.map(record => [record.ordinal, record.coordinate]), [[0n, [0n, 2n]], [1n, [1n, 1n]], [2n, [2n, 0n]]]);
   assert.equal(query.outside, 3n);
   assert.equal(query.total, 3n, 'every axis is fixed, so the in-range points are known up front');
   assert.equal(query.nextOffset, 6n);

   const late = await collect(space, { decode: { type: 'ray', start: [5n, 0n], direction: [-1n, 0n], count: 7n } });
   // k: 0 [5] out · 1 [4] out · 2..5 [3..0] · 6 [-1] out
   assert.deepEqual(late.records.map(record => record.ordinal), [2n, 3n, 4n, 5n]);
   assert.equal(late.query.outside, 3n);
});

test('5.1 a list checks each coordinate: past a fixed bound, negative, or past a resolved range is outside', async () => {
   const space = Ither.from(chainedFormula());
   const { records, query } = await collect(space, {
      decode: { type: 'list', coordinates: [[0n, 0n], [-1n, 0n], [0n, 1n], [0n, 2n], [10n ** 30n, 0n], [1n, 0n]] },
   });
   // topology 0 is a leaf 'x': its axis has 2 values
   assert.deepEqual(records.map(record => record.ordinal), [0n, 2n, 5n]);
   assert.equal(query.outside, 3n);
});

//////////////////////////////////////////////////////////////////////////////
// 5.1 the encode direction
//////////////////////////////////////////////////////////////////////////////

test('5.1 encode: a list of structures in, coordinate records out, under the same record contract', async () => {
   const space = oneLayer();
   const structures = [space.decode([2n]), { a: { p: 'nope', q: 0 } }, space.decode([1n])];
   const { records, query } = await collect(space, { encode: { type: 'list', structures } });
   assert.deepEqual(records[0], { ordinal: 0n, structure: structures[0], status: 'structure', coordinate: [2n] });
   assert.equal(records[1].status, 'error');
   assert.match(records[1].error.message, /layer 'a'/);
   assert.deepEqual(Object.keys(records[1]).sort(), ['error', 'ordinal', 'status', 'structure']);
   assert.deepEqual(records[2].coordinate, [1n]);
   assert.deepEqual([query.records, query.structures, query.errors, query.total], [3n, 2n, 1n, 3n]);
});

test('5.1 encode: the form of every structure is checked before the query starts', async () => {
   const space = Ither.from(pointFormula());
   let written = 0;
   const run = structures => Ither({ space, query: { encode: { type: 'list', structures }, write: () => { written++; } } });
   await assert.rejects(run([{ point: { x: 0, y: 0 } }, { nope: 1 }]), /structures\[1\].*unknown layer 'nope'/);
   await assert.rejects(run([{}]), /structures\[0\].*'point'/);
   await assert.rejects(run(['text']), /structures\[0\]/);
   assert.equal(written, 0);
});

//////////////////////////////////////////////////////////////////////////////
// holes and errors
//////////////////////////////////////////////////////////////////////////////

test('holes and decode errors are records; a query does not stop for them', async () => {
   const space = Ither.from({
      layers: { value: { type: 'NUM', domains: { x: { min: 0, max: 3, steps: 4 } } } },
      projection: [['value.x']],
   });
   const patched = Object.create(space, {
      decode: {
         value: coordinate => {
            if (coordinate[0] === 1n) return Ither.HOLE;
            if (coordinate[0] === 2n) throw new Error('bad coordinate');
            return space.decode(coordinate);
         },
      },
   });
   const { records, query } = await collect(patched, { decode: { type: 'grid', axes: [{ start: 0n, end: 3n }] } });
   assert.deepEqual(records.map(record => record.status), ['structure', 'hole', 'error', 'structure']);
   assert.deepEqual(Object.keys(records[1]).sort(), ['coordinate', 'ordinal', 'status']);
   assert.deepEqual(records[2].error, { name: 'Error', message: 'bad coordinate' });
   assert.deepEqual([query.structures, query.holes, query.errors, query.records], [2n, 1n, 1n, 4n]);
});

test('a sparse (Cantor) axis walked by grid, ray and list: every record is a structure or a hole', async () => {
   const space = Ither.from(sparseFormula());
   assert.deepEqual(space.axisBounds(), [null]);
   for (const decode of [
      { type: 'grid', axes: [{ start: 0n, end: 20n }] },
      { type: 'ray', start: [2n], direction: [3n], count: 4n },
      { type: 'list', coordinates: [[0n], [7n], [100n]] },
   ]) {
      const { records, query } = await collect(space, { decode });
      assert.equal(query.outside, 0n);
      for (const record of records) {
         assert.ok(record.status === 'structure' || record.status === 'hole', record.status);
         if (record.status === 'structure') assert.deepEqual(space.encode(record.structure), record.coordinate);
      }
      assert.equal(query.total, query.records, 'no axis depends on another, so every walker knows its in-range points up front');
   }
});

//////////////////////////////////////////////////////////////////////////////
// 5.3 paging in positions
//////////////////////////////////////////////////////////////////////////////

test('5.3 offset, limit, count and nextOffset all count ordinals: offset + limit is the next page', async () => {
   const space = Ither.from(chainedFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 7n }, { start: 0n, end: 15n }] };
   const whole = await collect(space, { decode });
   assert.equal(whole.query.count, 128n);

   const pages = [];
   let paged = [];
   for (let offset = 0n; offset < 128n; offset += 30n) {
      const page = await collect(space, { decode, offset, limit: 30n });
      pages.push(page.query);
      paged = paged.concat(page.records);
      assert.equal(page.query.nextOffset, offset + 30n > 128n ? 128n : offset + 30n);
      assert.ok(page.records.every(record => record.ordinal >= offset && record.ordinal < offset + 30n));
   }
   assert.deepEqual(paged, whole.records);
   assert.deepEqual(pages.map(page => page.stop), ['limit', 'limit', 'limit', 'limit', 'end']);
   assert.ok(pages.every(page => page.complete));
   assert.equal(pages.reduce((sum, page) => sum + page.outside, 0n), whole.query.outside);
});

test('5.3 stop names why a page ended: end, limit, write or signal', async () => {
   const space = Ither.from(pointFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 3n }, { start: 0n, end: 2n }] };

   const byWrite = await Ither({ space, query: { decode, write: record => record.ordinal < 4n } });
   assert.deepEqual([byWrite.query.stop, byWrite.query.complete, byWrite.query.nextOffset, byWrite.query.records], ['write', false, 5n, 5n]);

   const empty = await collect(space, { decode, offset: 2n, limit: 0n });
   assert.deepEqual([empty.query.stop, empty.query.complete, empty.query.nextOffset, empty.records.length], ['limit', true, 2n, 0]);

   const controller = new AbortController();
   controller.abort();
   const bySignal = await collect(space, { decode, signal: controller.signal });
   assert.deepEqual([bySignal.query.stop, bySignal.query.complete, bySignal.query.records], ['signal', false, 0n]);

   await assert.rejects(Ither({ space, query: { decode, offset: 13n, write() {} } }), /offset/);
   await assert.rejects(Ither({ space, query: { decode, limit: -1n, write() {} } }), /limit/);
   await assert.rejects(Ither({ space, query: { decode, limit: 1, write() {} } }), /BigInt/);
});

//////////////////////////////////////////////////////////////////////////////
// 5.2 progress: one report, driven by time
//////////////////////////////////////////////////////////////////////////////

function largeFormula() {
   return {
      layers: {
         p: { type: 'NUM', domains: { x: { min: 0, max: 1, steps: 1000 }, y: { min: 0, max: 1, steps: 1000 } } },
      },
      projection: [['p.x'], ['p.y']],
   };
}
const largeGrid = { type: 'grid', axes: [{ start: 0n, end: 999n }, { start: 0n, end: 999n }] };

test('5.2 write receives only the record', async () => {
   const lengths = new Set();
   await Ither({
      space: pointFormula(),
      query: { decode: { type: 'list', coordinates: [[0n, 0n], [1n, 1n]] }, write(...args) { lengths.add(args.length); } },
   });
   assert.deepEqual([...lengths], [1]);
});

test('5.2 progress fires by time during a walk that delivers nothing, and once at the end', async () => {
   const space = Ither.from(uncappedChainedFormula());
   const reports = [];
   const controller = new AbortController();
   setTimeout(() => controller.abort(), 60);
   const { query } = await Ither({
      space,
      query: {
         // every topology's template is far narrower than 10^60: no point is in range
         decode: { type: 'grid', axes: [{ start: 0n, end: 10n ** 7n }, { start: 10n ** 60n, end: 10n ** 60n }] },
         signal: controller.signal, write: () => {}, progress: report => reports.push(report),
      },
   });
   assert.ok(reports.length >= 2, `progress ran during the walk (${reports.length} reports)`);
   assert.ok(reports.slice(0, -1).every(report => report.records === 0n && report.stop === null && report.outside > 0n));
   assert.equal(reports.at(-1), query, 'the final report is the query result');
   assert.equal(query.stop, 'signal');
   assert.ok(reports.every(report => Object.keys(report).sort().join() === REPORT_KEYS.join()));
});

test('5.2 a final report on completion, on write returning false and on cancel, equal to the result', async () => {
   const space = Ither.from(pointFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 3n }, { start: 0n, end: 2n }] };
   const finals = async (query, signal) => {
      const reports = [];
      const result = await Ither({ space, query: { decode, progress: report => reports.push(report), ...(signal ? { signal } : {}), ...query } });
      assert.equal(reports.length, 1, 'a short walk reports once, at the end');
      assert.equal(reports[0], result.query);
      assert.ok(Object.isFrozen(result.query));
      return result.query;
   };
   const done = await finals({ write() {} });
   assert.deepEqual([done.stop, done.complete, done.fraction, done.remaining, done.remainingMs], ['end', true, 1, 0n, 0]);
   const stopped = await finals({ write: () => false });
   assert.deepEqual([stopped.stop, stopped.records], ['write', 1n]);
   const controller = new AbortController();
   controller.abort();
   const cancelled = await finals({ write() {} }, controller.signal);
   assert.deepEqual([cancelled.stop, cancelled.records, cancelled.fraction], ['signal', 0n, 0]);
});

test('5.2 the report states only what is known: total and time remaining are null where not known up front', async () => {
   const space = Ither.from(chainedFormula());
   const { query } = await collect(space, { decode: { type: 'grid', axes: [{ start: 0n, end: 3n }, { start: 0n, end: 3n }] } });
   assert.deepEqual([query.total, query.remaining, query.remainingMs], [null, null, null]);
   assert.equal(typeof query.elapsedMs, 'number');
   assert.equal(query.fraction, 1);
   await assert.rejects(Ither({ space, query: { decode: { type: 'list', coordinates: [] }, write() {}, progress: 1 } }), /progress must be a function/);
   await assert.rejects(Ither({ space, query: { decode: { type: 'list', coordinates: [[0n, 0n]] }, write() {}, progress: async () => {} } }), /progress must be synchronous/);
});

//////////////////////////////////////////////////////////////////////////////
// the manifest (D6) and omissions (§5.3, D5)
//////////////////////////////////////////////////////////////////////////////

test('D6 the manifest is returned only when asked for', async () => {
   const space = Ither.from(pointFormula());
   const plain = await collect(space, { decode: { type: 'list', coordinates: [[0n, 0n]] } });
   assert.deepEqual(Object.keys(plain).sort(), ['query', 'records', 'space']);
   const asked = await collect(space, { decode: { type: 'list', coordinates: [[0n, 0n]] }, manifest: true });
   assert.deepEqual(Object.keys(asked).sort(), ['manifest', 'query', 'records', 'space']);
   await assert.rejects(Ither({ space, query: { decode: { type: 'list', coordinates: [] }, write() {}, manifest: 'yes' } }), /manifest must be true or false/);
});

test('D6 a manifest names everything needed to repeat the query, and repeating it gives the same records', async () => {
   const space = Ither.from(chainedFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 5n }, { start: 0n, end: 9n, step: 3n }] };
   const first = await collect(space, { decode, offset: 7n, limit: 40n, manifest: true });
   const { manifest } = first;
   assert.deepEqual(Object.keys(manifest).sort(), ['decode', 'formula', 'itherVersion', 'kind', 'limit', 'nextOffset', 'offset', 'omitted', 'packedBy', 'policy', 'version'].sort());
   assert.equal(manifest.kind, 'query-manifest');
   assert.equal(manifest.version, 1);
   assert.equal(manifest.itherVersion, Ither.version);
   assert.equal(manifest.packedBy, null);
   assert.deepEqual(manifest.formula, space.formula);
   assert.deepEqual(manifest.decode, { type: 'grid', axes: [{ start: 0n, end: 5n, step: 1n }, { start: 0n, end: 9n, step: 3n }] });
   assert.deepEqual(manifest.policy, { hole: 'record', outside: 'omit' });
   // 6.1 the manifest does not repeat the report the caller already has; it names where the walk ended
   assert.equal(manifest.nextOffset, first.query.nextOffset);
   assert.ok(Object.isFrozen(manifest.decode.axes[0]));

   const again = await collect(Ither.from(manifest.formula), { decode: manifest.decode, offset: manifest.offset, limit: manifest.limit });
   assert.deepEqual(again.records, first.records);

   // the documented recipe also repeats a query that had no limit (its manifest records limit: null)
   const unlimited = await collect(space, { decode, manifest: true });
   const { formula, offset, limit } = unlimited.manifest;
   assert.equal(limit, null);
   const repeated = await collect(Ither.from(formula), { decode: unlimited.manifest.decode, offset, ...(limit != null && { limit }) });
   assert.deepEqual(repeated.records, unlimited.records);
});

test('§5.3 the manifest names every omission: records and omitted runs cover [offset, nextOffset) exactly', async () => {
   const space = Ither.from(chainedFormula());
   const { records, manifest, query } = await collect(space, {
      decode: { type: 'grid', axes: [{ start: 0n, end: 9n }, { start: 0n, end: 31n }] }, offset: 3n, limit: 250n, manifest: true,
   });
   assert.deepEqual(Object.keys(manifest.omitted), ['outside']);
   const covered = [
      ...records.map(record => [record.ordinal, 1n]),
      ...manifest.omitted.outside,
   ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
   let cursor = manifest.offset;
   for (const [ordinal, length] of covered) {
      assert.equal(ordinal, cursor, 'no gap and no overlap');
      cursor += length;
   }
   assert.equal(cursor, manifest.nextOffset);
   assert.equal(manifest.nextOffset, query.nextOffset);
   assert.equal(manifest.omitted.outside.reduce((sum, [, length]) => sum + length, 0n), query.outside);
   // runs are merged: two omitted runs are never adjacent
   manifest.omitted.outside.forEach(([ordinal, length], i, runs) => {
      if (i > 0) assert.ok(runs[i - 1][0] + runs[i - 1][1] < ordinal);
   });
});

test('D5 holes are records and outside points omissions by default; the policy is one table the query reads, so holes can be omitted too', async () => {
   assert.deepEqual(DEFAULT_POLICY, { hole: 'record', outside: 'omit' });
   const space = Ither.from(sparseFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 20n }] };
   const byDefault = await collect(space, { decode, manifest: true });
   const holes = byDefault.records.filter(record => record.status === 'hole');
   assert.ok(holes.length > 0);

   const records = [];
   const omitting = await runQuery(space, { decode }, {
      write: record => { records.push(record); },
      policy: { hole: 'omit', outside: 'omit' },
      manifest: true,
   });
   assert.ok(records.every(record => record.status === 'structure'));
   assert.equal(omitting.report.holes, BigInt(holes.length), 'an omitted hole is still counted');
   assert.equal(omitting.report.records, BigInt(records.length));
   assert.deepEqual(omitting.manifest.policy, { hole: 'omit', outside: 'omit' });
   const holeOrdinals = omitting.manifest.omitted.hole.flatMap(([ordinal, length]) => Array.from({ length: Number(length) }, (_, i) => ordinal + BigInt(i)));
   assert.deepEqual(holeOrdinals, holes.map(record => record.ordinal));
   await assert.rejects(runQuery(space, { decode }, { write() {}, policy: { hole: 'drop', outside: 'omit' } }), /policy/);
});

test('describeGeometry inspects a geometry without decoding: count, total where known, and the box it covers', () => {
   const space = Ither.from(pointFormula());
   const spy = Object.create(space, { decode: { value: () => { throw new Error('decoded'); } } });
   assert.deepEqual(describeGeometry(spy, { type: 'grid', axes: [{ start: 1n, end: 5n, step: 2n }, { start: 0n, end: 2n }] }), {
      count: 9n, total: 6n, box: [{ min: 1n, max: 5n }, { min: 0n, max: 2n }],
   });
   assert.deepEqual(describeGeometry(spy, { type: 'ray', start: [0n, 2n], direction: [1n, -1n], count: 6n }), {
      count: 6n, total: 3n, box: [{ min: 0n, max: 5n }, { min: -3n, max: 2n }],
   });
   assert.deepEqual(describeGeometry(spy, { type: 'list', coordinates: [[3n, 0n], [9n, 1n]] }), {
      count: 2n, total: 1n, box: [{ min: 3n, max: 9n }, { min: 0n, max: 1n }],
   });
   assert.deepEqual(describeGeometry(spy, { type: 'list', coordinates: [] }), { count: 0n, total: 0n, box: null });
});

//////////////////////////////////////////////////////////////////////////////
// request validation and the public surface
//////////////////////////////////////////////////////////////////////////////

test('the query request refuses what it does not understand', async () => {
   const space = Ither.from(pointFormula());
   const decode = { type: 'list', coordinates: [[0n, 0n]] };
   await assert.rejects(Ither({ query: { decode, write() {} } }), /requires request\.space/);
   await assert.rejects(Ither({ space, query: { decode } }), /query\.write/);
   await assert.rejects(Ither({ space, query: { decode, write() {}, typo: 1 } }), /unknown query key 'typo'/);
   await assert.rejects(Ither({ space, query: { decode, write: async () => {} } }), /write must be synchronous/);
   await assert.rejects(Ither({ space, query: { decode, write() {}, signal: {} } }), /signal/);
});

test('Space has no query method, and the query machinery stays internal', () => {
   const space = Ither.from(pointFormula());
   assert.equal('query' in space, false);
   for (const name of ['CoordinateGrid', 'CoordinateRay', 'CoordinateList', 'SpaceQuery', 'runQuery', 'describeGeometry', 'assertWalker']) {
      assert.equal(name in publicApi, false, name);
   }
});

//////////////////////////////////////////////////////////////////////////////
// cancellation (kept from before §5; syntax updated only)
//////////////////////////////////////////////////////////////////////////////

test('a long query yields to the event loop, so an abort from a timer stops it cleanly', async () => {
   const controller = new AbortController();
   let delivered = 0n;
   let firedAt = null;
   setTimeout(() => { firedAt = delivered; controller.abort(); }, 20);

   const { query } = await Ither({
      space: largeFormula(),
      query: { decode: largeGrid, signal: controller.signal, write: () => { delivered++; } },
   });

   assert.notEqual(firedAt, null, 'the timer ran while the query was still walking');
   assert.equal(query.stop, 'signal');
   assert.equal(query.complete, false);
   assert.ok(query.records < 1_000_000n);
   assert.equal(query.records, delivered);
   assert.equal(query.nextOffset, delivered, 'every point is in range, so the next offset follows the last record');
});

test('a cancelled query resumes from nextOffset without losing or repeating a point', async () => {
   const space = Ither.from(largeFormula());
   const decode = { type: 'grid', axes: [{ start: 0n, end: 99n }, { start: 0n, end: 99n }] };
   const controller = new AbortController();
   const first = [];
   const stopped = await Ither({
      space,
      query: {
         decode, signal: controller.signal,
         write: record => { first.push(record.ordinal); if (first.length === 1234) controller.abort(); },
      },
   });
   assert.equal(stopped.query.stop, 'signal');
   assert.equal(stopped.query.nextOffset, 1234n);

   const rest = [];
   const resumed = await Ither({
      space,
      query: { decode, offset: stopped.query.nextOffset, write: record => rest.push(record.ordinal) },
   });
   assert.equal(resumed.query.stop, 'end');
   assert.deepEqual([...first, ...rest], Array.from({ length: 10_000 }, (_, i) => BigInt(i)));
});

test('a walk that skips every point still yields, and can be cancelled', async () => {
   const space = Ither.from(uncappedChainedFormula());
   const controller = new AbortController();
   setTimeout(() => controller.abort(), 20);

   const { query } = await Ither({
      space,
      query: {
         decode: { type: 'grid', axes: [{ start: 0n, end: 10n ** 7n }, { start: 10n ** 60n, end: 10n ** 60n }] },
         signal: controller.signal, write: () => {},
      },
   });
   assert.equal(query.stop, 'signal');
   assert.equal(query.records, 0n);
   assert.ok(query.outside > 0n);
   assert.equal(query.nextOffset, query.outside);
});

// Layers keep per-call state (a chained STR's template, an LSM's last
// structure), which is safe only because a point decodes in one synchronous pass and a
// query yields between points. Two queries on one Space, interleaved at their yields,
// must each return exactly what it returns alone.
test('5.5 two concurrent queries on one Space return exactly the records each returns alone', async () => {
   const space = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 7 } },
         expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
         plant: { type: 'LSM', shape: { variables: ['F'], axiom: 'F' }, domains: { alphabet: ['F', '+'] }, options: { maxLen: 4, iterations: 1 } },
         shape: { type: 'STR', from: 'plant', domains: { F: ['Fa', 'Fb'] } },
      },
      projection: [['topo'], ['expr'], ['plant'], ['shape']],
   });
   const geometries = {
      a: { type: 'grid', axes: [{ start: 0n, end: 9n }, { start: 0n, end: 15n }, { start: 0n, end: 9n }, { start: 0n, end: 7n }] },
      b: { type: 'grid', axes: [{ start: 4n, end: 9n }, { start: 0n, end: 15n, step: 3n }, { start: 3n, end: 9n }, { start: 0n, end: 7n }] },
   };
   const plain = record => ({ ...record, value: structuredClone(record.value) });
   const run = async (name, trace = null) => {
      const records = [];
      const { query } = await Ither({
         space,
         query: {
            decode: geometries[name],
            write: record => {
               records.push(plain(record));
               if (trace) {
                  if (trace.at(-1) !== name) trace.push(name);
                  // make each record cost time, so each query spans several slices
                  const until = performance.now() + 0.05;
                  while (performance.now() < until);
               }
            },
         },
      });
      return { records, query };
   };

   const alone = { a: await run('a'), b: await run('b') };
   assert.ok(alone.a.records.length > 1000 && alone.b.records.length > 500);

   const trace = [];
   const [a, b] = await Promise.all([run('a', trace), run('b', trace)]);
   assert.ok(trace.length >= 3, `the two queries interleaved (${trace.join('')})`);
   const untimed = ({ records, query }) => ({ records, query: { ...query, elapsedMs: 0, recordsPerSecond: 0, remainingMs: 0 } });
   assert.deepEqual(untimed(a), untimed(alone.a));
   assert.deepEqual(untimed(b), untimed(alone.b));
});

//////////////////////////////////////////////////////////////////////////////
// 5.1 the single operations: one input form each (D1a), recover (D1b)
//////////////////////////////////////////////////////////////////////////////

const oneLayer = () => Ither.from({ layers: { a: { type: 'OBJ', domains: { p: ['x', 'y'], q: [0, 1] } } } });
const chained = () => Ither.from({
   layers: {
      topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 5 } },
      expr: { type: 'STR', from: 'topo', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      tail: { type: 'STR', from: 'expr', domains: { a: ['1', '2'], b: ['3'], f: ['F'], g: ['G'] } },
   },
   projection: [['topo'], ['expr'], ['tail']],
});

test('5.1 D1a decode takes a coordinate array and returns a structure keyed by layer name, also for one layer and one axis', () => {
   const space = oneLayer();
   assert.equal(space.axisCount, 1);
   assert.deepEqual(space.decode([3n]), { a: { p: 'y', q: 1 } });
   assert.equal(space.decode([4n]), Ither.OUTSIDE);
   assert.equal(space.decode([-1n]), Ither.OUTSIDE);
   assert.throws(() => space.decode(3n), /array/);
   assert.throws(() => space.decode([3]), /BigInt/);
   assert.throws(() => space.decode([3n, 0n]), /1 BigInt/);
});

test('5.1 D1a encode takes a structure keyed by layer name and returns a coordinate array, also for one layer and one axis', () => {
   const space = oneLayer();
   assert.deepEqual(space.encode({ a: { p: 'y', q: 1 } }), [3n]);
   assert.throws(() => space.encode({ p: 'y', q: 1 }), /unknown layer 'p'/);
   assert.throws(() => space.encode([{ p: 'y', q: 1 }]), /keyed by layer name/);
   assert.throws(() => space.encode('text'), /keyed by layer name/);
});

test('5.1 encode names the layer that cannot encode its part', () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { p: ['x', 'y'] } }, t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } } } });
   assert.throws(() => space.encode({ a: { p: 'nope' }, t: 'x' }), /layer 'a'/);
});

test('5.1 D1b recover completes a partial structure from chained layers, and encode takes the result', () => {
   const space = chained();
   const full = space.decode([4n, 3n, 1n]);
   assert.equal(typeof full.tail, 'string');
   const recovered = space.recover({ tail: full.tail });
   assert.deepEqual(recovered, full);
   assert.deepEqual(space.encode(space.recover({ tail: full.tail })), [4n, 3n, 1n]);
   // a downstream layer is never deduced: its structure is not determined by its source
   assert.throws(() => space.recover({ expr: full.expr }), /'tail'/);
   // a complete structure is returned as it is
   assert.deepEqual(space.recover(full), full);
});

test('5.1 D1b recover refuses what it cannot recover exactly, naming the layer, and never tries alternatives', () => {
   const space = chained();
   assert.throws(() => space.recover({ topo: 'x' }), /'expr'/);
   assert.throws(() => space.recover({ nope: 'x' }), /unknown layer 'nope'/);
   assert.throws(() => space.recover({ expr: 'f(a,zzz)' }), /'expr'/);
   const lsm = Ither.from({
      layers: {
         plant: { type: 'LSM', shape: { variables: ['F'], axiom: 'F' }, domains: { alphabet: ['F', '+'] }, options: { maxLen: 3 } },
         shape: { type: 'STR', from: 'plant', domains: { F: ['Fa', 'Fb'] } },
      },
   });
   assert.throws(() => lsm.recover({ shape: 'Fa+Fb' }), /'plant'.*LSM/);

   // two readings of the same token: refused as ambiguous, not resolved by a preference
   const twin = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x', 'y'], o2: ['o2'] } },
         expr: { type: 'STR', from: 'topo', domains: { x: ['a'], y: ['a'], o2: ['f'] } },
      },
   });
   assert.throws(() => twin.recover({ expr: 'f(a,a)' }), /ambiguous/);
   // an empty value leaves no trace in the text
   const empty = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         expr: { type: 'STR', from: 'topo', domains: { x: ['a', ''], o2: ['f'] } },
      },
   });
   assert.throws(() => empty.recover({ expr: 'f(a,)' }), /empty value/);
});

test('5.1 D1b recover reads an AST source token by token: a value that is a prefix of another is not ambiguous', () => {
   const fill = x => Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 7 } },
         fill: { type: 'STR', from: 'topo', domains: { x, o2: ['sub', '#'] } },
      },
   });
   const cases = [
      [['&V9.b', '&V9.g', '&V25.r', '0', '0.5'], '#(sub(&V9.b,&V9.g),#(&V25.r,0.5))', 'o2(o2(x,x),o2(x,x))'],
      [['&V4', '&V4.r', '1'], 'sub(&V4.r,1)', 'o2(x,x)'],
      [['&V4', '&V4.r', '1'], 'sub(&V4,&V4.r)', 'o2(x,x)'],
      [['&V', '&V4', '1'], 'sub(&V4,&V)', 'o2(x,x)'],
      [['a', 'ab'], 'sub(ab,a)', 'o2(x,x)'],
   ];
   for (const [values, text, topo] of cases) {
      const space = fill(values);
      const recovered = space.recover({ fill: text });
      assert.deepEqual(recovered, { topo, fill: text }, text);
      assert.deepEqual(space.decode(space.encode(recovered)), recovered, text);
   }
   // the tree decides which symbol a token stands for: the same value as a leaf and as an operator
   const shared = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         fill: { type: 'STR', from: 'topo', domains: { x: ['m'], o2: ['m'] } },
      },
   });
   assert.deepEqual(shared.recover({ fill: 'm(m,m)' }), { topo: 'o2(x,x)', fill: 'm(m,m)' });
   // a token no value matches, or text that is not a tree, is refused naming the layer
   const space = fill(['0', '0.5']);
   assert.throws(() => space.recover({ fill: 'sub(0,0.7)' }), /layer 'topo' from layer 'fill'.*'0\.7'/);
   assert.throws(() => space.recover({ fill: 'sub(0,0.5' }), /layer 'topo' from layer 'fill'/);
   // a value containing a delimiter cannot be tokenized: the character reading still applies
   const delimited = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         fill: { type: 'STR', from: 'topo', domains: { x: ['a,b', 'c'], o2: ['f'] } },
      },
   });
   assert.deepEqual(delimited.recover({ fill: 'f(a,b,c)' }), { topo: 'o2(x,x)', fill: 'f(a,b,c)' });
});

//////////////////////////////////////////////////////////////////////////////
// 5.4 encode policies: documented, not validated
//////////////////////////////////////////////////////////////////////////////

test('5.4 OBJ: a missing key is a radix-1 digit (a different structure), an extra key is ignored — as documented', () => {
   const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { p: ['a', 'b'], q: [0, 1] } } } });
   assert.deepEqual(space.encode({ a: { p: 'b' } }), [1n]);
   assert.deepEqual(space.decode([1n]), { a: { p: 'a', q: 1 } });
   assert.deepEqual(space.encode({ a: { p: 'b', q: 0, r: 9 } }), space.encode({ a: { p: 'b', q: 0 } }));
});

test('5.4 NUM: snaps to its grid, clamps to [min, max], encodes a missing or non-number value as min — as documented', () => {
   const space = Ither.from({ layers: { v: { type: 'NUM', domains: { x: { min: 0, max: 1, steps: 3 } } } } });
   assert.deepEqual(space.decode(space.encode({ v: { x: 0.4 } })), { v: { x: 0.5 } });
   assert.deepEqual(space.encode({ v: { x: 7 } }), [2n]);
   assert.deepEqual(space.encode({ v: { x: -2 } }), [0n]);
   assert.deepEqual(space.encode({ v: { x: 'hi' } }), [0n]);
   assert.deepEqual(space.encode({ v: {} }), [0n]);
});

test('5.4 the policies are stated where encode is documented', async () => {
   const { readFile } = await import('node:fs/promises');
   const source = await readFile(new URL('../src/formula/Space.js', import.meta.url), 'utf8');
   assert.match(source, /Encode does not validate a structure/);
   assert.match(source, /OBJ {2}a missing key is encoded as a digit of radix 1/);
   assert.match(source, /NUM {2}a value snaps to the nearest grid step/);
   assert.match(publicApi.capabilities().api.encode, /Does not validate a structure/);
});
