// ITHER.js — PERMLayer (permutations)
// Ranks the permutations of [0, n) — there are n! of them — via the Lehmer code
// (factorial number system). A coordinate <-> a specific ordering. This makes the
// *array-order* lever itself an ITHER structure: a permutation can reorder a
// domain, a position list, anything. Like AST/TRI it's recurrence-ranked (no
// positional digits), so it is opaque to parting and defaults to Cantor combine.
//
// schema: { type:'PERM', structure:{ n: 5 } }
// encode([2,0,1,4,3]) -> BigInt   ·   decode(coord) -> [2,0,1,4,3]

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

const _fact = [1n];
function factorial(n) {
   while (_fact.length <= n) _fact.push(_fact[_fact.length - 1] * BigInt(_fact.length));
   return _fact[n];
}

export class PERMLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
      this._n = this._schema.structure.n;
   }

   get cardinality() { return factorial(this._n); }

   encode(perm = this._struct) {
      if (!Array.isArray(perm) || perm.length !== this._n) {
         throw new Error(`PERMLayer.encode: expects a permutation array of length ${this._n}`);
      }
      this._struct = perm;
      const n = this._n;
      const seen = new Array(n).fill(false);
      let coord = 0n;
      for (let i = 0; i < n; i++) {
         const v = perm[i];
         if (!Number.isInteger(v) || v < 0 || v >= n) throw new Error(`PERMLayer.encode: invalid element ${v} (expected 0..${n - 1})`);
         if (seen[v]) throw new Error(`PERMLayer.encode: repeated element ${v} (not a permutation)`);
         let less = 0;
         for (let j = 0; j < v; j++) if (!seen[j]) less++;
         seen[v] = true;
         coord += BigInt(less) * factorial(n - 1 - i);
      }
      this._coord = coord;
      return coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error('PERMLayer.decode: no coordinate provided');
      }
      const n = Codec.asCoordInt(coord);
      const card = this.cardinality;
      if (n < 0n || n >= card) throw new RangeError(`PERMLayer.decode: ${n} is outside [0, ${card})`);
      this._coord = n;

      const N = this._n;
      const avail = Array.from({ length: N }, (_, i) => i);
      const result = [];
      let rem = n;
      for (let k = N - 1; k >= 0; k--) {
         const f = factorial(k);
         const idx = Number(rem / f);
         rem = rem % f;
         result.push(avail.splice(idx, 1)[0]);
      }
      this._struct = result;
      return result;
   }
}
