// Ither — Engine (internal)
// The compiled layers + mapping a Space runs on. Not public: a space is defined by a
// formula (Space), never assembled on this engine directly. An Engine is built once,
// from a validated formula, and never reconfigured.
//
// Pure conversion is delegated to Codec and the combine families to Combinators.

import { Codec } from './Codec.js';
import { HOLE, OUTSIDE } from './Sentinels.js';
import { groupPack, groupUnpack, fold, unfold, combineRefusal, Combinators } from './Combinators.js';
import { ASTLayer } from './ASTLayer.js';
import { OBJLayer } from './OBJLayer.js';
import { STRLayer } from './STRLayer.js';
import { ARRLayer } from './ARRLayer.js';
import { LSMLayer } from './LSMLayer.js';
import { TRILayer } from './TRILayer.js';
import { NUMLayer } from './NUMLayer.js';
import { PERMLayer } from './PERMLayer.js';

export const LAYER_CLASSES = {
   AST: ASTLayer,
   OBJ: OBJLayer,
   STR: STRLayer,
   ARR: ARRLayer,
   LSM: LSMLayer,
   TRI: TRILayer,
   NUM: NUMLayer,
   PERM: PERMLayer,
};

const VERSION = '0.3.0';

export class Engine {
   /**
    * layers   layer instances, in resolution order (a chained layer after its source)
    * names    their names, for messages
    * mapping  one entry per layer:
    *            number      the layer's whole coordinate goes to that axis
    *            number[]    the coordinate is split across those axes
    *            {keys:[…]}  each position of a positional layer goes to an axis
    *            {byVar:{…}} each variable of an STR layer goes to an axis
    * combine  the formula's combine; resolved onto every axis (see _axisCombine)
    */
   constructor({ layers, names, mapping, combine }) {
      if (!Array.isArray(layers) || layers.length === 0) throw new Error('Engine: needs at least one layer');
      if (!Array.isArray(mapping) || mapping.length !== layers.length) throw new Error('Engine: needs one mapping entry per layer');
      if (!Combinators.has(combine)) throw new Error(`Engine: unknown combine '${combine}'`);
      this.layers = layers;
      this.names = names ?? layers.map((_, i) => `#${i}`);
      this.mapping = mapping;
      this.combine = combine;

      const all = [];
      for (const m of mapping) {
         if (typeof m === 'number') all.push(m);
         else if (Array.isArray(m)) all.push(...m);
         else if (m && Array.isArray(m.keys)) all.push(...m.keys);
         else if (m && m.byVar) all.push(...Object.values(m.byVar));
         else throw new Error('Engine: invalid mapping entry');
      }
      this.axisCount = Math.max(...all) + 1;

      // The combine each axis uses. The formula declares one for the whole space today;
      // resolving it per axis is what lets per-axis declarations be added later.
      this._axisCombine = new Array(this.axisCount).fill(combine);

      this._units = this._axisUnits();
      this._checkCombines();
      this._model = null;
   }

   // Library version. Stamped into a packed formula: a coordinate is a pure function of
   // (version, formula, structure).
   static get version() { return VERSION; }

   _layerLabel(i) { return `layer '${this.names[i]}'`; }

   //////////////////////////////////////////////////////////////////////////
   // AXES — what each output axis carries, and the range it has
   //////////////////////////////////////////////////////////////////////////

   // One entry per output axis, derived from the layers and the mapping alone:
   //   units     — the sources the axis carries: { layer, kind, positions?, vars? },
   //               kind 'whole' | 'split' | 'keygroup' | 'var'
   //   combine   — the combine the axis uses to fold its sources and slot groups
   //   chained   — the axis carries a layer whose template comes from another layer,
   //               so its range is known only once that layer is resolved
   //   capped    — the range counts up to a formula cap (AST maxNodes, LSM maxLen),
   //               a guardrail that is enforced but never reported as a bound
   //   dependsOn — the axes whose values resolve this axis's range
   //
   // A chained layer's axes carry that layer and nothing else. Packing it beside
   // another source would need its size, which changes with the structure its
   // template comes from — so such a projection is refused rather than aliased.
   //
   // It reads no layer's size, so it can check a formula at compile time even when a
   // size is not computable (an empty domain is reported by the space-checks capsule,
   // not by a crash). _axisModel() adds each axis's range.
   _axisUnits() {
      const model = Array.from({ length: this.axisCount }, (_, d) => ({ units: [], combine: this._axisCombine[d] }));
      const byVar = this._hasByVar();
      this.mapping.forEach((m, layer) => {
         if (typeof m === 'number') model[m].units.push({ layer, kind: 'whole' });
         else if (byVar) {
            if (!m.byVar) throw new Error(`Space: ${this._layerLabel(layer)} is split or parted by position beside a layer parted by variable — only whole layers can sit beside one`);
            for (const d of new Set(Object.values(m.byVar))) {
               model[d].units.push({ layer, kind: 'var', vars: Object.keys(m.byVar).filter(v => m.byVar[v] === d) });
            }
         } else if (Array.isArray(m)) {
            m.forEach(d => model[d].units.push({ layer, kind: 'split' }));
         } else {
            for (const d of [...new Set(m.keys)].sort((a, b) => a - b)) {
               model[d].units.push({ layer, kind: 'keygroup', positions: m.keys.flatMap((kd, i) => (kd === d ? [i] : [])) });
            }
         }
      });

      const axesOf = layer => model.flatMap((dim, d) => (dim.units.some(u => u.layer === layer) ? [d] : []));
      model.forEach((dim, d) => {
         const layers = [...new Set(dim.units.map(u => u.layer))];
         const chained = layers.find(i => this.layers[i].chainFrom != null);
         dim.chained = chained != null;
         dim.capped = layers.some(i => this.layers[i].capped === true);
         if (dim.units.length === 0) throw new Error(`Space: axis ${d} carries no source`);
         if (dim.chained && layers.length > 1) {
            throw new Error(`Space: axis ${d} carries chained ${this._layerLabel(chained)} with another layer — a chained layer's size depends on its source, so it needs axes of its own`);
         }
         if (byVar && dim.units.length > 1) {
            throw new Error(`Space: axis ${d} carries ${dim.units.length} sources — beside a layer parted by variable, each axis carries one`);
         }
         const dependsOn = new Set();
         for (const i of layers) {
            for (let source = this.layers[i].chainFrom; source != null; source = this.layers[source].chainFrom) {
               for (const axis of axesOf(source)) dependsOn.add(axis);
            }
         }
         dim.dependsOn = [...dependsOn].sort((a, b) => a - b);
      });
      return model;
   }

   // Every place a combine is applied is the declared combine, or the formula is
   // refused: a split, the slot groups of a parted layer, and several sources on an axis.
   _checkCombines() {
      const bounded = combine => Combinators.get(combine).bounded;
      const sized = combine => Combinators.get(combine).requirement != null;
      this.mapping.forEach((m, i) => {
         if (Array.isArray(m) && bounded(this.combine)) {
            throw new Error(`Space: ${this._layerLabel(i)} is split across axes ${m.join(', ')}, and a split has no bound — combine '${this.combine}' cannot divide it (only an unbounded combine such as 'cantor' can)`);
         }
      });
      this._units.forEach((dim, d) => {
         const refuse = reason => { throw new Error(`Space: axis ${d} cannot use combine ${reason}`); };
         for (const unit of dim.units) {
            const layer = this.layers[unit.layer];
            if (unit.kind === 'keygroup' && unit.positions.length > 1 && sized(dim.combine)) {
               const reason = combineRefusal(dim.combine, unit.positions.map(p => BigInt(layer.radices[p])));
               if (reason) refuse(`${reason} — the parts of ${this._layerLabel(unit.layer)}`);
            }
            if (unit.kind === 'var') {
               const chained = layer.chainFrom != null;
               const cards = !sized(dim.combine) ? unit.vars.map(() => 1n)
                  : chained ? unit.vars.map(v => BigInt(layer.schema.domains[v].length))
                  : this._varPositions(layer, unit.vars).map(p => BigInt(layer.slotBases()[p]));
               const reason = combineRefusal(dim.combine, cards, { fixedCount: !chained });
               if (reason) refuse(`${reason} — the variables of ${this._layerLabel(unit.layer)}`);
            }
         }
         if (dim.units.length > 1) {
            const cards = dim.units.map(unit => (unit.kind === 'split' ? null : sized(dim.combine) ? this._unitCard(unit, dim.combine) : 1n));
            const reason = combineRefusal(dim.combine, cards);
            if (reason) refuse(`${reason} — its sources are ${dim.units.map(u => this._layerLabel(u.layer)).join(', ')}`);
         }
      });
   }

   // The cardinality a whole or keygroup unit contributes to its axis.
   _unitCard(unit, combine) {
      const layer = this.layers[unit.layer];
      if (unit.kind === 'whole') return layer.cardinality ?? null;
      if (unit.kind === 'keygroup') return this._slotBound(layer, unit.positions, layer.radices, combine);
      return null;
   }

   _axisModel() {
      if (this._model) return this._model;
      const model = this._units.map(dim => ({ ...dim }));
      for (const dim of model) dim.range = dim.chained ? null : this._fixedRange(dim);
      this._model = model;
      return model;
   }

   // The range an axis has from the formula alone (null where it has none).
   _fixedRange(dim) {
      const cards = [];
      for (const u of dim.units) {
         const layer = this.layers[u.layer];
         if (u.kind === 'split') return null; // a split is sparse: no contiguous range
         if (u.kind === 'whole') cards.push(layer.cardinality ?? null);
         else if (u.kind === 'keygroup') cards.push(this._slotBound(layer, u.positions, layer.radices, dim.combine));
         else cards.push(this._slotBound(layer, this._varPositions(layer, u.vars), layer.slotBases(), dim.combine));
      }
      if (cards.length === 1) return cards[0];
      const family = Combinators.get(dim.combine);
      return family.bounded ? family.bound(cards) : null;
   }

   // The range of a chained layer's axis, once its template is set.
   _resolvedRange(layer, unit, combine) {
      if (unit.kind === 'whole') return layer.resolvedCardinality;
      if (unit.kind === 'split') return null;
      return this._slotBound(layer, this._varPositions(layer, unit.vars), layer.slotBases(), combine);
   }

   _varPositions(layer, vars) {
      return layer.slotVars().flatMap((v, s) => (vars.includes(v) ? [s] : []));
   }

   // The range of the value a parted slot group folds into (null if sparse).
   _slotBound(layer, pos, bases, combine) {
      if (pos.length === 0) return 1n;
      const cards = pos.map(p => BigInt(bases[p]));
      if (cards.length === 1) return cards[0];
      const family = Combinators.get(combine);
      return family.bounded ? family.bound(cards) : null;
   }

   // Fold a parted group's slot digits into its axis coordinate, and back. `unpack`
   // returns HOLE for a value that names no digits. A contiguous axis is range-checked
   // before it is unpacked, so only a sparse group gets a value past its bound here.
   _packSlots(pos, bases, values, combine) {
      return fold(combine, values.map(v => BigInt(v)), pos.map(p => BigInt(bases[p])));
   }

   _unpackSlots(layer, pos, bases, value, combine) {
      const cards = pos.map(p => BigInt(bases[p]));
      const v = Codec.asCoordInt(value);
      const bound = this._slotBound(layer, pos, bases, combine);
      if (v < 0n || (bound != null && v >= bound)) return HOLE;
      const digits = unfold(combine, v, cards);
      if (digits === HOLE || digits.some((digit, j) => digit >= cards[j])) return HOLE;
      return digits;
   }

   /**
    * Per-axis bounds a client can rely on (BigInt, or null).
    *
    * Without a coordinate: what the formula fixes. null for an axis with no
    * contiguous range (a sparse axis), for an axis whose range counts up to a cap
    * (AST maxNodes, LSM maxLen — a guardrail, not a bound), and for a chained layer's
    * axes, whose range depends on the axes in axisDependencies().
    *
    * With a coordinate: chained axes are resolved from the axes they depend on,
    * exactly as decode resolves them. An axis stays null where it has no range, or
    * where its source is itself out of range or a hole at that coordinate.
    */
   axisBounds(coordinate) {
      const model = this._axisModel();
      if (coordinate === undefined) return model.map(dim => (dim.chained || dim.capped ? null : dim.range));
      return this._walk(this._asCoordinate(coordinate), 'ranges', model).map((range, d) => (model[d].capped ? null : range));
   }

   // For each output axis, the axes its range depends on ([] if none).
   axisDependencies() {
      return this._units.map(dim => dim.dependsOn.slice());
   }

   // Why each axis has the bound it has:
   //   'fixed'      the formula fixes a contiguous range (axisBounds gives it)
   //   'capped'     the range counts up to a cap — a guardrail, never a bound
   //   'sparse'     no contiguous range: a split, or sources folded by an unbounded combine
   //   'dependent'  a chained layer's axis: its range is resolved per coordinate
   axisBoundReasons() {
      return this._axisModel().map(dim => {
         if (dim.chained) return 'dependent';
         if (dim.range == null) return 'sparse';
         return dim.capped ? 'capped' : 'fixed';
      });
   }

   // The combine each axis uses.
   axisCombines() {
      return this._units.map(dim => dim.combine);
   }

   // Every axis's exclusive range at a coordinate, caps included — the ranges a query
   // walks. Internal: a cap is enforced, but it is never reported as a bound.
   _axisRanges(coordinate) {
      return this._walk(this._asCoordinate(coordinate), 'ranges');
   }

   _asCoordinate(coordinate) {
      const axisValues = (this.layers.length === 1 && !Array.isArray(coordinate)) ? [coordinate] : coordinate;
      if (!Array.isArray(axisValues)) throw new Error('Ither: expected an array of coordinates');
      return axisValues;
   }

   //////////////////////////////////////////////////////////////////////////
   // ENCODE
   //////////////////////////////////////////////////////////////////////////

   _hasByVar() { return this.mapping.some(m => m && m.byVar); }

   // The units in the order groupPack/groupUnpack see them: one per whole or split
   // layer, one per slot group of a parted positional layer.
   _mappingPlan() {
      const plan = [];
      this.mapping.forEach((m, layer) => {
         if (typeof m === 'number') plan.push({ layer, kind: 'whole', flat: m });
         else if (Array.isArray(m)) plan.push({ layer, kind: 'split', flat: m });
         else {
            const base = this.layers[layer].radices;
            if (m.keys.length !== base.length) {
               throw new Error(`Engine: ${this._layerLabel(layer)} has ${base.length} positions but keys has ${m.keys.length}`);
            }
            for (const d of [...new Set(m.keys)].sort((a, b) => a - b)) {
               const positions = m.keys.map((kd, i) => (kd === d ? i : -1)).filter(i => i >= 0);
               plan.push({ layer, kind: 'keygroup', flat: d, positions });
            }
         }
      });
      return plan;
   }

   // Per plan unit: the cardinality it contributes to its axis (null for a split).
   _planCards(plan) {
      return plan.map(u => {
         if (u.kind === 'split') return null;
         if (u.kind === 'whole') return this.layers[u.layer].cardinality ?? null;
         return this._slotBound(this.layers[u.layer], u.positions, this.layers[u.layer].radices, this._axisCombine[u.flat]);
      });
   }

   /**
    * Encode structures to coordinates: one structure per layer, in resolution order
    * (a bare structure for a single layer). Returns one BigInt per output axis.
    */
   encode(structure) {
      const inputs = this.layers.length === 1 ? [structure] : structure;
      if (!Array.isArray(inputs) || inputs.length !== this.layers.length) {
         throw new Error(`Ither.encode: expected an array of ${this.layers.length} structures`);
      }

      const layerCoords = new Array(this.layers.length);
      for (let i = 0; i < this.layers.length; i++) {
         const layer = this.layers[i];
         if (layer.chainFrom != null) {
            layer.setTemplate(this._chainString(this.layers[layer.chainFrom], inputs[layer.chainFrom]));
         }
         try {
            layerCoords[i] = layer.encode(inputs[i]);
         } catch (error) {
            throw new Error(`${this._layerLabel(i)} cannot encode its structure: ${error.message}`, { cause: error });
         }
      }

      // Variables of an STR layer on their own axes: their slot groups are computed per
      // call, since a chained template varies. Every other layer here is whole.
      if (this._hasByVar()) {
         const out = new Array(this.axisCount).fill(0n);
         this.mapping.forEach((m, i) => {
            if (typeof m === 'number') { out[m] = layerCoords[i]; return; }
            const layer = this.layers[i];
            const bases = layer.slotBases(), vars = layer.slotVars();
            const digits = Codec.int_to_coordArr(layerCoords[i], bases);
            for (const d of new Set(Object.values(m.byVar))) {
               const pos = vars.map((v, s) => (m.byVar[v] === d ? s : -1)).filter(s => s >= 0);
               out[d] = this._packSlots(pos, bases, pos.map(p => digits[p]), this._axisCombine[d]);
            }
         });
         return out;
      }

      const plan = this._mappingPlan();
      const sources = plan.map(u => {
         if (u.kind !== 'keygroup') return layerCoords[u.layer];
         const base = this.layers[u.layer].radices;
         const digits = Codec.int_to_coordArr(layerCoords[u.layer], base);
         return this._packSlots(u.positions, base, u.positions.map(p => digits[p]), this._axisCombine[u.flat]);
      });
      return groupPack(sources, plan.map(u => u.flat), this._planCards(plan), this._axisCombine, this.combine);
   }

   //////////////////////////////////////////////////////////////////////////
   // DECODE
   //////////////////////////////////////////////////////////////////////////

   _unpackSources(sources, plan) {
      const layerCoords = new Array(this.layers.length);
      const acc = {}; // layer -> { base, digits, hole } for keygroup reassembly
      plan.forEach((u, i) => {
         const src = sources[i];
         if (u.kind !== 'keygroup') { layerCoords[u.layer] = src; return; } // may be HOLE
         if (!acc[u.layer]) {
            const base = this.layers[u.layer].radices;
            acc[u.layer] = { base, digits: new Array(base.length).fill(0), hole: false };
         }
         const a = acc[u.layer];
         if (src === HOLE) { a.hole = true; return; }
         const subDigits = this._unpackSlots(this.layers[u.layer], u.positions, a.base, src, this._axisCombine[u.flat]);
         if (subDigits === HOLE) { a.hole = true; return; }
         u.positions.forEach((p, j) => { a.digits[p] = subDigits[j]; });
      });
      for (const li of Object.keys(acc)) layerCoords[li] = acc[li].hole ? HOLE : Codec.coordArr_to_int(acc[li].digits, acc[li].base);
      return layerCoords;
   }

   // The one pass from a coordinate to structures. Every axis is checked against the
   // range it has at this coordinate before anything is unranked: the range the
   // formula fixes, or, for a chained layer, the range of the template its source has
   // just produced. A value past its axis's range is OUTSIDE. A value on an axis with
   // no contiguous range (a sparse axis) that names no structure is a HOLE. Nothing
   // is clamped.
   //
   //   'decode' -> one structure per layer | HOLE | OUTSIDE
   //   'ranges' -> every axis's range at this coordinate, decoding only the layers
   //               others chain from. A chained axis whose source cannot be resolved
   //               here stays null: the source's own axis is out of range, or the
   //               source is a hole.
   //
   // Layers hold per-call state: a chained STR keeps the template set by the last pass
   // (setTemplate), and every layer its last structure. That is safe only because one
   // pass runs start to finish synchronously — a query yields between points, never
   // inside one. Keep it that way: nothing here may await. (The yield: src/query/Query.js,
   // runQuery; the test: '5.5 …' in test/query.test.mjs.)
   _walk(coordinate, mode, model = this._axisModel()) {
      const D = model.length;
      if (coordinate.length !== D) throw new Error(`Ither: expected ${D} coordinates, got ${coordinate.length}`);
      const decoding = mode === 'decode';
      const ranges = model.map(dim => dim.range);
      const bad = new Array(D).fill(false);
      const axisValues = coordinate.map((value, d) => {
         const v = Codec.asCoordInt(value);
         if (v >= 0n && (ranges[d] == null || v < ranges[d])) return v;
         bad[d] = true;
         return 0n;
      });
      if (decoding && bad.includes(true)) return OUTSIDE;

      const carried = this.layers.map(() => []);
      model.forEach((dim, d) => dim.units.forEach(unit => carried[unit.layer].push({ d, unit })));
      const sources = new Set();
      for (const layer of this.layers) {
         for (let s = layer.chainFrom; s != null; s = this.layers[s].chainFrom) sources.add(s);
      }

      const byVar = this._hasByVar();
      let layerCoords = null;
      if (!byVar) {
         const plan = this._mappingPlan();
         layerCoords = this._unpackSources(groupUnpack(axisValues, plan.map(u => u.flat), this._planCards(plan), this._axisCombine, this.combine), plan);
      }

      const results = new Array(this.layers.length);
      const unresolved = new Array(this.layers.length).fill(false);
      for (let i = 0; i < this.layers.length; i++) {
         const layer = this.layers[i];
         const chained = layer.chainFrom != null;
         if (!decoding && !sources.has(i) && !chained) continue;
         if (!decoding && carried[i].some(({ d }) => bad[d])) { unresolved[i] = true; continue; }

         if (chained) {
            if (unresolved[layer.chainFrom]) { unresolved[i] = true; continue; }
            layer.setTemplate(this._chainString(this.layers[layer.chainFrom], results[layer.chainFrom]));
            for (const { d, unit } of carried[i]) {
               ranges[d] = this._resolvedRange(layer, unit, model[d].combine);
               if (ranges[d] != null && axisValues[d] >= ranges[d]) {
                  if (decoding) return OUTSIDE;
                  unresolved[i] = true;
               }
            }
            if (unresolved[i]) continue;
         }

         let c;
         if (byVar && typeof this.mapping[i] !== 'number') {
            const bases = layer.slotBases();
            const digits = new Array(bases.length).fill(0);
            for (const { d, unit } of carried[i]) {
               const pos = this._varPositions(layer, unit.vars);
               const sub = this._unpackSlots(layer, pos, bases, axisValues[d], model[d].combine);
               if (sub === HOLE) { c = HOLE; break; }
               pos.forEach((p, j) => { digits[p] = sub[j]; });
            }
            if (c !== HOLE) c = Codec.coordArr_to_int(digits, bases);
         } else {
            c = byVar ? axisValues[this.mapping[i]] : layerCoords[i];
         }

         // Every contiguous axis was range-checked above, so only a sparse axis can
         // hand a layer a coordinate past its size.
         const size = chained ? layer.resolvedCardinality : layer.cardinality;
         if (c === HOLE || (size != null && c >= size)) {
            if (decoding) return HOLE;
            unresolved[i] = true;
            continue;
         }
         if (!decoding && !sources.has(i)) continue;

         const value = layer.decode(c);
         if (value === HOLE || value === OUTSIDE) {
            if (decoding) return value;
            unresolved[i] = true;
            continue;
         }
         results[i] = value;
      }
      return decoding ? results : ranges;
   }

   // Resolve the string a chained layer templates from: an upstream layer's
   // chainValue() if it defines one (e.g. LSM's derivation), else its string result.
   _chainString(layer, value) {
      if (typeof layer.chainValue === 'function') return layer.chainValue();
      if (typeof value === 'string') return value;
      throw new Error('Ither: chain source must produce a string (or define chainValue)');
   }

   /**
    * Decode coordinates back to structures: one BigInt per output axis (a bare BigInt
    * for a single layer). Returns one structure per layer, OUTSIDE for a coordinate
    * past the range its axes have there, or HOLE for an in-range coordinate that
    * names no structure. See _walk.
    */
   decode(coordinate) {
      return this._walk(this._asCoordinate(coordinate), 'decode');
   }
}
