// Ither — Space
// One object — a FORMULA — defines a whole space. A Space is that formula compiled: it
// holds the canonical formula and the engine it runs on, and nothing outside the
// formula changes what it means.
//
// Shape of the formula (the rules: src/formula/FormulaRules.js):
//   {
//     layers: {                       // NAMED (object) — order irrelevant
//       <name>: { type, domains?, shape?, from?, options? }
//     },
//     projection?: [ [ref, …], … ],   // ORDERED (array) — entry i is axis i
//     options?: { combine? }          // global: how sources share an axis
//   }
//
// Convention that runs through the whole format:
//   anything that is an ARRAY is ordered and the order is meaningful;
//   anything that is an OBJECT is named and its key order is irrelevant.
//
// Per-layer envelope (content varies by type, the keys never change job):
//   domains  — the menus of choices (named lists).            { x:[…], o2:[…] }
//   shape    — the structural form built from those menus.    type-specific
//   from     — this layer's form IS another layer's output.   "<layerName>"  (chaining; excludes shape)
//   options  — numeric/behavioural knobs.                     { maxNodes }, { maxLen, iterations }
//
// projection: an ordered list of axes; each axis is an array of references.
//   ["tree"]                   — the whole layer
//   ["tree","cfg"]             — several sources share one axis (options.combine)
//   "tree" in two entries      — the layer split across those axes (unbounded combine only)
//   ["nodes.x"]                — a part: an OBJ/NUM key, an ARR position, an STR variable
//   omitted entirely           — identity: one axis per layer, in resolution order

import { Engine, LAYER_CLASSES } from './Engine.js';
import { Codec } from './Codec.js';
import { HOLE, OUTSIDE } from './Sentinels.js';
import { validateFormula } from './FormulaRules.js';
import { recover } from './Recover.js';

const deepFreeze = value => {
   if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
   for (const item of Object.values(value)) deepFreeze(item);
   return Object.freeze(value);
};

// The version a payload being unpacked was packed by, read by the constructor. Set only
// for the synchronous duration of Space.unpack, so a Space has one constructor input.
let unpackingVersion = null;

const readOnly = (target, key, value, enumerable = true) =>
   Object.defineProperty(target, key, { value, enumerable, writable: false, configurable: false });

export class Space {
   constructor(formula) {
      // Validate against the rules table and take the canonical form: the Space's own
      // copy, detached from the caller's object, with every default written in.
      const { formula: canonical, layerNames } = validateFormula(formula);
      deepFreeze(canonical);
      readOnly(this, 'formula', canonical);
      readOnly(this, 'layerNames', Object.freeze(layerNames));

      const index = {};
      layerNames.forEach((name, i) => (index[name] = i));
      const layers = layerNames.map(name => Space._buildLayer(canonical.layers[name], index));
      const mapping = Space._compileProjection(canonical, layerNames, index);
      readOnly(this, '_engine', new Engine({ layers, names: layerNames, mapping, combine: canonical.options.combine }), false);

      // the packed text: this version's stamp + the canonical formula
      readOnly(this, '_packed', JSON.stringify({ formula: canonical, v: Engine.version }), false);
      // which version packed the payload this space was unpacked from; null when it was
      // compiled from a formula object. A different version is indicated, never refused.
      readOnly(this, 'packedBy', unpackingVersion);
   }

   //////////////////////////////////////////////////////////////////////////
   // PUBLIC SURFACE
   //////////////////////////////////////////////////////////////////////////

   get axisCount() { return this._engine.axisCount; }

   // Number of structures in the space, where the formula fixes it. null when a
   // layer's count runs only up to a cap (AST maxNodes, LSM maxLen — a guardrail,
   // not a bound) or a layer is chained (its size depends on its source's structure).
   get cardinality() {
      let t = 1n;
      for (const l of this._engine.layers) {
         if (l.capped === true || l.chainFrom != null || l.cardinality == null) return null;
         t *= l.cardinality;
      }
      return t;
   }

   // Per-axis bounds (BigInt | null). Without a coordinate, only what the formula
   // fixes; with one, a chained layer's axes are resolved at that coordinate.
   axisBounds(coordinate) { return this._engine.axisBounds(coordinate); }

   // For each axis, the axes its range depends on ([] if none).
   axisDependencies() { return this._engine.axisDependencies(); }

   // Internal: every axis's range at a coordinate, caps included — what a query walks.
   _axisRanges(coordinate) { return this._engine._axisRanges(coordinate); }

   // Internal: the compiled facts analysis reports and a formula does not state directly —
   // the one route from the other tiers into the engine.
   //   axes    per axis: bound (null where the formula fixes none), boundReason
   //           ('fixed' | 'capped' | 'sparse' | 'dependent'), dependsOn, combine
   //   layers  per layer: cardinality — null for a capped layer (a guardrail, not a bound)
   //           and a chained one (its size depends on its source's structure)
   _facts() {
      const engine = this._engine;
      const bounds = engine.axisBounds();
      const reasons = engine.axisBoundReasons();
      const dependencies = engine.axisDependencies();
      const combines = engine.axisCombines();
      return {
         axes: bounds.map((bound, axis) => ({ bound, boundReason: reasons[axis], dependsOn: dependencies[axis], combine: combines[axis] })),
         layers: engine.layers.map(layer => ({
            cardinality: layer.chainFrom == null && !layer.capped ? layer.cardinality ?? null : null,
         })),
      };
   }

   // The single encode: a structure keyed by layer name (every layer, also for a single
   // layer) -> a coordinate, one BigInt per axis (an array, also for a single axis).
   // Nothing is deduced; to complete a partial structure, recover() it first.
   //
   // Encode does not validate a structure: checking one is the caller's
   // job. Layers follow their own documented policies:
   //   OBJ  a missing key is encoded as a digit of radix 1, which shifts the place value
   //        of every other digit — the coordinate names a different structure, and even
   //        the given keys may decode differently ({ p: 'b' } over p:[a,b], q:[0,1]
   //        encodes to 1n, which decodes to { p: 'a', q: 1 }); an extra key is ignored.
   //   NUM  a value snaps to the nearest grid step; one outside [min, max] clamps to the
   //        nearest end; a missing or non-number value encodes as min.
   // A part a layer cannot encode at all (e.g. a value not in its domain) throws, naming
   // the layer.
   encode(structure) {
      if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
         throw new TypeError('Space.encode: expected a structure keyed by layer name');
      }
      for (const key of Object.keys(structure)) {
         if (!this.layerNames.includes(key)) throw new Error(`Space.encode: unknown layer '${key}' (layers: ${this.layerNames.join(', ')})`);
      }
      const missing = this.layerNames.filter(name => !Object.prototype.hasOwnProperty.call(structure, name));
      if (missing.length > 0) throw new Error(`Space.encode: missing the structure of layer '${missing[0]}' — encode takes every layer's structure (recover() completes a partial one)`);
      const parts = this.layerNames.map(name => structure[name]);
      return this._engine.encode(parts.length === 1 ? parts[0] : parts).slice();
   }

   // The single decode: a coordinate, one BigInt per axis (an array, also for a single
   // axis) -> a structure keyed by layer name (also for a single layer), Ither.OUTSIDE for
   // a coordinate past the range its axes have there (a negative value included), or
   // Ither.HOLE for an in-range coordinate that names no structure.
   decode(coordinate) {
      if (!Array.isArray(coordinate)) throw new TypeError(`Space.decode: expected a coordinate array of ${this.axisCount} BigInt(s)`);
      if (coordinate.length !== this.axisCount) {
         throw new TypeError(`Space.decode: expected a coordinate array of ${this.axisCount} BigInt(s), received ${coordinate.length} value(s)`);
      }
      coordinate.forEach((value, axis) => {
         if (typeof value !== 'bigint') throw new TypeError(`Space.decode: coordinate[${axis}] must be a BigInt`);
      });
      const parts = this._engine.decode(coordinate.slice());
      if (parts === HOLE || parts === OUTSIDE) return parts;
      const structure = {};
      this.layerNames.forEach((name, i) => (structure[name] = parts[i]));
      return structure;
   }

   // Completes a partial structure (keyed by layer name) by reading each layer a given
   // chained layer takes its template from back out of that layer's text. Refuses what
   // cannot be read back exactly. See src/formula/Recover.js.
   recover(partial) { return recover(this, partial); }

   // The canonical formula, version-stamped, as base64url. Equal spaces pack identically.
   pack() { return Codec.toBase64url(this._packed); }

   // A payload packed by any version is accepted; `packedBy` records which one. Whether
   // its coordinates mean the same structures here is the caller's call. A malformed
   // payload is refused.
   static unpack(str) {
      const payload = JSON.parse(Codec.fromBase64url(str));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Space.unpack: expected a packed object { formula, v }');
      for (const key of Object.keys(payload)) {
         if (key !== 'v' && key !== 'formula') throw new Error(`Space.unpack: unknown key '${key}' (a packed space holds 'formula' and 'v')`);
      }
      if (!('v' in payload)) throw new Error("Space.unpack: no 'v' — a packed space records the version that packed it");
      if (typeof payload.v !== 'string') throw new Error("Space.unpack: 'v' must be a version string");
      if (!('formula' in payload)) throw new Error("Space.unpack: no 'formula'");
      unpackingVersion = payload.v;
      try {
         return new Space(payload.formula);
      } finally {
         unpackingVersion = null;
      }
   }

   //////////////////////////////////////////////////////////////////////////
   // COMPILE
   //////////////////////////////////////////////////////////////////////////

   // A canonical layer as the spec its layer class reads (`structure` is the engine's
   // name for shape). Validation has already happened.
   static _buildLayer(layer, index) {
      const { type, domains = {}, shape, options = {} } = layer;
      let spec;
      switch (type) {
         case 'AST': spec = { type, domains, maxNodes: options.maxNodes, ranking: options.ranking }; break;
         case 'STR': spec = { type, domains, structure: layer.from != null ? { from: index[layer.from] } : shape }; break;
         case 'LSM': spec = { type, domains, structure: { ...shape, maxLen: options.maxLen, iterations: options.iterations } }; break;
         case 'TRI':
         case 'PERM': spec = { type, structure: { n: shape.n } }; break;
         default: spec = { type, domains, structure: shape }; // OBJ, ARR, NUM
      }
      // the layer instance keeps the spec; give it its own copy of the frozen formula
      return new LAYER_CLASSES[type](structuredClone(spec));
   }

   // The projection as the engine's per-layer mapping. The rules have checked every
   // reference and that every layer and part is assigned exactly once.
   static _compileProjection(formula, layerNames, index) {
      const whole = {}, parts = {};
      formula.projection.forEach((axis, d) => {
         for (const ref of axis) {
            const dot = ref.indexOf('.');
            if (dot < 0) (whole[ref] ||= []).push(d);
            else (parts[ref.slice(0, dot)] ||= {})[ref.slice(dot + 1)] = d;
         }
      });
      return layerNames.map(name => {
         if (whole[name]) return whole[name].length === 1 ? whole[name][0] : whole[name];
         const layer = formula.layers[name];
         const assigned = parts[name];
         if (layer.type === 'STR') return { byVar: { ...assigned } };
         if (layer.type === 'ARR') return { keys: layer.shape.map((_, position) => assigned[String(position)]) };
         return { keys: layer.shape.map(key => assigned[key]) }; // OBJ, NUM
      });
   }
}
