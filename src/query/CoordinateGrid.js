// Ither — CoordinateGrid (internal walker)
//
// Deterministic enumeration of a strided coordinate grid over any number of axes. This module
// is deliberately independent of Space, decoding and analysis. Callers provide:
//   bounds       — the Space's exclusive per-axis bounds; `null` where it fixes none
//   axes         — one { start, end, step } per axis: inclusive, start <= end, step > 0
//   ranges       — optional: coordinate -> the exclusive range of every axis at that
//                  coordinate (BigInt | null), for a Space whose ranges vary
//   dependencies — optional: for each axis, the axes whose values `ranges` reads
//
// Every point of the requested box has an ordinal: its position in the box, last
// axis fastest. A point keeps its ordinal whether or not it is in range, so offsets
// stay exact. `entries()` walks the ordinals, yielding each in-range point, and each
// run of out-of-range ordinals as one count: a range narrowed at a coordinate is
// skipped arithmetically, not point by point. Nothing is clamped.

import { checkRange } from './Walker.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function assertRecord(value, where) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`CoordinateGrid: ${where} must be an object`);
   }
}

function assertKeys(value, allowed, where) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`CoordinateGrid: unknown ${where} field '${key}'`);
   }
}

function requireBigInt(value, where) {
   if (typeof value !== 'bigint') throw new TypeError(`CoordinateGrid: ${where} must be a BigInt`);
   return value;
}

const SPEC_KEYS = new Set(['bounds', 'axes', 'ranges', 'dependencies']);
const AXIS_KEYS = new Set(['start', 'end', 'step']);
const ENTRY_KEYS = new Set(['offset']);

export class CoordinateGrid {
   #strides;
   #ranges;
   #sources;
   #cache = { key: null, ranges: null };

   constructor(spec) {
      assertRecord(spec, 'specification');
      assertKeys(spec, SPEC_KEYS, 'specification');

      if (!Array.isArray(spec.bounds) || spec.bounds.length === 0) {
         throw new TypeError('CoordinateGrid: bounds must be a non-empty (BigInt | null) array');
      }
      if (!Array.isArray(spec.axes)) {
         throw new TypeError('CoordinateGrid: axes must be an array');
      }
      if (spec.axes.length !== spec.bounds.length) {
         throw new RangeError(`CoordinateGrid: axes length ${spec.axes.length} does not match bounds length ${spec.bounds.length}`);
      }

      const bounds = spec.bounds.map((raw, i) => {
         if (raw === null) return null;
         const bound = requireBigInt(raw, `bounds[${i}]`);
         if (bound <= 0n) throw new RangeError(`CoordinateGrid: bounds[${i}] must be greater than zero`);
         return bound;
      });
      const axisCount = bounds.length;

      if (hasOwn(spec, 'ranges') && typeof spec.ranges !== 'function') {
         throw new TypeError('CoordinateGrid: ranges must be a function');
      }
      const dependencies = hasOwn(spec, 'dependencies') ? spec.dependencies : bounds.map(() => []);
      if (!Array.isArray(dependencies) || dependencies.length !== axisCount) {
         throw new TypeError(`CoordinateGrid: dependencies must contain one array per axis`);
      }
      const deps = dependencies.map((list, i) => {
         if (!Array.isArray(list)) throw new TypeError(`CoordinateGrid: dependencies[${i}] must be an array of axis indices`);
         return list.map(axis => {
            if (!Number.isInteger(axis) || axis < 0 || axis >= axisCount || axis === i) {
               throw new RangeError(`CoordinateGrid: dependencies[${i}] names invalid axis ${axis}`);
            }
            return axis;
         });
      });
      if (deps.some(list => list.length > 0) && !hasOwn(spec, 'ranges')) {
         throw new TypeError('CoordinateGrid: dependencies require a ranges function');
      }

      const counts = [];
      const axes = spec.axes.map((raw, i) => {
         assertRecord(raw, `axes[${i}]`);
         assertKeys(raw, AXIS_KEYS, `axes[${i}]`);
         if (!hasOwn(raw, 'start')) throw new TypeError(`CoordinateGrid: axes[${i}].start is required`);
         if (!hasOwn(raw, 'end')) throw new TypeError(`CoordinateGrid: axes[${i}].end is required`);

         const start = requireBigInt(raw.start, `axes[${i}].start`);
         const end = requireBigInt(raw.end, `axes[${i}].end`);
         const step = hasOwn(raw, 'step') ? requireBigInt(raw.step, `axes[${i}].step`) : 1n;

         if (start < 0n) throw new RangeError(`CoordinateGrid: axes[${i}].start must be non-negative`);
         if (start > end) throw new RangeError(`CoordinateGrid: axes[${i}].start must not exceed end`);
         if (step <= 0n) throw new RangeError(`CoordinateGrid: axes[${i}].step must be greater than zero`);

         const count = ((end - start) / step) + 1n;
         counts.push(count);
         return Object.freeze({ start, end, step, count });
      });

      const strides = new Array(counts.length);
      let count = 1n;
      for (let i = counts.length - 1; i >= 0; i--) {
         strides[i] = count;
         count *= counts[i];
      }

      this.axisCount = axisCount;
      this.bounds = Object.freeze(bounds);
      this.axes = Object.freeze(axes);
      this.axisCounts = Object.freeze(counts);
      this.count = count;
      this.dependencies = Object.freeze(deps.map(list => Object.freeze(list.slice())));
      this.#strides = Object.freeze(strides);
      this.#ranges = spec.ranges ?? null;
      this.#sources = [...new Set(deps.flat())].sort((a, b) => a - b);
      Object.freeze(this);
   }

   // Every ordinal from `offset` to `count`, accounted for exactly once, in order:
   //   { ordinal, coordinate }  an in-range point
   //   { ordinal, outside }     a run of `outside` consecutive out-of-range ordinals
   entries(options = {}) {
      assertRecord(options, 'entry options');
      assertKeys(options, ENTRY_KEYS, 'entry option');
      const offset = hasOwn(options, 'offset') ? requireBigInt(options.offset, 'offset') : 0n;
      checkRange('CoordinateGrid', this.count, offset);

      const grid = this;
      return (function* walk() {
         let ordinal = offset;
         while (ordinal < grid.count) {
            const digits = grid.#digits(ordinal);
            const coordinate = grid.#coordinate(digits);
            const run = grid.#outsideRun(ordinal, digits, coordinate);
            if (run === 0n) {
               yield { ordinal, coordinate };
               ordinal++;
            } else {
               yield { ordinal, outside: run };
               ordinal += run;
            }
         }
      })();
   }

   // In-range points with an ordinal in [offset, end), where that is known without
   // walking — when no axis's range depends on another. Otherwise null.
   total(offset = 0n, end = this.count) {
      checkRange('CoordinateGrid', this.count, offset, end);
      if (this.#sources.length > 0) return null;
      const ranges = this.#rangesAt(this.axes.map(axis => axis.start));
      const valid = this.axes.map((_, i) => this.#valid(i, ranges[i]));
      return this.#validBelow(end, valid) - this.#validBelow(offset, valid);
   }

   // The per-axis [min, max] of the box, in range or not. A grid axis has at least one value.
   box() {
      return this.axes.map(axis => ({ min: axis.start, max: axis.start + (axis.count - 1n) * axis.step }));
   }

   #digits(ordinal) {
      return this.axes.map((axis, i) => (ordinal / this.#strides[i]) % axis.count);
   }

   #coordinate(digits) {
      return digits.map((digit, i) => this.axes[i].start + digit * this.axes[i].step);
   }

   #rangesAt(coordinate) {
      if (this.#ranges == null) return this.bounds;
      const key = this.#sources.map(axis => coordinate[axis]).join(',');
      if (this.#cache.key !== key) {
         const ranges = this.#ranges(coordinate.slice());
         if (!Array.isArray(ranges) || ranges.length !== this.axisCount
            || ranges.some(range => range !== null && (typeof range !== 'bigint' || range < 0n))) {
            throw new TypeError(`CoordinateGrid: ranges must return ${this.axisCount} non-negative BigInts or nulls`);
         }
         this.#cache.key = key;
         this.#cache.ranges = ranges;
      }
      return this.#cache.ranges;
   }

   // How many of axis i's requested values lie below both its bound and its range.
   #valid(i, range) {
      const axis = this.axes[i];
      const bound = this.bounds[i];
      const upper = bound == null ? range : range == null ? bound : (range < bound ? range : bound);
      if (upper == null) return axis.count;
      if (upper <= axis.start) return 0n;
      const below = (upper - 1n - axis.start) / axis.step + 1n;
      return below < axis.count ? below : axis.count;
   }

   // 0n if the point at `ordinal` is in range. Otherwise how many ordinals from it
   // are out of range for the same reason. Axes are checked in order and the first
   // failing axis decides: if its range depends only on earlier axes, every later
   // value of it in this block fails too, so the run reaches the end of the block.
   // Otherwise the run ends where the axes that fix its range next change.
   #outsideRun(ordinal, digits, coordinate) {
      const ranges = this.#rangesAt(coordinate);
      for (let i = 0; i < this.axisCount; i++) {
         if (digits[i] < this.#valid(i, ranges[i])) continue;
         const last = Math.max(i, ...this.dependencies[i]);
         const span = last === i ? this.axes[i].count * this.#strides[i] : this.#strides[last];
         return span - (ordinal % span);
      }
      return 0n;
   }

   // In-range points with an ordinal below `ordinal`, given each axis's valid count.
   #validBelow(ordinal, valid) {
      if (ordinal >= this.count) return valid.reduce((product, v) => product * v, 1n);
      const digits = this.#digits(ordinal);
      let below = 0n;
      for (let i = 0; i < this.axisCount; i++) {
         let rest = 1n;
         for (let j = i + 1; j < this.axisCount; j++) rest *= valid[j];
         if (digits[i] >= valid[i]) return below + valid[i] * rest;
         below += digits[i] * rest;
      }
      return below;
   }
}
