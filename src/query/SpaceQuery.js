// Ither — SpaceQuery (internal)
//
// Bridges a walker to the single operation of its direction — space.decode(coordinate) or
// space.encode(structure) — so a grid, a ray or a list is a batch of exactly that call,
// never a second implementation of it. Walker violations throw. Each point's outcome is
// yielded as a record or an omission, in ordinal order, clipped to [offset, end):
//
//   { ordinal, coordinate, status: 'structure', structure }    decode
//   { ordinal, coordinate, status: 'hole' }                     decode, when holes are records
//   { ordinal, coordinate, status: 'error', error }             decode threw
//   { ordinal, structure, status: 'structure', coordinate }     encode
//   { ordinal, structure, status: 'error', error }              encode threw
//   { ordinal, omitted: 'outside' | 'hole', length }            a run of omitted ordinals
//
// Which outcomes are records and which are omissions is the policy (see Query.js): an
// out-of-range point is always omitted today, a hole is a record unless the policy omits it.

import { HOLE, OUTSIDE } from '../formula/Sentinels.js';
import {
   WalkerError,
   assertCoordinateFromWalker,
   assertEntryIterator,
   assertWalker,
} from './Walker.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function describeError(error) {
   if (error && typeof error === 'object') {
      return Object.freeze({
         name: typeof error.name === 'string' ? error.name : 'Error',
         message: typeof error.message === 'string' ? error.message : String(error),
      });
   }
   return Object.freeze({ name: 'Error', message: String(error) });
}

export class SpaceQuery {
   #contract;

   constructor(space, walker, direction) {
      if (direction !== 'decode' && direction !== 'encode') throw new TypeError("SpaceQuery: direction must be 'decode' or 'encode'");
      if (direction === 'decode') {
         const bounds = space.axisBounds();
         assertWalker(walker, { axisCount: space.axisCount, bounds });
         this.#contract = Object.freeze({ axisCount: space.axisCount, bounds: Object.freeze(bounds.slice()) });
      } else if (typeof walker?.entries !== 'function' || typeof walker.count !== 'bigint') {
         throw new WalkerError('an encode walker needs count and entries');
      }
      this.space = space;
      this.walker = walker;
      this.direction = direction;
      this.count = walker.count;
      Object.freeze(this);
   }

   // Records and omissions for every ordinal in [offset, end), in order.
   iterate({ offset, end, policy }) {
      let iterator;
      try {
         iterator = assertEntryIterator(this.walker.entries({ offset }));
      } catch (cause) {
         if (cause instanceof WalkerError) throw cause;
         throw new WalkerError('walker.entries threw', { ordinal: offset, cause });
      }

      const query = this;
      return (function* execute() {
         let expected = offset;
         try {
            while (expected < end) {
               let next;
               try { next = iterator.next(); }
               catch (cause) { throw new WalkerError('walker iterator threw', { ordinal: expected, cause }); }
               if (!next || typeof next !== 'object') {
                  throw new WalkerError('walker iterator returned an invalid iterator result', { ordinal: expected });
               }
               if (next.done) throw new WalkerError(`walker ended at ordinal ${expected}; expected entries up to ${query.count}`, { ordinal: expected });

               const entry = next.value;
               if (!entry || typeof entry !== 'object' || entry.ordinal !== expected) {
                  throw new WalkerError(`walker entry must have ordinal ${expected}`, { ordinal: expected });
               }
               if (hasOwn(entry, 'outside')) {
                  if (typeof entry.outside !== 'bigint' || entry.outside <= 0n || expected + entry.outside > query.count) {
                     throw new WalkerError(`walker reported an invalid out-of-range run at ordinal ${expected}`, { ordinal: expected });
                  }
                  const length = expected + entry.outside > end ? end - expected : entry.outside;
                  yield { ordinal: expected, omitted: 'outside', length };
                  expected += length;
                  continue;
               }
               yield query.direction === 'decode'
                  ? query.#decode(expected, assertCoordinateFromWalker(query.#contract, entry.coordinate, expected), policy)
                  : query.#encode(expected, entry.structure);
               expected++;
            }
         } finally {
            if (typeof iterator.return === 'function') {
               try { iterator.return(); } catch { /* walker cleanup must not hide the primary result */ }
            }
         }
      })();
   }

   #decode(ordinal, coordinate, policy) {
      let structure;
      try {
         structure = this.space.decode(coordinate);
      } catch (error) {
         return { ordinal, coordinate, status: 'error', error: describeError(error) };
      }
      if (structure === OUTSIDE) return { ordinal, omitted: 'outside', length: 1n };
      if (structure === HOLE) {
         return policy.hole === 'omit' ? { ordinal, omitted: 'hole', length: 1n } : { ordinal, coordinate, status: 'hole' };
      }
      return { ordinal, coordinate, status: 'structure', structure };
   }

   #encode(ordinal, structure) {
      try {
         return { ordinal, structure, status: 'structure', coordinate: this.space.encode(structure) };
      } catch (error) {
         return { ordinal, structure, status: 'error', error: describeError(error) };
      }
   }
}
