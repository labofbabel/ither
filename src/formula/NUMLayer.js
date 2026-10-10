// ITHER.js — NUMLayer (real-valued axes)
// Like OBJ, but each domain is a numeric *range* { min, max, steps } rather than a
// list of choices: a quantized real interval. decode gives real numbers
// (min + i·(max−min)/(steps−1)); encode snaps to the nearest grid index. Under the
// hood it's a mixed-radix numeral over the per-axis `steps` (BigInt, so steps can
// be large). cardinality = ∏ steps.
//
// schema: { type:'NUM', structure?:['frq','amp'], domains:{ frq:{min:0,max:1,steps:128}, amp:{min:0,max:1,steps:64} } }

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

export class NUMLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
   }

   get cardinality() {
      return this._schema.structure.reduce((p, k) => p * BigInt(this._schema.domains[k].steps), 1n);
   }

   // The base-64 base string exists only when every axis fits the 64-radix limit of
   // that representation; above 64 steps it's null (NUM's own encode/decode don't use
   // it — they work in BigInt over `steps`).
   get base() {
      const steps = this._schema.structure.map(k => this._schema.domains[k].steps);
      if (steps.some(s => s > 64)) return null;
      return Codec.intArr_to_baseStr(steps);
   }

   // Parting uses the raw step radices directly (not the base-64 string), so NUM
   // positions can be key-mapped to axes at *any* steps — the 64 cap was only
   // ever a property of the string form. (Per-position digits stay < steps, safe as
   // Numbers for any realistic range.)
   get radices() {
      return this._schema.structure.map(k => this._schema.domains[k].steps);
   }

   encode(struct = this._struct) {
      if (!struct || typeof struct !== 'object' || Array.isArray(struct)) {
         throw new Error('NUMLayer.encode: expects an object of numbers');
      }
      this._struct = struct;
      let coord = 0n;
      for (const k of this._schema.structure) {
         const { min, max, steps } = this._schema.domains[k];
         const v = Number(struct[k]);
         let idx = steps <= 1 ? 0 : Math.round((v - min) / (max - min) * (steps - 1));
         if (!Number.isFinite(idx) || idx < 0) idx = 0;
         if (idx > steps - 1) idx = steps - 1;
         coord = coord * BigInt(steps) + BigInt(idx);
      }
      this._coord = coord;
      return coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error('NUMLayer.decode: no coordinate provided');
      }
      const n = Codec.asCoordInt(coord);
      const card = this.cardinality;
      if (n < 0n || n >= card) throw new RangeError(`NUMLayer.decode: ${n} is outside [0, ${card})`);
      this._coord = n;

      const keys = this._schema.structure;
      const idxs = new Array(keys.length);
      let rem = n;
      for (let i = keys.length - 1; i >= 0; i--) {
         const steps = BigInt(this._schema.domains[keys[i]].steps);
         idxs[i] = Number(rem % steps);
         rem = rem / steps;
      }

      const out = {};
      keys.forEach((k, i) => {
         const { min, max, steps } = this._schema.domains[k];
         out[k] = steps <= 1 ? min : min + idxs[i] * (max - min) / (steps - 1);
      });
      this._struct = out;
      return out;
   }
}
