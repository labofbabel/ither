// ITHER.js — Layer (abstract base)
// A layer encodes one structure type into a coordinate and back. Subclasses
// implement encode()/decode(); this base handles schema ingestion and the
// shared accessors.

import { Codec } from './Codec.js';

export class Layer {
   constructor(schema) {
      this.schema = schema;
      this._struct = null;   // the structure to encode
      this._base = null;
      this._coord = null;    // encoded coordinate
      this._rank = null;     // rank of a generated structure (tree, etc.)
   }

   encode(input) {
      throw new Error(`encode() not implemented in ${this.constructor.name}`);
   }

   decode(encoded) {
      throw new Error(`decode() not implemented in ${this.constructor.name}`);
   }

   set schema(schema) {
      if (schema) this._schema = schema;
   }

   get base() {
      if (this._base) {
         return this._base;
      }

      if (this._schema && Array.isArray(this._schema.structure)) {
         let baseArr = [];
         for (let i = 0; i < this._schema.structure.length; i++) {
            const key = this._schema.structure[i];
            if (this._schema.domains.hasOwnProperty(key)) {
               baseArr.push(this._schema.domains[key].length);
            } else {
               baseArr.push(1);
            }
         }
         this._base = Codec.intArr_to_baseStr(baseArr);
         return this._base;
      }
   }

   get schema() {
      return this._schema;
   }

   // Number of distinct structures (size of the coordinate space): [0, cardinality).
   // Base-derived default works for OBJ/ARR/STR; AST/LSM override.
   get cardinality() {
      const b = this.base;
      return b != null ? Codec.max_value(b) + 1n : null;
   }

   // Whether `cardinality` counts structures only up to a formula cap (AST maxNodes,
   // LSM maxLen). A cap is a guardrail, not a bound of the space: a coordinate past
   // it decodes to OUTSIDE, but no axis reports it as a bound.
   get capped() { return false; }

   get rank() {
      return this._rank;
   }

   get struct() {
      return this._struct;
   }

   get coord() {
      return this._coord;
   }

   get type() {
      return this._schema?.type || 'unknown';
   }

   // Positional radices (per-position base sizes) for *parting* a fixed-shape layer's
   // positions onto separate axes. Default: derived from the base-64 base
   // string, so capped at radix 64 per position. `null` = not partable (no positional
   // base — the recurrence-ranked layers AST/LSM/TRI/PERM). NUM overrides this with
   // its raw `steps`, lifting the 64 cap (its math is BigInt; only the string capped).
   get radices() {
      const b = this.base;
      return typeof b === 'string' ? Codec.baseStr_to_intArr(b) : null;
   }
}
