// ITHER.js — ARRLayer
// Fixed-shape arrays. Position i draws from domain schema.structure[i]. Decoded
// elements are coerced to their natural types (numbers/booleans/null).
//
// schema: { type:"ARR", structure:['a','b','c','d','a'], domains:{ a:[1,2,3], ... } }

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

export class ARRLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
   }

   encode(struct = this._struct) {
      if (struct === null || struct === undefined) {
         throw new Error("ARRLayer.encode: no structure provided");
      }
      if (typeof struct === 'string') {
         throw new Error("ARRLayer.encode expects an array, not a string");
      }
      if (!Array.isArray(struct)) {
         throw new Error("ARRLayer.encode expects an array");
      }
      const arr = struct;
      this._struct = arr;

      const shape = this._schema.structure;
      if (!Array.isArray(shape) || shape.length !== arr.length) {
         throw new Error(`schema.structure must be an array of length ${arr.length}`);
      }

      const coordArr = [];
      const baseArr = [];
      for (let i = 0; i < shape.length; i++) {
         const key = shape[i];
         let dom = Codec.str_to_arr(this._schema.domains[key]);

         const val = arr[i] + ""; // compare as string against the domain
         const idx = Codec.domainIndexOf(dom, val);
         if (idx < 0) {
            throw new Error(`Value ${val} not in domain for "${key}"`);
         }

         coordArr.push(idx);
         baseArr.push(dom.length);
      }

      const mixed = Codec.intArr_to_coordStr(coordArr, baseArr);
      this._coord = Codec.mixedBase_to_int(mixed);
      return this._coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error("ARRLayer.decode: no coordinate provided");
      }
      const n = Codec.asCoordInt(coord);
      this._coord = n;

      const b = this.base;
      const [coordPart] = (Codec.int_to_mixedBase(n, b) + "~" + b).split("~");
      const idxs = Codec.coordStr_to_intArr(coordPart);

      const shape = this._schema.structure;
      if (idxs.length !== shape.length) {
         throw new Error("Coord length does not match schema.structure");
      }

      const result = [];
      for (let i = 0; i < shape.length; i++) {
         const key = shape[i];
         let dom = Codec.str_to_arr(this._schema.domains[key]);
         result.push(Codec.inferTypes(dom[idxs[i]]));
      }

      this._struct = result;
      return result;
   }
}
