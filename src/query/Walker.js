// Ither — the walker protocol (internal)
//
// A walker is what a geometry becomes when a query walks it. It is any synchronous
// object exposing:
//   axisCount             positive integer
//   bounds                exclusive BigInt bounds or null, one per axis — what the Space fixes
//   count                 non-negative BigInt — the ordinals the geometry spans
//   entries({ offset })   an iterator over every ordinal from offset to count, each accounted
//                         for once and in order: { ordinal, coordinate } for a point to
//                         decode, { ordinal, outside } for a run of out-of-range ordinals
//   total(offset, end)    in-range points with an ordinal in [offset, end), or null when
//                         that is not known without walking
//
// Walkers stay independent of Space and decoding. SpaceQuery validates every entry and
// coordinate where a walker meets decoding.

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class WalkerError extends TypeError {
   constructor(message, { ordinal = null, cause = undefined } = {}) {
      super(`Walker: ${message}`, cause === undefined ? undefined : { cause });
      this.name = 'WalkerError';
      if (ordinal != null) this.ordinal = ordinal;
   }
}

function fail(message, details) {
   throw new WalkerError(message, details);
}

function assertObject(value, where) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} must be an object`);
}

function assertAxisCount(value, where) {
   if (!Number.isInteger(value) || value <= 0) fail(`${where} must be a positive integer`);
}

function assertBounds(bounds, axisCount, where) {
   if (!Array.isArray(bounds) || bounds.length !== axisCount) {
      fail(`${where} must contain exactly ${axisCount} bounds`);
   }
   bounds.forEach((bound, i) => {
      if (bound !== null && (typeof bound !== 'bigint' || bound <= 0n)) {
         fail(`${where}[${i}] must be a positive BigInt or null`);
      }
   });
}

export function assertWalker(walker, expected = {}) {
   assertObject(walker, 'walker');
   assertObject(expected, 'expected contract');

   const expectedKeys = new Set(['axisCount', 'bounds']);
   for (const key of Object.keys(expected)) {
      if (!expectedKeys.has(key)) fail(`unknown expected contract field '${key}'`);
   }

   assertAxisCount(walker.axisCount, 'walker.axisCount');
   assertBounds(walker.bounds, walker.axisCount, 'walker.bounds');
   if (typeof walker.count !== 'bigint' || walker.count < 0n) fail('walker.count must be a non-negative BigInt');
   if (typeof walker.entries !== 'function') fail('walker.entries must be a function');
   if (typeof walker.total !== 'function') fail('walker.total must be a function');

   if (hasOwn(expected, 'axisCount')) {
      assertAxisCount(expected.axisCount, 'expected axisCount');
      if (walker.axisCount !== expected.axisCount) {
         fail(`walker axisCount ${walker.axisCount} does not match expected axisCount ${expected.axisCount}`);
      }
   }
   if (hasOwn(expected, 'bounds')) {
      const axisCount = hasOwn(expected, 'axisCount') ? expected.axisCount : walker.axisCount;
      assertBounds(expected.bounds, axisCount, 'expected bounds');
      for (let i = 0; i < axisCount; i++) {
         if (walker.bounds[i] !== expected.bounds[i]) {
            fail(`walker.bounds[${i}] (${walker.bounds[i]}) does not match expected bound ${expected.bounds[i]}`);
         }
      }
   }

   return walker;
}

// A coordinate a walker yields as in range: an array of non-negative BigInts below every
// fixed bound. A walker reports anything else as `outside`, so this failing is a walker bug.
export function assertCoordinateFromWalker(contract, coordinate, ordinal = null) {
   const at = ordinal == null ? '' : ` at ordinal ${ordinal}`;
   if (!Array.isArray(coordinate)) fail(`coordinate${at} must be an array`, { ordinal });
   if (coordinate.length !== contract.axisCount) {
      fail(`coordinate${at} has ${coordinate.length} values; expected ${contract.axisCount}`, { ordinal });
   }

   const copy = coordinate.slice();
   copy.forEach((value, i) => {
      if (typeof value !== 'bigint') fail(`coordinate${at}[${i}] must be a BigInt`, { ordinal });
      const bound = contract.bounds[i];
      if (value < 0n) {
         fail(`coordinate${at}[${i}] (${value}) must be non-negative`, { ordinal });
      }
      if (bound != null && value >= bound) {
         fail(`coordinate${at}[${i}] (${value}) is outside [0, ${bound})`, { ordinal });
      }
   });
   return copy;
}

export function assertEntryIterator(iterator) {
   if (!iterator || typeof iterator.next !== 'function' || typeof iterator[Symbol.iterator] !== 'function') {
      fail('walker.entries must return an iterable iterator');
   }
   if (iterator[Symbol.iterator]() !== iterator) fail('walker iterator must return itself from Symbol.iterator');
   return iterator;
}

// Shared by the walkers: an offset into [0, count], and a page end into [offset, count].
export function checkRange(name, count, offset, end = count) {
   if (typeof offset !== 'bigint') throw new TypeError(`${name}: offset must be a BigInt`);
   if (typeof end !== 'bigint') throw new TypeError(`${name}: end must be a BigInt`);
   if (offset < 0n || offset > count) throw new RangeError(`${name}: offset ${offset} is outside [0, ${count}]`);
   if (end < offset || end > count) throw new RangeError(`${name}: end ${end} is outside [${offset}, ${count}]`);
}
