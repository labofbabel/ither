// Ither — Capabilities (machine-readable introspection)
//
// A single contract describing what Ither accepts, derived from the code: the formula
// rules table (src/formula/FormulaRules.js — the same table validation reads) and the
// Combinator registry. LLMs and clients consume this to author valid formulas without
// reading prose.
//
//   import { capabilities, formulaSchema } from 'ither';
//   const caps = capabilities();              // full snapshot
//   const schema = formulaSchema();            // just the JSON Schema for the formula
//
// A generated copy of the schema is kept at formulas/formula.schema.json
// (npm run formulas:schema) so package consumers can fetch it without the engine.

import { Engine } from './formula/Engine.js';
import { Combinators } from './formula/Combinators.js';
import { LAYER_RULES, COMBINE_DEFAULT, formulaJsonSchema, layerJsonSchema } from './formula/FormulaRules.js';
import { BUILTIN_CATEGORIES, BUILTIN_TYPES } from './analysis/AnalysisCapsules.js';
import { INPUTS, BUILTINS } from './analysis/Analysis.js';

// Per layer type: what it is, how it parts, and the JSON Schema of its spec.
function layerTypes() {
   return Object.fromEntries(Object.entries(LAYER_RULES).map(([type, rule]) => [type, {
      role: rule.role,
      cardinality: rule.cardinality,
      parting: rule.parting,
      schema: layerJsonSchema(type),
   }]));
}

// The combine families, from their own metadata.
function combinators() {
   return {
      registered: [...Combinators.keys()],
      default: COMBINE_DEFAULT,
      families: Object.fromEntries([...Combinators].map(([key, family]) => [key, {
         bounded: family.bounded,
         locality: family.locality,
         requirement: family.requirement,
      }])),
   };
}

// Per built-in capsule: everything its definition declares except the code.
function analysisCapsules() {
   return Object.fromEntries([...BUILTINS].map(([type, { create, ...declared }]) => [type, structuredClone(declared)]));
}

// JSON Schema (draft 2020-12) for the formula format, rendered from the rules table.
export function formulaSchema() {
   return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://raw.githubusercontent.com/labofbabel/ither/main/formulas/formula.schema.json',
      title: 'Ither formula',
      description: 'A formula defines an Ither structure space. Pass it as Ither({ space: formula }) to resolve a Space (or use the synchronous Ither.from factory), which decodes BigInt coordinates into structures and back. Anything this schema does not declare is refused. Determinism: a coordinate is a pure function of (Ither version, formula, structure). Convention: arrays are ordered (order is significant), objects are named (key order is irrelevant).',
      itherVersion: Engine.version,
      ...formulaJsonSchema(),
   };
}

// One-shot capabilities snapshot — what an LLM or tool needs to author + validate
// formulas without reading prose docs.
export function capabilities() {
   return {
      itherVersion: Engine.version,
      analysisTypes: BUILTIN_TYPES,
      analysisCategories: BUILTIN_CATEGORIES,
      analysisInputs: INPUTS,
      analysisCapsules: analysisCapsules(),
      layerTypes: layerTypes(),
      combinators: combinators(),
      formulaSchema: formulaSchema(),
      api: {
         workflow: 'await Ither({ space?, query?, analysis? }) -> { space?, query?: QueryReport, manifest?: QueryManifest, analysis?: AnalysisReport }',
         compile: 'Ither.from(formula) -> Space',
         encode: "space.encode({ <layer>: structure, … } — every layer) -> BigInt[] (one per axis). Does not validate a structure (the caller's job): OBJ encodes a missing key as a radix-1 digit, so the coordinate names a different structure, and ignores extra keys; NUM snaps to its grid, clamps to [min, max], and encodes a missing or non-number value as min; a part a layer cannot encode throws, naming the layer",
         decode: 'space.decode(BigInt[] — one per axis) -> { <layer>: structure, … } | Ither.HOLE | Ither.OUTSIDE',
         recover: "space.recover({ <layer>: structure, … } — partial) -> the full structure: each source a given chained layer takes its template from is read back; refused when it cannot be read back exactly (ambiguous, an LSM source, an empty domain value, a downstream layer)",
         bounds: 'space.axisBounds(coord?) -> (BigInt | null)[] ; space.axisDependencies() -> number[][]',
         query: "await Ither({ space, query:{ decode: { type:'grid', axes:[{ start, end, step? }] } | { type:'ray', start, direction, count } | { type:'list', coordinates } , or encode: { type:'list', structures }, offset?, limit?, write(record), progress?(report), signal?, manifest? } }) -> { space, query: report, manifest? }. offset, limit, count and nextOffset count ordinals; a record is { ordinal, coordinate, structure, status: 'structure'|'hole'|'error', error? }; out-of-range points are omitted and listed in manifest.omitted",
         analyze: "await Ither({ space?, query?, analysis:{ suite, capsules?, context?, geometry?, records?, adapt?, manifest? } }) -> { …, analysis: { kind:'analysis-report', version, provenance, summary, results } }. Each capsule requires named inputs (analysisInputs); a live query supplies geometry, records and manifest. A result's status is 'pass'|'warn'|'fail' (it ran), 'inapplicable' (it could not run; reason says why) or 'error' (it broke; reason is the message). Only a malformed request rejects",
         pack: 'space.pack() -> base64url of the version-stamped canonical formula ; Space.unpack(str) -> Space (any version; space.packedBy names it, null when compiled from a formula object)',
      },
   };
}
