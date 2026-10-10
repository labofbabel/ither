// Ither — CoordinateList (internal walker)
//
// An explicit list of coordinates the user chose: point k is coordinates[k]. A list of one
// coordinate is the single decode as a query. Each coordinate must be an array of one
// BigInt per axis; one with a negative value or a value at or past its axis's limit is out
// of range, skipped and counted like any geometry's (the single decode returns
// Ither.OUTSIDE for it). The limit is the Space's range when that is the same at every
// coordinate (`ranges`, caps included: the in-range points are then known up front), else
// its fixed bound; a range the Space resolves per coordinate is found on decode.

import { checkRange } from './Walker.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const SPEC_KEYS = new Set(['bounds', 'ranges', 'coordinates']);
const ENTRY_KEYS = new Set(['offset']);

function assertKeys(value, allowed, where) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`CoordinateList: unknown ${where} field '${key}'`);
   }
}

export class CoordinateList {
   #inBounds;

   constructor(spec) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('CoordinateList: specification must be an object');
      assertKeys(spec, SPEC_KEYS, 'specification');
      if (!Array.isArray(spec.bounds) || spec.bounds.length === 0) {
         throw new TypeError('CoordinateList: bounds must be a non-empty (BigInt | null) array');
      }
      const bounds = spec.bounds.slice();
      const axisCount = bounds.length;
      const ranges = spec.ranges ?? null;
      if (ranges !== null && (!Array.isArray(ranges) || ranges.length !== axisCount)) {
         throw new TypeError(`CoordinateList: ranges must be null or contain exactly ${axisCount} (BigInt | null) values`);
      }
      const limits = ranges ?? bounds;
      if (!Array.isArray(spec.coordinates)) throw new TypeError('CoordinateList: coordinates must be an array of coordinates');
      const coordinates = spec.coordinates.map((coordinate, k) => {
         if (!Array.isArray(coordinate) || coordinate.length !== axisCount) {
            throw new TypeError(`CoordinateList: coordinates[${k}] must be an array of ${axisCount} BigInt(s)`);
         }
         coordinate.forEach((value, i) => {
            if (typeof value !== 'bigint') throw new TypeError(`CoordinateList: coordinates[${k}][${i}] must be a BigInt`);
         });
         return Object.freeze(coordinate.slice());
      });

      this.axisCount = axisCount;
      this.bounds = Object.freeze(bounds);
      this.coordinates = Object.freeze(coordinates);
      this.count = BigInt(coordinates.length);
      this.known = ranges !== null;
      this.#inBounds = coordinates.map(coordinate =>
         coordinate.every((value, i) => value >= 0n && (limits[i] == null || value < limits[i])));
      Object.freeze(this);
   }

   entries(options = {}) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('CoordinateList: entry options must be an object');
      assertKeys(options, ENTRY_KEYS, 'entry option');
      const offset = hasOwn(options, 'offset') ? options.offset : 0n;
      checkRange('CoordinateList', this.count, offset);
      const list = this;
      return (function* walk() {
         for (let ordinal = offset; ordinal < list.count; ordinal++) {
            const k = Number(ordinal);
            if (list.#inBounds[k]) yield { ordinal, coordinate: list.coordinates[k].slice() };
            else yield { ordinal, outside: 1n };
         }
      })();
   }

   // In-range points in [offset, end) when the ranges are the same at every coordinate; else null.
   total(offset = 0n, end = this.count) {
      checkRange('CoordinateList', this.count, offset, end);
      if (!this.known) return null;
      let total = 0n;
      for (let k = Number(offset); k < Number(end); k++) if (this.#inBounds[k]) total++;
      return total;
   }

   // The per-axis [min, max] of every coordinate, in range or not; null when empty.
   box() {
      if (this.coordinates.length === 0) return null;
      return Array.from({ length: this.axisCount }, (_, i) => {
         let lo = this.coordinates[0][i];
         let hi = lo;
         for (const coordinate of this.coordinates) {
            if (coordinate[i] < lo) lo = coordinate[i];
            if (coordinate[i] > hi) hi = coordinate[i];
         }
         return { min: lo, max: hi };
      });
   }
}
