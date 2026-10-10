// Ither — the query engine (internal; reached through Ither({ space, query }))
//
// A query walks one input — a geometry under `decode`, or a list of structures under
// `encode` — and for every ordinal in its page either delivers a record to `write` or
// omits it. It reports progress by time, and ends with a final report; on request it also
// builds a manifest: everything needed to repeat the query, and every ordinal it omitted.
//
// Paging is in ordinals (positions): a page is [offset, end) with end = min(offset + limit,
// count), so offset + limit is the next page. `write` returning false stops after that
// record, the signal before the next step. Either way nextOffset resumes exactly.
//
// The report — identical in shape while running (to `progress`) and at the end (the result):
//   kind, version             'query-report', 1
//   offset, limit, count      the page asked for and the ordinals the input spans
//   nextOffset                the ordinal to resume from
//   fraction                  of the page's ordinals walked, 0..1
//   records                   records delivered to write
//   structures, holes, errors outcomes; an omitted hole is still counted in holes
//   outside                   ordinals omitted as out of range
//   total, remaining          records the page will deliver and those left, where known up
//                             front; else null
//   elapsedMs, recordsPerSecond, remainingMs
//                             time; remainingMs only where total is known
//   stop                      null while running; then 'end' | 'limit' | 'write' | 'signal'
//   complete                  true once the page's whole range was walked

import { Engine } from '../formula/Engine.js';
import { canonicalGeometry } from './Geometry.js';
import { SpaceQuery } from './SpaceQuery.js';
import { addRun } from './Runs.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const REQUEST_KEYS = new Set(['decode', 'encode', 'offset', 'limit']);
const OPTION_KEYS = new Set(['write', 'progress', 'signal', 'policy', 'manifest']);

// What becomes a record and what an omission, per outcome. One table the walk reads, so a
// setting can be exposed later without touching the walk. Today it
// is internal: holes are records (an in-range answer about the space), out-of-range points
// are omissions (a property of the geometry).
export const DEFAULT_POLICY = Object.freeze({ hole: 'record', outside: 'omit' });
const POLICY_VALUES = { hole: new Set(['record', 'omit']), outside: new Set(['omit']) };

function checkPolicy(policy) {
   if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('Ither query: policy must be an object');
   for (const key of Object.keys(policy)) {
      if (!hasOwn(POLICY_VALUES, key)) throw new TypeError(`Ither query: unknown policy key '${key}'`);
   }
   for (const [key, values] of Object.entries(POLICY_VALUES)) {
      if (!values.has(policy[key])) {
         throw new TypeError(`Ither query: policy.${key} must be ${[...values].map(value => `'${value}'`).join(' or ')}`);
      }
   }
   return Object.freeze({ hole: policy.hole, outside: policy.outside });
}

function requireBigInt(value, where) {
   if (typeof value !== 'bigint') throw new TypeError(`Ither query: ${where} must be a BigInt`);
   return value;
}

// A query yields to the event loop at least this often, so a timer, a signal handler, an
// abort or a progress report can run while it walks. The slice is measured in time, not
// records: a walk that skips out-of-range points can run long without a record.
const SLICE_MS = 16;
const now = () => globalThis.performance.now();
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

function isThenable(value) {
   return value != null && typeof value.then === 'function';
}

// Validates a query and fixes its input before anything is walked, so a caller (the façade,
// feeding a live analysis) knows the direction and the canonical input up front.
// Returns { direction, input, run({ manifest }?) } — run may still ask for the manifest.
export function prepareQuery(space, request, options = {}) {
   if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Ither query must be an object');
   for (const key of Object.keys(request)) {
      if (!REQUEST_KEYS.has(key)) throw new TypeError(`Ither query: unknown query key '${key}'`);
   }
   for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) throw new TypeError(`Ither query: unknown option '${key}'`);
   }
   const { write, progress = null, signal = null, manifest: wantManifest = false } = options;
   if (typeof write !== 'function') throw new TypeError('Ither query: write must be a function');
   const policy = checkPolicy(options.policy ?? DEFAULT_POLICY);

   const hasDecode = hasOwn(request, 'decode');
   if (hasDecode === hasOwn(request, 'encode')) {
      throw new TypeError(hasDecode
         ? 'Ither query takes query.decode or query.encode, not both'
         : 'Ither query requires query.decode or query.encode');
   }
   const direction = hasDecode ? 'decode' : 'encode';
   const { geometry, walker } = canonicalGeometry(space, direction, request[direction]);
   const query = new SpaceQuery(space, walker, direction);
   const count = walker.count;

   const offset = hasOwn(request, 'offset') ? requireBigInt(request.offset, 'offset') : 0n;
   const limit = hasOwn(request, 'limit') ? requireBigInt(request.limit, 'limit') : null;
   if (offset < 0n || offset > count) throw new RangeError(`Ither query: offset ${offset} is outside [0, ${count}]`);
   if (limit != null && limit < 0n) throw new RangeError('Ither query: limit must be non-negative');
   return Object.freeze({
      direction,
      input: geometry,
      run: ({ manifest = wantManifest } = {}) => walk({
         space, query, walker, count, offset, limit, geometry, direction, policy, write, progress, signal, wantManifest: manifest,
      }),
   });
}

export async function runQuery(space, request, options = {}) {
   return prepareQuery(space, request, options).run();
}

async function walk({ space, query, walker, count, offset, limit, geometry, direction, policy, write, progress, signal, wantManifest }) {
   const end = limit != null && offset + limit < count ? offset + limit : count;

   // Records the page will deliver, where known before walking. An omitted hole makes
   // that unknowable up front.
   const total = policy.hole === 'omit' ? null : walker.total(offset, end);
   const tally = { records: 0n, structures: 0n, holes: 0n, errors: 0n, outside: 0n, nextOffset: offset };
   const omitted = wantManifest
      ? Object.fromEntries(Object.entries(policy).filter(([, value]) => value === 'omit').map(([reason]) => [reason, []]))
      : null;
   const started = now();

   const report = stop => {
      const elapsedMs = now() - started;
      const span = end - offset;
      const remaining = total == null ? null : total - tally.records;
      return Object.freeze({
         kind: 'query-report',
         version: 1,
         offset,
         limit,
         count,
         nextOffset: tally.nextOffset,
         fraction: span === 0n ? 1 : Number(((tally.nextOffset - offset) * 1_000_000n) / span) / 1_000_000,
         records: tally.records,
         structures: tally.structures,
         holes: tally.holes,
         errors: tally.errors,
         outside: tally.outside,
         total,
         remaining,
         elapsedMs,
         recordsPerSecond: elapsedMs > 0 ? Number(tally.records) / (elapsedMs / 1000) : null,
         remainingMs: remaining == null ? null
            : remaining === 0n ? 0
               : tally.records === 0n ? null : (Number(remaining) * elapsedMs) / Number(tally.records),
         stop,
         complete: stop != null && tally.nextOffset === end,
      });
   };
   const emit = value => {
      if (progress && isThenable(progress(value))) throw new TypeError('Ither query.progress must be synchronous');
   };

   let stop = null;
   let sliceStart = started;
   for (const item of query.iterate({ offset, end, policy })) {
      // The only place a query yields: between points, never inside one. Layers keep
      // per-call state (a chained STR's template, an LSM's last structure — see
      // Engine._walk), so a point, and a grid step that resolves ranges, must run start
      // to finish synchronously. That is what lets several queries share one Space.
      if (now() - sliceStart >= SLICE_MS) {
         emit(report(null));
         await nextTask();
         sliceStart = now();
      }
      // checked before the step is delivered, so nextOffset still names this step
      if (signal?.aborted) {
         stop = 'signal';
         break;
      }
      if (hasOwn(item, 'omitted')) {
         tally[item.omitted === 'hole' ? 'holes' : 'outside'] += item.length;
         if (omitted) addRun(omitted[item.omitted], item.ordinal, item.length);
         tally.nextOffset = item.ordinal + item.length;
         continue;
      }

      tally.records++;
      if (item.status === 'structure') tally.structures++;
      else if (item.status === 'hole') tally.holes++;
      else tally.errors++;
      tally.nextOffset = item.ordinal + 1n;

      const decision = write(Object.freeze(item));
      if (isThenable(decision)) throw new TypeError('Ither query.write must be synchronous');
      if (decision === false) {
         stop = 'write';
         break;
      }
   }
   if (stop == null) stop = end === count ? 'end' : 'limit';

   const final = report(stop);
   emit(final);
   if (!wantManifest) return { report: final, manifest: null };

   for (const runs of Object.values(omitted)) for (const run of runs) Object.freeze(run);
   return {
      report: final,
      manifest: Object.freeze({
         kind: 'query-manifest',
         version: 1,
         itherVersion: Engine.version,
         packedBy: space.packedBy,
         formula: space.formula,
         [direction]: geometry,
         offset,
         limit,
         nextOffset: final.nextOffset,
         policy,
         omitted: Object.freeze(Object.fromEntries(Object.entries(omitted).map(([reason, runs]) => [reason, Object.freeze(runs)]))),
      }),
   };
}
