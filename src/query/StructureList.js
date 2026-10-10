// Ither — StructureList (internal walker for the encode direction)
//
// An explicit list of structures: point k is structures[k], encoded to a coordinate. A list
// of one structure is the single encode as a query. The form of every structure — an object
// with exactly the Space's layer names — is checked before the walk starts; whether a layer
// can encode its part is found per point (an `error` record naming the layer).

import { checkRange } from './Walker.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class StructureList {
   constructor({ layerNames, structures }) {
      if (!Array.isArray(structures)) throw new TypeError('StructureList: structures must be an array of structures');
      structures.forEach((structure, k) => {
         const where = `structures[${k}]`;
         if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
            throw new TypeError(`StructureList: ${where} must be a structure keyed by layer name`);
         }
         for (const key of Object.keys(structure)) {
            if (!layerNames.includes(key)) throw new TypeError(`StructureList: ${where} has unknown layer '${key}' (layers: ${layerNames.join(', ')})`);
         }
         const missing = layerNames.find(name => !hasOwn(structure, name));
         if (missing) throw new TypeError(`StructureList: ${where} is missing the structure of layer '${missing}'`);
      });
      this.structures = structures;
      this.count = BigInt(structures.length);
      Object.freeze(this);
   }

   entries({ offset = 0n } = {}) {
      checkRange('StructureList', this.count, offset);
      const list = this;
      return (function* walk() {
         for (let ordinal = offset; ordinal < list.count; ordinal++) yield { ordinal, structure: list.structures[Number(ordinal)] };
      })();
   }

   // every structure gives a record: a coordinate or an error
   total(offset = 0n, end = this.count) {
      checkRange('StructureList', this.count, offset, end);
      return end - offset;
   }
}
