// Ither — built-in analysis capsules
//
// Small reducers over the inputs they declare (the contract: src/analysis/Analysis.js).
// Custom capsules use the same contract, supplied per request.
//
//   capsule                  category  requires
//   space-summary            space     space
//   space-axes               space     space
//   space-layers             space     space
//   space-checks             space     space
//   geometry-summary         query     space, geometry
//   dataset-integrity        query     records
//   dataset-coverage         query     records, manifest
//   structure-distribution   query     records
//   mapping-roundtrip        lib       space, records
//   space-serialization      lib       space
//   space-suite, query-suite, lib-suite — suites

import { Space } from '../formula/Space.js';
import { Engine } from '../formula/Engine.js';
import { LAYER_RULES } from '../formula/FormulaRules.js';
import { describeGeometry } from '../query/Geometry.js';
import { addRun, checkCoverage } from '../query/Runs.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const RECORD_STATUSES = new Set(['structure', 'hole', 'error']);
const MAX_ISSUES = 32;

const messageOf = error => (error instanceof Error ? error.message : String(error));

// Issues about a record name its row (its position in the record stream) and its ordinal when
// it has one; issues about the whole set name neither.
function issueCollector() {
   const issues = [];
   let count = 0n;
   return {
      add(code, message, { row = null, ordinal = null } = {}) {
         count++;
         if (issues.length < MAX_ISSUES) issues.push({ code, message, row, ordinal });
      },
      get count() { return count; },
      fields() {
         return { issues, issuesTruncated: count > BigInt(issues.length) };
      },
   };
}

const at = (record, row) => ({ row, ordinal: record && typeof record.ordinal === 'bigint' ? record.ordinal : null });

//////////////////////////////////////////////////////////////////////////////
// space
//////////////////////////////////////////////////////////////////////////////

const spaceSummary = {
   type: 'space-summary',
   description: 'Space-level facts: axis count, whether the space is finite, coordinate and structure cardinalities, layer names, and the versions that compiled and packed it.',
   category: 'space',
   version: 1,
   requires: ['space'],
   create() {
      return {
         finish({ inputs: { space } }) {
            const { axes } = space._facts();
            const finite = axes.every(axis => axis.boundReason === 'fixed');
            return {
               status: 'pass',
               metrics: {
                  axisCount: space.axisCount,
                  finite,
                  coordinateCardinality: finite ? axes.reduce((product, axis) => product * axis.bound, 1n) : null,
                  structureCardinality: space.cardinality,
                  layerNames: space.layerNames.slice(),
                  itherVersion: Engine.version,
                  packedBy: space.packedBy,
               },
            };
         },
      };
   },
};

// A projection reference as a source of its axis: the whole layer, a part (an OBJ/NUM key, an
// ARR position, an STR variable), or one segment of a layer split across axes.
function sourcesOf(space, axis, splitAxes) {
   return space.formula.projection[axis].map(ref => {
      const dot = ref.indexOf('.');
      if (dot >= 0) return { layer: ref.slice(0, dot), route: 'part', part: ref.slice(dot + 1) };
      const segments = splitAxes[ref];
      return segments.length > 1 ? { layer: ref, route: 'split', segment: segments.indexOf(axis) } : { layer: ref, route: 'whole' };
   });
}

const spaceAxes = {
   type: 'space-axes',
   description: 'Per axis: its bound and why (fixed, capped, sparse or dependent), the axes it depends on, its combine, and the layer sources routed onto it.',
   category: 'space',
   version: 1,
   requires: ['space'],
   create() {
      return {
         finish({ inputs: { space } }) {
            const splitAxes = {};
            space.formula.projection.forEach((refs, axis) => refs.forEach(ref => {
               if (!ref.includes('.')) (splitAxes[ref] ||= []).push(axis);
            }));
            const axes = space._facts().axes.map((fact, axis) => ({ axis, ...fact, sources: sourcesOf(space, axis, splitAxes) }));
            return { status: 'pass', metrics: { axes } };
         },
      };
   },
};

const spaceLayers = {
   type: 'space-layers',
   description: 'Per layer: type, cardinality, whether it is bounded and partable, the layer it is chained from, and its domain sizes.',
   category: 'space',
   version: 1,
   requires: ['space'],
   create() {
      return {
         finish({ inputs: { space } }) {
            const facts = space._facts().layers;
            const layers = space.layerNames.map((name, index) => {
               const formula = space.formula.layers[name];
               const { cardinality } = facts[index];
               const domainSizes = {};
               for (const [domain, value] of Object.entries(formula.domains ?? {})) {
                  domainSizes[domain] = formula.type === 'NUM' ? value.steps : value.length;
               }
               return {
                  index,
                  name,
                  type: formula.type,
                  cardinality,
                  bounded: cardinality != null,
                  partable: LAYER_RULES[formula.type].parting != null,
                  parting: LAYER_RULES[formula.type].parting,
                  chainedFrom: formula.from ?? null,
                  domainSizes,
               };
            });
            return { status: 'pass', metrics: { count: BigInt(layers.length), layers } };
         },
      };
   },
};

// What a formula that compiles can still get wrong. Everything else — an unassigned layer or
// part, an unknown reference, a combine that cannot apply — is refused at compile time.
function notices(space) {
   const found = [];
   for (const name of space.layerNames) {
      const layer = space.formula.layers[name];
      if (layer.type === 'TRI' || layer.type === 'PERM') continue;
      const domains = layer.domains ?? {};
      if (Object.keys(domains).length === 0) {
         found.push({ level: 'error', code: 'space.empty-domains', message: `layer '${name}' has no domains`, context: { layer: name } });
      }
      for (const [domain, values] of Object.entries(domains)) {
         if (Array.isArray(values) && values.length === 0) {
            found.push({ level: 'error', code: 'space.empty-domain', message: `layer '${name}' domain '${domain}' is empty`, context: { layer: name, domain } });
         }
      }
   }
   // an empty domain leaves the axes without computable bounds
   if (found.length > 0) return found;
   space._facts().axes.forEach(({ bound }, axis) => {
      if (bound === 1n) found.push({ level: 'warn', code: 'space.degenerate-axis', message: `axis ${axis} has one value`, context: { axis } });
   });
   return found;
}

const spaceChecks = {
   type: 'space-checks',
   description: 'Structural checks on the compiled space: no empty domains, no degenerate (single-value) axes.',
   category: 'space',
   version: 1,
   requires: ['space'],
   create() {
      return {
         finish({ inputs: { space } }) {
            const list = notices(space);
            const codes = new Set(list.map(notice => notice.code));
            const checks = {
               noEmptyDomains: !codes.has('space.empty-domain') && !codes.has('space.empty-domains'),
               noDegenerateAxes: !codes.has('space.degenerate-axis'),
            };
            const errors = list.filter(notice => notice.level === 'error').length;
            const warnings = list.filter(notice => notice.level === 'warn').length;
            return {
               status: errors > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
               metrics: {
                  checks: BigInt(Object.keys(checks).length),
                  passed: BigInt(Object.values(checks).filter(Boolean).length),
                  warnings: BigInt(warnings),
                  errors: BigInt(errors),
               },
               checks,
               notices: list,
            };
         },
      };
   },
};

const spaceSerialization = {
   type: 'space-serialization',
   description: 'pack, then Space.unpack, then pack again gives the same packed string.',
   category: 'lib',
   version: 1,
   requires: ['space'],
   create() {
      return {
         finish({ inputs: { space } }) {
            const found = issueCollector();
            let packed = null;
            try {
               packed = space.pack();
               const restored = Space.unpack(packed);
               if (restored.pack() !== packed) found.add('pack-instability', 'packing the restored Space changed the payload');
               if (restored.axisCount !== space.axisCount) found.add('axis-count-mismatch', 'the restored Space has a different number of axes');
               const before = space.axisBounds();
               const after = restored.axisBounds();
               if (before.length !== after.length || before.some((bound, axis) => bound !== after[axis])) {
                  found.add('bound-mismatch', 'the restored Space has different axis bounds');
               }
            } catch (error) {
               found.add('serialization-error', messageOf(error));
            }
            return {
               status: found.count === 0n ? 'pass' : 'fail',
               metrics: { packedBytes: packed == null ? null : BigInt(new TextEncoder().encode(packed).length), failures: found.count },
               ...found.fields(),
            };
         },
      };
   },
};

//////////////////////////////////////////////////////////////////////////////
// space and geometry
//////////////////////////////////////////////////////////////////////////////

// The dry run: what a decode geometry covers, counted without decoding anything.
//   count          the ordinals it spans
//   total          its in-range points where known up front, else null
//   box            per axis, { min, max } of its coordinates (null when it has none)
//   dependentAxes  the axes whose range is resolved per coordinate — why total can be unknown
const geometrySummary = {
   type: 'geometry-summary',
   description: 'What a geometry would walk, without decoding anything: its type, point count, in-range total and bounding box, and which axes have dependent bounds.',
   category: 'query',
   version: 1,
   requires: ['space', 'geometry'],
   create() {
      return {
         finish({ inputs: { space, geometry } }) {
            const { count, total, box } = describeGeometry(space, geometry);
            const dependentAxes = space._facts().axes.flatMap((fact, axis) => (fact.boundReason === 'dependent' ? [axis] : []));
            return { status: 'pass', metrics: { type: geometry.type, count, total, box, dependentAxes } };
         },
      };
   },
};

//////////////////////////////////////////////////////////////////////////////
// records
//////////////////////////////////////////////////////////////////////////////

const datasetIntegrity = {
   type: 'dataset-integrity',
   description: 'Record shape, statuses and ordinal order; counts of records, structures, holes, errors and adapter errors.',
   category: 'query',
   version: 1,
   requires: ['records'],
   create() {
      const tally = { records: 0n, structures: 0n, holes: 0n, errors: 0n, adapterErrors: 0n };
      let axisCount = null;
      let previousOrdinal = null;
      const found = issueCollector();
      return {
         adapterError(row, error) {
            tally.adapterErrors++;
            found.add('adapter-error', messageOf(error), { row });
         },
         observe(record, row) {
            tally.records++;
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
               found.add('invalid-record', 'a record must be an object', { row });
               return;
            }
            const where = at(record, row);
            if (!RECORD_STATUSES.has(record.status)) found.add('invalid-status', "status must be 'structure', 'hole', or 'error'", where);
            else if (record.status === 'structure') {
               tally.structures++;
               if (!hasOwn(record, 'structure')) found.add('missing-structure', "a structure record must own a 'structure' property", where);
            } else if (record.status === 'hole') tally.holes++;
            else {
               tally.errors++;
               if (!hasOwn(record, 'error')) found.add('missing-error', "an error record must own an 'error' property", where);
            }

            if (!hasOwn(record, 'ordinal') || typeof record.ordinal !== 'bigint' || record.ordinal < 0n) {
               found.add('invalid-ordinal', 'a record needs an ordinal: a non-negative BigInt', { row });
            } else {
               // a query omits out-of-range points, so ordinals may leave gaps; a repeated or
               // backwards ordinal still means the set is broken
               if (previousOrdinal != null && record.ordinal <= previousOrdinal) {
                  found.add('ordinal-order', `ordinal ${record.ordinal} does not follow ${previousOrdinal}`, where);
               }
               previousOrdinal = record.ordinal;
            }

            if (hasOwn(record, 'coordinate')) {
               if (!Array.isArray(record.coordinate) || record.coordinate.length === 0
                  || record.coordinate.some(value => typeof value !== 'bigint' || value < 0n)) {
                  found.add('invalid-coordinate', 'coordinate must be a non-empty array of non-negative BigInts', where);
               } else if (axisCount == null) axisCount = record.coordinate.length;
               else if (record.coordinate.length !== axisCount) {
                  found.add('axis-count-mismatch', `expected ${axisCount} coordinate values, received ${record.coordinate.length}`, where);
               }
            }
         },
         finish() {
            return {
               status: found.count === 0n ? 'pass' : 'fail',
               metrics: { ...tally, axisCount, issues: found.count },
               ...found.fields(),
            };
         },
      };
   },
};

// Whether a record set is exactly what its manifest says was walked.
const datasetCoverage = {
   type: 'dataset-coverage',
   description: 'Records and the manifest\'s omitted runs cover the walked ordinals [offset, nextOffset) exactly, with no gaps or overlaps.',
   category: 'query',
   version: 1,
   requires: ['records', 'manifest'],
   create() {
      const runs = [];
      const found = issueCollector();
      let previous = null;
      return {
         adapterError(row) {
            found.add('adapter-error', 'a row that could not be read cannot be placed', { row });
         },
         observe(record, row) {
            const ordinal = record && typeof record === 'object' ? record.ordinal : undefined;
            if (typeof ordinal !== 'bigint' || ordinal < 0n) {
               found.add('coverage-unknown', 'a record without an ordinal cannot be placed', { row });
            } else if (previous != null && ordinal <= previous) {
               found.add('coverage-overlap', `ordinal ${ordinal} does not follow ${previous}`, { row, ordinal });
            } else {
               addRun(runs, ordinal, 1n);
               previous = ordinal;
            }
         },
         finish({ inputs: { manifest } }) {
            const { issues } = checkCoverage(manifest, runs);
            for (const issue of issues) found.add(issue.code, issue.message);
            return {
               status: found.count === 0n ? 'pass' : 'fail',
               metrics: { covered: found.count === 0n, offset: manifest.offset ?? null, nextOffset: manifest.nextOffset ?? null, issues: found.count },
               ...found.fields(),
            };
         },
      };
   },
};

function keyOf(value, seen = new Set()) {
   if (value === null) return 'null';
   switch (typeof value) {
      case 'undefined': return 'undefined';
      case 'boolean': return `boolean:${value}`;
      case 'string': return `string:${JSON.stringify(value)}`;
      case 'bigint': return `bigint:${value}`;
      case 'number':
         if (Number.isNaN(value)) return 'number:NaN';
         if (Object.is(value, -0)) return 'number:-0';
         return `number:${value}`;
      case 'object': {
         if (seen.has(value)) throw new TypeError('cannot key cyclic values');
         seen.add(value);
         let key;
         if (Array.isArray(value)) key = `array:[${value.map(item => keyOf(item, seen)).join(',')}]`;
         else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
            key = `object:{${Object.keys(value).sort().map(name => `${JSON.stringify(name)}:${keyOf(value[name], seen)}`).join(',')}}`;
         } else throw new TypeError('cannot key non-plain object values');
         seen.delete(value);
         return key;
      }
      default: throw new TypeError(`cannot key ${typeof value} values`);
   }
}

function kindOf(value) {
   if (value === null) return 'null';
   if (Array.isArray(value)) return 'array';
   return typeof value;
}

const structureDistribution = {
   type: 'structure-distribution',
   description: 'How many structures, of which kinds, and how many distinct ones (up to parameters.maxDistinct, default 4096).',
   category: 'query',
   version: 1,
   requires: ['records'],
   parameters: ['maxDistinct'],
   create({ parameters }) {
      const maxDistinct = parameters.maxDistinct ?? 4096;
      if (!Number.isSafeInteger(maxDistinct) || maxDistinct <= 0) {
         throw new TypeError('structure-distribution parameters.maxDistinct must be a positive safe integer');
      }
      let structures = 0n;
      let unkeyable = 0n;
      let distinctTruncated = false;
      const kinds = {};
      const distinct = new Set();
      return {
         observe(record) {
            if (!record || record.status !== 'structure' || !hasOwn(record, 'structure')) return;
            structures++;
            const kind = kindOf(record.structure);
            kinds[kind] = (kinds[kind] || 0n) + 1n;
            try {
               const key = keyOf(record.structure);
               if (!distinct.has(key)) {
                  if (distinct.size < maxDistinct) distinct.add(key);
                  else distinctTruncated = true;
               }
            } catch {
               unkeyable++;
            }
         },
         finish() {
            return {
               status: distinctTruncated || unkeyable > 0n ? 'warn' : 'pass',
               metrics: { structures, kinds, distinct: BigInt(distinct.size), distinctTruncated, maxDistinct: BigInt(maxDistinct), unkeyable },
            };
         },
      };
   },
};

// Every structure record maps back: a decode record's structure re-encodes to its coordinate;
// an encode record's coordinate decodes to its structure (encode does not validate — §5.4 —
// so this is where a structure the space cannot name exactly shows up).
const mappingRoundtrip = {
   type: 'mapping-roundtrip',
   description: 'Decode records: each structure re-encodes to its coordinate. Encode records: each coordinate decodes back to its structure.',
   category: 'lib',
   version: 1,
   requires: ['space', 'records'],
   create({ inputs: { space, direction } }) {
      let checked = 0n;
      const found = issueCollector();
      return {
         observe(record, row) {
            if (direction == null) return;
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
               found.add('invalid-record', 'a record must be an object', { row });
               return;
            }
            const where = at(record, row);
            if (record.status === 'hole') return;
            if (record.status === 'error') {
               found.add(`${direction}-error`, messageOf(record.error?.message ?? record.error), where);
               return;
            }
            if (record.status !== 'structure') {
               found.add('invalid-status', "status must be 'structure', 'hole', or 'error'", where);
               return;
            }
            if (!hasOwn(record, 'structure') || !Array.isArray(record.coordinate)) {
               found.add('missing-roundtrip-input', 'a structure record needs a structure and a coordinate', where);
               return;
            }
            checked++;
            try {
               if (direction === 'decode') {
                  const coordinate = space.encode(record.structure);
                  if (coordinate.length !== record.coordinate.length || coordinate.some((value, axis) => value !== record.coordinate[axis])) {
                     found.add('roundtrip-mismatch', `encoded ${coordinate.join(',')} instead of ${record.coordinate.join(',')}`, where);
                  }
               } else {
                  const structure = space.decode(record.coordinate);
                  if (typeof structure === 'symbol' || keyOf(structure) !== keyOf(record.structure)) {
                     found.add('roundtrip-mismatch', `coordinate ${record.coordinate.join(',')} decodes to another structure`, where);
                  }
               }
            } catch (error) {
               found.add(`${direction === 'decode' ? 'encode' : 'decode'}-error`, messageOf(error), where);
            }
         },
         finish() {
            if (direction == null) {
               return { status: 'inapplicable', reason: 'the records\' direction is unknown: pass the manifest they were saved with' };
            }
            if (found.count === 0n && checked === 0n) return { status: 'inapplicable', reason: 'no structure record to check' };
            return {
               status: found.count > 0n ? 'fail' : 'pass',
               metrics: { direction, checked, failures: found.count },
               ...found.fields(),
            };
         },
      };
   },
};

//////////////////////////////////////////////////////////////////////////////
// suites
//////////////////////////////////////////////////////////////////////////////

const suite = (type, category, members) => ({ type, category, version: 1, description: `Runs ${members.join(', ')}.`, members });

const definitions = [
   spaceSummary,
   spaceAxes,
   spaceLayers,
   spaceChecks,
   suite('space-suite', 'space', ['space-summary', 'space-axes', 'space-layers', 'space-checks']),
   datasetIntegrity,
   datasetCoverage,
   structureDistribution,
   geometrySummary,
   suite('query-suite', 'query', ['dataset-integrity', 'dataset-coverage', 'structure-distribution', 'geometry-summary']),
   mappingRoundtrip,
   spaceSerialization,
   suite('lib-suite', 'lib', ['mapping-roundtrip', 'space-serialization']),
];

const deepFreeze = value => {
   if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
   for (const child of Object.values(value)) deepFreeze(child);
   return Object.freeze(value);
};

export const BUILTIN_CAPSULES = new Map(definitions.map(definition => [definition.type, deepFreeze(definition)]));
export const BUILTIN_TYPES = Object.freeze(definitions.map(definition => definition.type));
export const BUILTIN_CATEGORIES = deepFreeze(Object.fromEntries(
   [...new Set(definitions.map(definition => definition.category))].map(category => [
      category, definitions.filter(definition => definition.category === category).map(definition => definition.type),
   ]),
));
