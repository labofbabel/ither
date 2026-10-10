// Ither — the façade: the whole library, in three tiers, behind one call.
//
//   1. formula    Ither.from(formula) -> Space      compile one object into a space
//                 Ither({ space })                   the same, in the workflow envelope
//   2. query      Ither({ space, query })            decode a geometry or encode structures:
//                                                     records, progress, a report, a manifest
//                 space.decode / encode / recover     the single operations a query batches
//   3. analysis   Ither({ space?, query?, analysis }) capsules run on the inputs a request
//                                                     supplies: a space, a geometry, records
//                                                     (live or saved), a manifest
//
// Ither is a stateless verb; a Space is the stateful value it works on. Each call
// resolves its Space explicitly and installs no process-wide state.

import { Space } from './formula/Space.js';
import { Engine } from './formula/Engine.js';
import { HOLE, OUTSIDE } from './formula/Sentinels.js';
import { analyzeSaved, checkAnalysisRequest, createSession } from './analysis/Analysis.js';
import { prepareQuery } from './query/Query.js';
import { canonicalGeometry } from './query/Geometry.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const REQUEST_KEYS = new Set(['space', 'query', 'analysis']);

function assertObject(value, where) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${where} must be an object`);
   }
}

function assertKeys(value, allowed, where) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`${where}: unknown property '${key}'`);
   }
}

function resolveSpace(input) {
   return input instanceof Space ? input : new Space(input);
}

const QUERY_KEYS = new Set(['decode', 'encode', 'offset', 'limit', 'write', 'progress', 'signal', 'manifest']);

function splitQuery(config) {
   assertObject(config, 'Ither query');
   for (const key of Object.keys(config)) {
      if (!QUERY_KEYS.has(key)) throw new TypeError(`Ither query: unknown query key '${key}'`);
   }
   const { write, progress, signal, manifest = false, ...request } = config;
   if (write != null && typeof write !== 'function') throw new TypeError('Ither query.write must be a function');
   if (progress != null && typeof progress !== 'function') throw new TypeError('Ither query.progress must be a function');
   if (signal != null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('Ither query.signal must be an AbortSignal');
   }
   if (typeof manifest !== 'boolean') throw new TypeError('Ither query.manifest must be true or false');
   return { write, progress: progress ?? null, signal: signal ?? null, manifest, request };
}

// The one place a request's parts meet. A live query and a saved record set become the same
// analysis inputs (space, geometry, records, manifest); each input has exactly one source.
async function runIther(request) {
   assertObject(request, 'Ither request');
   assertKeys(request, REQUEST_KEYS, 'Ither request');
   if (!hasOwn(request, 'space') && !hasOwn(request, 'query') && !hasOwn(request, 'analysis')) {
      throw new TypeError('Ither request must include space, query, and/or analysis');
   }

   const space = hasOwn(request, 'space') ? resolveSpace(request.space) : null;
   if (hasOwn(request, 'query') && !space) {
      throw new TypeError('Ither query requires request.space (a formula or existing Space)');
   }
   const analysis = hasOwn(request, 'analysis') ? request.analysis : undefined;
   if (analysis !== undefined) checkAnalysisRequest(analysis);

   const result = {};
   if (space) result.space = space;

   if (!hasOwn(request, 'query')) {
      if (analysis !== undefined) {
         if (hasOwn(analysis, 'geometry') && !space) throw new TypeError('Ither analysis.geometry needs request.space: a geometry is checked against it');
         if (hasOwn(analysis, 'geometry') && hasOwn(analysis.manifest ?? {}, 'decode')) {
            throw new TypeError('Ither analysis.geometry cannot be combined with analysis.manifest, which carries its own geometry');
         }
         const geometry = hasOwn(analysis, 'geometry') ? canonicalGeometry(space, 'decode', analysis.geometry).geometry : null;
         result.analysis = await analyzeSaved(analysis, { space, geometry });
      }
      return Object.freeze(result);
   }

   const { write, progress, signal, manifest, request: query } = splitQuery(request.query);
   if (!write && analysis === undefined) {
      throw new TypeError('Ither query requires query.write unless its records are consumed by analysis');
   }
   if (analysis !== undefined) {
      for (const key of ['records', 'manifest', 'geometry']) {
         if (hasOwn(analysis, key)) throw new TypeError(`Ither analysis.${key} cannot be combined with a live query, which supplies its own`);
      }
   }

   let session = null;
   const prepared = prepareQuery(space, query, {
      write: record => {
         session?.observe(record);
         return write ? write(record) : undefined;
      },
      progress,
      signal,
   });
   if (analysis !== undefined) {
      session = createSession(analysis, {
         space,
         geometry: prepared.direction === 'decode' ? prepared.input : null,
         direction: prepared.direction,
         live: true,
         records: true,
         manifest: 'live',
      });
   }

   // the manifest is built when the caller asks for it or a capsule requires it
   const outcome = await prepared.run({ manifest: manifest || Boolean(session?.needsManifest) });
   result.query = outcome.report;
   if (manifest) result.manifest = outcome.manifest;
   if (session) result.analysis = session.finish(outcome.manifest);
   return Object.freeze(result);
}

// The callable. It is not a constructor: a space is defined by a formula, never
// assembled step by step.
export function Ither(request) {
   if (new.target) {
      throw new TypeError('Ither is not a constructor — compile a space with Ither.from(formula)');
   }
   return runIther(request);
}

Ither.from = formula => new Space(formula);
Ither.version = Engine.version;

// decode's two sentinels, checked with ===. HOLE: an in-range coordinate that names
// no structure. OUTSIDE: a coordinate past the range its axes have there.
Ither.HOLE = HOLE;
Ither.OUTSIDE = OUTSIDE;
