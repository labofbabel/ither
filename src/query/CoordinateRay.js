// Ither — CoordinateRay (internal walker)
//
// A finite prefix of an integer-lattice ray: point k = start + direction · k, for
// 0 <= k < count. `start` is a coordinate (non-negative); `direction` is signed and not
// all zero, and carries the increment (a longer direction is a larger step).
//
// Out of range is skipped and counted, as for every geometry. Along a ray each axis is
// linear in k, so the points that are non-negative and below every axis's limit form one
// interval of k: the ordinals before and after it are two arithmetic runs. The limit is the
// Space's range when that is the same at every coordinate (`ranges`, caps included: then the
// in-range points are known up front), else its fixed bound — and a point in the interval
// may still be out of the range the Space resolves at it (a chained axis), found on decode.

import { checkRange } from './Walker.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const SPEC_KEYS = new Set(['bounds', 'ranges', 'start', 'direction', 'count']);
const ENTRY_KEYS = new Set(['offset']);

function assertRecord(value, where) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`CoordinateRay: ${where} must be an object`);
   }
}

function assertKeys(value, allowed, where) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`CoordinateRay: unknown ${where} field '${key}'`);
   }
}

function requireBigInt(value, where) {
   if (typeof value !== 'bigint') throw new TypeError(`CoordinateRay: ${where} must be a BigInt`);
   return value;
}

function requireVector(value, axisCount, where) {
   if (!Array.isArray(value) || value.length !== axisCount) {
      throw new TypeError(`CoordinateRay: ${where} must contain exactly ${axisCount} BigInts`);
   }
   return value.map((item, i) => requireBigInt(item, `${where}[${i}]`));
}

export class CoordinateRay {
   constructor(spec) {
      assertRecord(spec, 'specification');
      assertKeys(spec, SPEC_KEYS, 'specification');

      if (!Array.isArray(spec.bounds) || spec.bounds.length === 0) {
         throw new TypeError('CoordinateRay: bounds must be a non-empty (BigInt | null) array');
      }
      const bounds = spec.bounds.map((bound, i) => {
         if (bound === null) return null;
         requireBigInt(bound, `bounds[${i}]`);
         if (bound <= 0n) throw new RangeError(`CoordinateRay: bounds[${i}] must be greater than zero`);
         return bound;
      });
      const axisCount = bounds.length;
      const ranges = spec.ranges ?? null;
      if (ranges !== null && (!Array.isArray(ranges) || ranges.length !== axisCount)) {
         throw new TypeError(`CoordinateRay: ranges must be null or contain exactly ${axisCount} (BigInt | null) values`);
      }
      const limits = ranges ?? bounds;
      const start = requireVector(spec.start, axisCount, 'start');
      const direction = requireVector(spec.direction, axisCount, 'direction');
      const count = requireBigInt(spec.count, 'count');

      start.forEach((value, i) => {
         if (value < 0n) throw new RangeError(`CoordinateRay: start[${i}] must be non-negative`);
      });
      if (count < 0n) throw new RangeError('CoordinateRay: count must be non-negative');
      if (direction.every(component => component === 0n)) {
         throw new RangeError('CoordinateRay: direction must contain a non-zero component');
      }

      // the interval of k within every limit and non-negative, as [first, last]
      let first = 0n;
      let last = count - 1n;
      for (let i = 0; i < axisCount; i++) {
         const s = start[i];
         const d = direction[i];
         const b = limits[i];
         if (d > 0n) {
            if (b != null) last = min(last, s >= b ? -1n : (b - 1n - s) / d);
         } else if (d < 0n) {
            last = min(last, s / -d); // stays non-negative
            if (b != null && s >= b) first = max(first, ceilDiv(s - b + 1n, -d));
         } else if (b != null && s >= b) {
            last = -1n;
         }
      }

      this.axisCount = axisCount;
      this.bounds = Object.freeze(bounds);
      this.start = Object.freeze(start);
      this.direction = Object.freeze(direction);
      this.count = count;
      this.known = ranges !== null;
      this.first = first <= last ? first : count;
      this.last = first <= last ? last : count - 1n;
      Object.freeze(this);
   }

   #at(k) {
      return this.start.map((value, i) => value + this.direction[i] * k);
   }

   entries(options = {}) {
      assertRecord(options, 'entry options');
      assertKeys(options, ENTRY_KEYS, 'entry option');
      const offset = hasOwn(options, 'offset') ? requireBigInt(options.offset, 'offset') : 0n;
      checkRange('CoordinateRay', this.count, offset);
      const ray = this;
      return (function* walk() {
         let ordinal = offset;
         if (ordinal < ray.first) {
            yield { ordinal, outside: ray.first - ordinal };
            ordinal = ray.first;
         }
         for (; ordinal <= ray.last; ordinal++) yield { ordinal, coordinate: ray.#at(ordinal) };
         if (ordinal < ray.count) yield { ordinal, outside: ray.count - ordinal };
      })();
   }

   // In-range points in [offset, end) when the ranges are the same at every coordinate;
   // otherwise unknown, since a range is resolved per point.
   total(offset = 0n, end = this.count) {
      checkRange('CoordinateRay', this.count, offset, end);
      if (!this.known) return null;
      const from = max(offset, this.first);
      const to = min(end - 1n, this.last);
      return to < from ? 0n : to - from + 1n;
   }

   // The per-axis [min, max] of every point of the ray, in range or not; null when empty.
   box() {
      if (this.count === 0n) return null;
      const end = this.#at(this.count - 1n);
      return this.start.map((value, i) => ({ min: min(value, end[i]), max: max(value, end[i]) }));
   }
}

const min = (a, b) => (a < b ? a : b);
const max = (a, b) => (a > b ? a : b);
const ceilDiv = (a, b) => (a + b - 1n) / b;
