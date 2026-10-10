// ITHER.js — Combinators
// How several source coordinates SHARE one output axis (and split back).
//
// A combine is the cross-component slot of ITHER's ordering decomposition —
//   (per-component reindex) ∘ (component→axis assignment) ∘ (cross-component combine)
// — which together can express any product-space ordering. The combine itself is
// an *algorithm*, not data: a bijection between a tuple of bounded sources and a
// single coordinate. So combines are named, hard-coded FAMILIES, declared once for a
// whole space by the formula's `options.combine`, and resolved per axis.
//
// All families except `cantor` are CONTIGUOUS bijections onto [0, ∏cardinalities)
// — they differ only in *locality* (what a +1 does). `cantor` is sparse: it also
// works on sources with no bound (a split).
//
// A family that cannot apply where the formula uses it is refused at compile time,
// never replaced by another (see combineRefusal).
//
//   box       odometer — carries ripple across sources (anisotropic locality)
//   gray      reflected mixed-radix Gray code — +1 changes one source by ±1
//   morton    Z-order bit-interleave — powers of two only; dominated, kept as baseline
//   hilbert   2-D Hilbert curve — exactly two equal powers of two; ties gray
//   scramble  keyed Feistel permutation — decorrelated (the control ordering)
//   cantor    Cantor pairing — sparse; the only family that splits or takes unbounded sources
//
// The family set is fixed: the registry below is internal, not a public extension point.

import { Codec } from './Codec.js';
import { HOLE } from './Sentinels.js';

const prod = cards => cards.reduce((p, c) => p * c, 1n);

// mixed-radix value <-> ordered digits (most-significant first), BigInt-safe
const toMixed = (digits, cards) => { let a = 0n; for (let i = 0; i < digits.length; i++) a = a * cards[i] + digits[i]; return a; };
const fromMixed = (n, cards) => { const o = new Array(cards.length); let r = n; for (let k = cards.length - 1; k >= 0; k--) { o[k] = r % cards[k]; r = r / cards[k]; } return o; };

// reflected mixed-radix Gray code (Knuth 7.2.1.1); the two transforms share the
// parity-reflection loop and are mutual inverses
const standardToGray = (d, cards) => { const g = new Array(d.length); let s = 0n; for (let i = 0; i < d.length; i++) { g[i] = (s % 2n === 0n) ? d[i] : cards[i] - 1n - d[i]; s += d[i]; } return g; };
const grayToStandard = (g, cards) => { const d = new Array(g.length); let s = 0n; for (let i = 0; i < g.length; i++) { d[i] = (s % 2n === 0n) ? g[i] : cards[i] - 1n - g[i]; s += d[i]; } return d; };

// Deterministic format-preserving permutation of [0,N). Six Feistel rounds mix the
// packed source bits; cycle-walking skips the at-most-4x padded power-of-two range.
// The round key incorporates the ordered source cardinalities, so equal source layouts
// have the same stable ordering without privileging a mixed-radix stride.
// This is an ordering tool, not a cryptographic primitive.
const SCRAMBLE_ROUNDS = 6;
const SCRAMBLE_C1 = 0x9e3779b97f4a7c15n;
const SCRAMBLE_C2 = 0xbf58476d1ce4e5b9n;
const SCRAMBLE_C3 = 0x94d049bb133111ebn;
const SCRAMBLE_MASK64 = (1n << 64n) - 1n;

// SplitMix64's avalanche, used as a deterministic round function. Hashing BigInts in
// 64-bit chunks prevents the low-bit patterns that a truncated multiply preserves on
// small products such as the 16x16 folds used by colour grids.
const scrambleMix64 = value => {
   let z = (value + SCRAMBLE_C1) & SCRAMBLE_MASK64;
   z = ((z ^ (z >> 30n)) * SCRAMBLE_C2) & SCRAMBLE_MASK64;
   z = ((z ^ (z >> 27n)) * SCRAMBLE_C3) & SCRAMBLE_MASK64;
   return (z ^ (z >> 31n)) & SCRAMBLE_MASK64;
};

const scrambleHashBigInt = (value, seed) => {
   let hash = seed & SCRAMBLE_MASK64;
   let chunkKey = 0n;
   do {
      hash = scrambleMix64(hash ^ (value & SCRAMBLE_MASK64) ^ chunkKey);
      value >>= 64n;
      chunkKey = (chunkKey + SCRAMBLE_C1) & SCRAMBLE_MASK64;
   } while (value > 0n);
   return hash;
};

const scrambleSetup = cards => {
   const N = prod(cards);
   const bits = N <= 1n ? 1 : (N - 1n).toString(2).length;
   const halfBits = Math.ceil(bits / 2);
   const shift = BigInt(halfBits);
   const mask = (1n << shift) - 1n;
   let seed = SCRAMBLE_C1;
   for (let i = 0; i < cards.length; i++) {
      const position = (BigInt(i + 1) * SCRAMBLE_C3) & SCRAMBLE_MASK64;
      seed = scrambleMix64(scrambleHashBigInt(cards[i], seed) ^ position);
   }
   return { N, halfBits, shift, mask, seed };
};

const scrambleRound = (right, round, setup) => {
   const { halfBits, mask, seed } = setup;
   const roundKey = scrambleMix64(BigInt(round + 1) * SCRAMBLE_C2);
   let state = scrambleHashBigInt(right, seed ^ roundKey);
   let result = 0n;
   for (let offset = 0; offset < halfBits; offset += 64) {
      state = scrambleMix64(state ^ BigInt(offset) * SCRAMBLE_C1);
      result = (result << 64n) | state;
   }
   return result & mask;
};

const scrambleBlock = (value, setup, inverse) => {
   let left = value >> setup.shift;
   let right = value & setup.mask;
   if (!inverse) {
      for (let round = 0; round < SCRAMBLE_ROUNDS; round++) {
         [left, right] = [right, (left ^ scrambleRound(right, round, setup)) & setup.mask];
      }
   } else {
      for (let round = SCRAMBLE_ROUNDS - 1; round >= 0; round--) {
         [left, right] = [(right ^ scrambleRound(left, round, setup)) & setup.mask, left];
      }
   }
   return (left << setup.shift) | right;
};

const scramble = (value, cards, inverse = false) => {
   const setup = scrambleSetup(cards);
   if (setup.N <= 1n) return 0n;
   let result = scrambleBlock(value, setup, inverse);
   while (result >= setup.N) result = scrambleBlock(result, setup, inverse);
   return result;
};

//////////////////////////////////////////////////////////////////////////
// THE COMBINATOR INTERFACE
//////////////////////////////////////////////////////////////////////////

/**
 * A combine family. `pack(values, cards) -> BigInt` folds a tuple into one
 * coordinate; `unpack(value, cards) -> BigInt[]` is its inverse.
 *
 * Declarative metadata (the "hard edges" of each family):
 *   bounded     — produces a contiguous bijection onto [0, ∏cards) (clean axis bound)?
 *   locality    — what a +1 (and nearness) does, in words.
 *   holes       — can a coordinate in range decode to no valid tuple? (none yet do)
 *   applicable(cards) — whether this family can be used for these cardinalities
 *                 (e.g. morton needs powers of two); if false, it is refused.
 *   requirement — applicable() in words, or null when every list of cards applies.
 *   arity       — the exact number of sources it takes, or null for any number.
 */
export class Combinator {
   get key() { throw new Error('Combinator.key not implemented'); }
   get bounded() { return true; }
   get locality() { return 'unspecified'; }
   get holes() { return false; }
   get requirement() { return null; }
   get arity() { return null; }
   applicable(_cards) { return true; }
   // Size of the coordinate space this combine produces. Default ∏cards (a
   // bijection); a `holes:true` family returns a LARGER value (e.g. a padded
   // power-of-two range), the extra coordinates being holes.
   bound(cards) { return cards.reduce((p, c) => p * c, 1n); }
   pack(values, cards) { throw new Error(`Combinator(${this.key}).pack not implemented`); }
   // -> BigInt[] for a valid coordinate, or HOLE for a coordinate that maps
   // to no tuple (only `holes:true` families ever return HOLE). pack is always total.
   unpack(value, cards) { throw new Error(`Combinator(${this.key}).unpack not implemented`); }
}

class BoxCombinator extends Combinator {
   get key() { return 'box'; }
   get locality() { return 'anisotropic (odometer)'; }
   pack(values, cards) { return toMixed(values, cards); }
   unpack(value, cards) { return fromMixed(value, cards); }
}

class GrayCombinator extends Combinator {
   get key() { return 'gray'; }
   get locality() { return 'single-step (+1 flips one source by ±1)'; }
   pack(values, cards) { return toMixed(grayToStandard(values, cards), cards); }
   unpack(value, cards) { return standardToGray(fromMixed(value, cards), cards); }
}

class ScrambleCombinator extends Combinator {
   get key() { return 'scramble'; }
   get locality() { return 'none (decorrelated control)'; }
   pack(values, cards) { return scramble(toMixed(values, cards), cards); }
   unpack(value, cards) { return fromMixed(scramble(value, cards, true), cards); }
}

class CantorCombinator extends Combinator {
   get key() { return 'cantor'; }
   get bounded() { return false; }
   get locality() { return 'sparse (unbounded-capable)'; }
   pack(values) { return Codec.packList(values); }
   unpack(value, cards) { return Codec.unpackList(value, cards.length); }
}

// bit-length of the values of a power-of-two cardinality (log2): bits(8)=3, bits(1)=0
const bits = c => (c <= 1n ? 0 : (c - 1n).toString(2).length);
const isPow2 = c => c > 0n && (c & (c - 1n)) === 0n;

// Morton / Z-order: interleave the bits of each source (low planes first), so
// nearby points in the nD box stay near on the 1-D line — *geometric* locality
// (unlike gray's 1-D single-step). Contiguous + bijective onto [0, ∏cards) only
// when every card is a power of two (then ∏cards = 2^Σbits, no holes). For
// non-pow2 cards it is refused (a padded/holey morton awaits the hole contract).
class MortonCombinator extends Combinator {
   get key() { return 'morton'; }
   get locality() { return 'geometric (nD Z-order)'; }
   get requirement() { return 'every source cardinality a power of two'; }
   applicable(cards) { return cards.every(isPow2); }
   pack(values, cards) {
      const b = cards.map(bits), maxB = Math.max(0, ...b);
      let res = 0n, pos = 0n;
      for (let lvl = 0; lvl < maxB; lvl++)
         for (let a = 0; a < values.length; a++)
            if (lvl < b[a]) { res |= ((values[a] >> BigInt(lvl)) & 1n) << pos; pos++; }
      return res;
   }
   unpack(value, cards) {
      const b = cards.map(bits), maxB = Math.max(0, ...b);
      const out = cards.map(() => 0n);
      let pos = 0n;
      for (let lvl = 0; lvl < maxB; lvl++)
         for (let a = 0; a < cards.length; a++)
            if (lvl < b[a]) { out[a] |= ((value >> pos) & 1n) << BigInt(lvl); pos++; }
      return out;
   }
}

const allEqual = cards => cards.every(c => c === cards[0]);

// Hilbert curve — the space-filling curve with BOUNDED worst-case locality (no
// large jumps, unlike Morton). This is the canonical 2-D algorithm (Wikipedia
// xy2d/d2xy); it combines exactly TWO sources of equal power-of-two cardinality
// (a 2^k × 2^k square) into a contiguous bijection onto [0, side²). Otherwise it is
// refused. (>2 axes needs the nD algorithm; arbitrary cards
// need PADDED Hilbert, which introduces holes and so awaits the partial-mapping
// contract — both are future work.)
class HilbertCombinator extends Combinator {
   get key() { return 'hilbert'; }
   get locality() { return 'geometric (2-D, bounded worst-case)'; }
   get requirement() { return 'exactly two sources of the same power-of-two cardinality'; }
   get arity() { return 2; }
   applicable(cards) { return cards.length === 2 && allEqual(cards) && isPow2(cards[0]); }
   pack(values, cards) {
      const side = cards[0];
      let [x, y] = values, d = 0n;
      for (let s = side >> 1n; s > 0n; s >>= 1n) {
         const rx = (x & s) > 0n ? 1n : 0n;
         const ry = (y & s) > 0n ? 1n : 0n;
         d += s * s * ((3n * rx) ^ ry);
         if (ry === 0n) { if (rx === 1n) { x = side - 1n - x; y = side - 1n - y; } [x, y] = [y, x]; }
      }
      return d;
   }
   unpack(value, cards) {
      const side = cards[0];
      let x = 0n, y = 0n, t = value;
      for (let s = 1n; s < side; s <<= 1n) {
         const rx = 1n & (t >> 1n);
         const ry = 1n & (t ^ rx);
         if (ry === 0n) { if (rx === 1n) { x = s - 1n - x; y = s - 1n - y; } [x, y] = [y, x]; }
         x += s * rx; y += s * ry;
         t >>= 2n;
      }
      return [x, y];
   }
}

// the registry of built-in families. Not exported from the package: custom families are
// out of scope for the formula contract (test/layers.test.mjs registers a test family).
export const Combinators = new Map();
for (const C of [BoxCombinator, GrayCombinator, ScrambleCombinator, CantorCombinator, MortonCombinator, HilbertCombinator]) {
   const inst = new C();
   Combinators.set(inst.key, inst);
}

//////////////////////////////////////////////////////////////////////////
// APPLYING A DECLARED COMBINE
//////////////////////////////////////////////////////////////////////////

/**
 * Why `combine` cannot fold sources of these cardinalities, or null when it can.
 *   cards       (BigInt | null)[] — null for a source with no bound (a split part)
 *   fixedCount  false when the number of sources is not known at compile time (the
 *               slots of a chained layer follow its template); then only the
 *               per-source part of a family's requirement can be checked, and a family
 *               with a fixed arity cannot be.
 * Fewer than two sources are never folded, so they never refuse.
 */
export function combineRefusal(combine, cards, { fixedCount = true } = {}) {
   const family = Combinators.get(combine);
   if (fixedCount && cards.length < 2) return null;
   if (family.bounded && cards.some(card => card == null)) {
      return `'${combine}' needs every source to have a bound, and a split part has none (only an unbounded combine such as 'cantor' can carry one)`;
   }
   if (!fixedCount && family.arity != null) {
      return `'${combine}' needs ${family.requirement}, and the number of slots a chained layer puts here follows its template`;
   }
   if (family.requirement != null && !family.applicable(fixedCount ? cards : cards.flatMap(card => [card, card]))) {
      return `'${combine}' needs ${family.requirement} (got ${cards.join(', ')})`;
   }
   return null;
}

// Fold values into one coordinate with the declared combine, and back. The caller has
// checked it applies (combineRefusal). `unfold` may return HOLE for a holey family.
export function fold(combine, values, cards) {
   if (values.length === 0) return 0n;
   if (values.length === 1) return values[0];
   return Combinators.get(combine).pack(values, cards);
}

export function unfold(combine, value, cards) {
   if (cards.length === 0) return [];
   if (cards.length === 1) return [value];
   return Combinators.get(combine).unpack(value, cards);
}

/**
 * Pack source coordinates into output axes.
 *   sources  BigInt[]                     mapping  (number | number[])[]  one per source
 *   cards    (BigInt | null)[]            combines (string)[]              one per axis
 *   split    the combine that divides a source mapped to several axes
 * A number routes the whole source to that axis; an array splits it across
 * axes. Sources sharing an axis are folded by that axis's combine.
 */
export function groupPack(sources, mapping, cards, combines, split) {
   const buckets = {};
   for (let i = 0; i < sources.length; i++) {
      const m = mapping[i];
      if (typeof m === 'number') {
         (buckets[m] ||= []).push({ value: sources[i], card: cards[i] });
      } else {
         const parts = unfold(split, sources[i], m.map(() => null));
         m.forEach((d, j) => (buckets[d] ||= []).push({ value: parts[j], card: null }));
      }
   }
   const dims = [];
   for (let d = 0; d < combines.length; d++) {
      const items = buckets[d] || [];
      dims[d] = fold(combines[d], items.map(it => it.value), items.map(it => it.card));
   }
   return dims;
}

/** Inverse of groupPack, with the same arguments. */
export function groupUnpack(dims, mapping, cards, combines, split) {
   const dimItems = {};
   for (let i = 0; i < mapping.length; i++) {
      const m = mapping[i];
      if (typeof m === 'number') (dimItems[m] ||= []).push({ i, card: cards[i] });
      else m.forEach((d, j) => (dimItems[d] ||= []).push({ i, part: j, parts: m.length, card: null }));
   }
   const result = [];
   const splitParts = {};
   for (const d of Object.keys(dimItems)) {
      const items = dimItems[d];
      const values = unfold(combines[d], dims[d], items.map(it => it.card));
      const hole = values === HOLE;
      items.forEach((it, k) => {
         const v = hole ? HOLE : values[k];
         if (it.part == null) result[it.i] = v;
         else (splitParts[it.i] ||= new Array(it.parts))[it.part] = v;
      });
   }
   for (const i of Object.keys(splitParts)) {
      const parts = splitParts[i];
      result[i] = parts.includes(HOLE) ? HOLE : fold(split, parts, parts.map(() => null));
   }
   return result;
}
