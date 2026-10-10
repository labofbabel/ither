// ITHER.js — TRILayer (polygon triangulations)
// Ranks the triangulations of a convex polygon with n vertices. There are
// Catalan(n-2) of them — the same family as binary trees — and they cannot be
// enumerated by the data layers (ARR/OBJ would also produce invalid, crossing
// dissections). A coordinate <-> a specific non-crossing triangulation.
//
// schema: { type:'TRI', structure:{ n: 6 } }   // n = polygon vertices (>= 3)
// encode(triangles) -> BigInt   where triangles = [[a,b,c], …]
// decode(coord)     -> [[a,b,c], …]  (n-2 triangles, vertices 0..n-1)

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

const _cat = [1n]; // Catalan numbers, C_0 = 1
function catalan(m) {
   while (_cat.length <= m) {
      const k = _cat.length;
      let s = 0n;
      for (let i = 0; i < k; i++) s += _cat[i] * _cat[k - 1 - i];
      _cat.push(s);
   }
   return _cat[m];
}

// triangulations of the convex sub-polygon over `verts` (a contiguous run),
// with base edge (verts[0], verts[last]). block(k) = C(left) * C(right).
function unrankTri(verts, idx) {
   const p = verts.length;
   if (p < 3) return [];
   let rem = BigInt(idx);
   for (let k = 1; k <= p - 2; k++) {
      const rightCount = catalan(p - k - 2);   // right sub-polygon: verts[k..last], (p-k) verts
      const block = catalan(k - 1) * rightCount; // left: verts[0..k], (k+1) verts
      if (rem < block) {
         const li = rem / rightCount, ri = rem % rightCount;
         const tri = [verts[0], verts[k], verts[p - 1]];
         return [tri, ...unrankTri(verts.slice(0, k + 1), li), ...unrankTri(verts.slice(k), ri)];
      }
      rem -= block;
   }
   throw new Error('TRILayer: triangulation index out of range');
}

function rankTri(verts, triangles) {
   const p = verts.length;
   if (p < 3) return 0n;
   const a = verts[0], b = verts[p - 1];
   const vset = new Set(verts);
   let apex = -1;
   for (const t of triangles) {
      if (t.includes(a) && t.includes(b)) {
         const third = t.find(x => x !== a && x !== b);
         if (vset.has(third)) { apex = third; break; }
      }
   }
   if (apex < 0) throw new Error('TRILayer: base-edge triangle not found (not a valid triangulation)');
   const k = verts.indexOf(apex);
   const rightCount = catalan(p - k - 2);
   let offset = 0n;
   for (let j = 1; j < k; j++) offset += catalan(j - 1) * catalan(p - j - 2);
   const li = rankTri(verts.slice(0, k + 1), triangles);
   const ri = rankTri(verts.slice(k), triangles);
   return offset + li * rightCount + ri;
}

export class TRILayer extends Layer {
   constructor(schema = {}) {
      super(schema);
      this._n = this._schema.structure.n;
   }

   get cardinality() { return catalan(this._n - 2); }

   _verts() { return Array.from({ length: this._n }, (_, i) => i); }

   encode(triangles = this._struct) {
      if (!Array.isArray(triangles)) throw new Error('TRILayer.encode: expects an array of [a,b,c] triangles');
      this._struct = triangles;
      this._coord = rankTri(this._verts(), triangles);
      return this._coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error('TRILayer.decode: no coordinate provided');
      }
      const n = Codec.asCoordInt(coord);
      const card = this.cardinality;
      if (n < 0n || n >= card) throw new RangeError(`TRILayer.decode: ${n} is outside [0, ${card})`);
      this._coord = n;
      this._struct = unrankTri(this._verts(), n);
      return this._struct;
   }
}
