// ITHER.js — OBJLayer
// Key/value objects. Each key draws from its domain; choices become mixed-radix
// digits. Incomplete objects are tolerated (missing keys are padded). Decoded
// values are coerced to their natural types (numbers/booleans/null).
//
// schema: { type:"OBJ", structure:["frq","amp",...], domains:{ frq:[...], amp:[...] } }

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

export class OBJLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
   }

   encode(struct = this._struct) {
      if (struct === null || struct === undefined) {
         throw new Error("OBJLayer.encode: no structure provided");
      }
      if (typeof struct === 'string') {
         throw new Error("OBJLayer.encode expects an object, not a string");
      }
      if (typeof struct !== 'object' || Array.isArray(struct)) {
         throw new Error("OBJLayer.encode expects a plain object");
      }
      this._struct = struct;

      if (!this._schema.structure) {
         // last resort — much better to provide schema.structure explicitly.
         // Sort deterministically (code-unit) so the digit order is canonical
         // regardless of the object's key-insertion order.
         this._schema.structure = Object.keys(this._struct)
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }

      let baseArr = [];
      let coordArr = [];

      for (let i = 0; i < this._schema.structure.length; i++) {
         const key = this._schema.structure[i];
         const symSet = this._schema.domains[key];
         const elem = this._struct[key];

         if (elem !== undefined && elem !== null && symSet) {
            baseArr.push(symSet.length);
            coordArr.push(Codec.domainIndexOf(symSet, elem));
         } else {
            // allow incomplete objects (assuming the schema is complete)
            baseArr.push(1);  // pad
            coordArr.push(0); // pad
         }
      }

      const mixed = Codec.intArr_to_coordStr(coordArr, baseArr);
      this._coord = Codec.mixedBase_to_int(mixed);
      return this._coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error("OBJLayer.decode: no coordinate provided");
      }
      const n = Codec.asCoordInt(coord);
      this._coord = n;

      const b = this.base;
      const [coordPart] = (Codec.int_to_mixedBase(n, b) + "~" + b).split('~');
      const coordArr = Codec.coordStr_to_intArr(coordPart);

      let _obj = {};
      for (let i = 0; i < this._schema.structure.length; i++) {
         const key = this._schema.structure[i];
         if (this._schema.domains.hasOwnProperty(key)) {
            _obj[key] = Codec.inferTypes(this._schema.domains[key][coordArr[i]]);
         }
      }

      this._struct = _obj;
      return this._struct;
   }
}
