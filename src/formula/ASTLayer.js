// ITHER.js — ASTLayer
// Expression trees. A single global index enumerates whole *decorated* trees:
// the topology and the symbol at every node, jointly (an extended Schroder
// recursion where count(0)=|x| and count(m) folds in operator domain sizes).
// No separate symbol coordinate, no Cantor pairing.
//
// schema: { type:"AST", domains:{ x:[...], o1:[...], o2:[...], ... }, maxNodes, ranking }

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

const RANKINGS = new Set(['leafMinor', 'leafMajor', 'opMajor']);

export class ASTLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
   }

   set schema(schema) {
      super.schema = schema;
      if (this._schema && this._schema.domains) {
         const arities = [...Codec.extractAritiesFromDomains(this._schema.domains)]
            .sort((a, b) => a - b);
         this._arities = arities;
         // no defaults here: the formula rules write them in (src/formula/FormulaRules.js)
         this._maxNodes = this._schema.maxNodes;
         this._ranking = this._schema.ranking;
         if (!Number.isInteger(this._maxNodes)) throw new Error('ASTLayer: maxNodes must be given');
         if (!RANKINGS.has(this._ranking)) {
            throw new Error(`ASTLayer: unknown ranking '${this._ranking}' (expected ${[...RANKINGS].join(', ')})`);
         }
         this._gen = this.makeDecoratedGenerator(arities, this._schema.domains, this._maxNodes, this._ranking);
      }
   }

   get schema() {
      return super.schema;
   }

   // total decorated trees up to the maxNodes cap
   get cardinality() {
      let sum = 0n;
      for (let k = 0; k <= this._maxNodes; k++) sum += this._gen.count(k);
      return sum;
   }

   // the count runs only up to maxNodes — a guardrail, not the size of the space
   get capped() { return true; }

   encode(struct) {
      if (typeof struct !== 'string' || struct === '') {
         throw new Error("ASTLayer.encode: expects an expression string");
      }
      this._struct = struct;

      const { ast } = Codec.str_to_ast(struct);
      const index = this._gen.rankExpr(ast);

      this._rank = index;
      this._coord = index;

      return index;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error("ASTLayer.decode: no coordinate provided");
      }
      const index = Codec.asCoordInt(coord);

      this._rank = index;
      this._coord = index;
      this._struct = this._gen.exprByIndex(index);

      return this._struct;
   }

   /////////////////////////////
   // DECORATED TREE GENERATOR
   /////////////////////////////

   /**
   * Mixed-arity trees whose nodes carry domain symbols. count(0) = |x| (leaf
   * choices); count(m) folds each operator domain's size into the Schroder
   * recursion, so symbol choices are part of the ranking — one index, no pairing.
   * @param {number[]} arities  sorted, e.g. [1,2,3]
   * @param {object}   domains  parsed schema.domains ({ x:[...], o1:[...], ... })
   * @param {number}   maxNodes cap on internal-node count (an index past it throws)
   * @param {string}   ranking  'leafMinor' (default — root-major, rightmost-leaf-minor;
   *                            extended Schröder enumeration), 'leafMajor' (leaves are
   *                            LSB chunk: small +1 cycles leaves, larger jumps flip
   *                            operators, even larger flip topology), or 'opMajor'
   *                            (operators are LSB chunk: small +1 cycles operators).
   */
   makeDecoratedGenerator(arities, domains, maxNodes, ranking = 'leafMinor') {
      const ALLOWED = arities;
      const L = domains.x.length;
      const opCount = a => domains['o' + a].length;
      const opSym = (a, i) => domains['o' + a][i];
      const leafSym = i => domains.x[i];
      const leafIndex = name => domains.x.indexOf(name);
      const opIndex = (a, name) => domains['o' + a].indexOf(name);

      function* compositions(sum, parts) {
         if (parts === 1) { yield [sum]; return; }
         for (let i = 0; i <= sum; i++)
            for (const rest of compositions(sum - i, parts - 1))
               yield [i, ...rest];
      }

      // count_[m] = number of decorated trees with m internal nodes
      const count_ = [BigInt(L)];
      function count(n) {
         while (count_.length <= n) {
            const m = count_.length;
            let sum = 0n;
            for (const a of ALLOWED) {
               let inner = 0n;
               for (const tuple of compositions(m - 1, a)) {
                  let block = 1n;
                  for (const sz of tuple) block *= count(sz);
                  inner += block;
               }
               sum += BigInt(opCount(a)) * inner;
            }
            count_.push(sum);
         }
         return count_[n];
      }

      // local index -> expression string, within the size-k block
      function unrank(k, idx) {
         idx = BigInt(idx);
         if (k === 0) return leafSym(Number(idx));

         for (const a of ALLOWED) {
            for (const tuple of compositions(k - 1, a)) {
               let childBlock = 1n;
               for (const sz of tuple) childBlock *= count(sz);
               const block = BigInt(opCount(a)) * childBlock;

               if (idx < block) {
                  const opChoice = Number(idx / childBlock); // most significant
                  let rem = idx % childBlock;
                  const children = [];
                  for (let i = 0; i < a; i++) {
                     let radix = 1n;
                     for (let j = i + 1; j < a; j++) radix *= count(tuple[j]);
                     children.push(unrank(tuple[i], rem / radix));
                     rem = rem % radix;
                  }
                  return `${opSym(a, opChoice)}(${children.join(',')})`;
               }
               idx -= block;
            }
         }
         throw new Error("unrank: index out of range");
      }

      function countNodes(node) {
         if (node.type === 'value') return 0;
         return 1 + node.args.reduce((s, c) => s + countNodes(c), 0);
      }

      // expression node -> local index within its size-k block
      function rank(node) {
         const k = countNodes(node);
         if (k === 0) {
            const li = leafIndex(node.name);
            if (li < 0) throw new Error(`Leaf "${node.name}" not in domain x`);
            return BigInt(li);
         }

         const a = node.args.length;
         const oi = opIndex(a, node.name);
         if (oi < 0) throw new Error(`Operator "${node.name}" not in domain o${a}`);
         const childSizes = node.args.map(countNodes);

         let idx = 0n;
         for (const aa of ALLOWED) {
            if (aa !== a) {
               for (const tuple of compositions(k - 1, aa)) {
                  let cb = 1n;
                  for (const sz of tuple) cb *= count(sz);
                  idx += BigInt(opCount(aa)) * cb;
               }
               continue;
            }
            for (const tuple of compositions(k - 1, a)) {
               const same = tuple.length === childSizes.length
                  && tuple.every((v, i) => v === childSizes[i]);
               if (same) {
                  let childBlock = 1n;
                  for (const sz of tuple) childBlock *= count(sz);
                  let off = BigInt(oi) * childBlock;
                  for (let i = 0; i < a; i++) {
                     let radix = 1n;
                     for (let j = i + 1; j < a; j++) radix *= count(childSizes[j]);
                     off += rank(node.args[i]) * radix;
                  }
                  return idx + off;
               }
               let cb = 1n;
               for (const sz of tuple) cb *= count(sz);
               idx += BigInt(opCount(a)) * cb;
            }
            throw new Error("rank: composition not found");
         }
         throw new Error(`rank: arity ${a} not allowed`);
      }

      // global, across all sizes
      function rankExpr(node) {
         const k = countNodes(node);
         let cum = 0n;
         for (let i = 0; i < k; i++) cum += count(i);
         return cum + rank(node);
      }

      function exprByIndex(rawIndex) {
         const idx = BigInt(rawIndex);
         if (idx < 0n) throw new RangeError(`ASTLayer: index ${idx} is negative`);

         let cum = 0n;
         for (let k = 0; k <= maxNodes; k++) {
            const block = count(k);
            if (idx < cum + block) return unrank(k, idx - cum);
            cum += block;
         }
         throw new RangeError(`ASTLayer: index ${idx} is past the maxNodes ${maxNodes} cap`);
      }

      ///////////////////////////////////////////////////////////////////////
      // Alternative rankings: 'leafMajor' and 'opMajor'.
      // These reorganize the digit layout WITHIN each (size, shape) block so a
      // chosen kind of choice (leaves or operators) sits in the low-order chunk
      // of the rank — giving "small +1 cycles X first" behavior. Shapes within a
      // size class are enumerated in the same order as leafMinor's structural
      // recursion (arity ascending, then composition order), so size-block
      // boundaries align across rankings.
      ///////////////////////////////////////////////////////////////////////

      const SHAPE_LEAF = { arity: 0, children: [], leaves: 1, internals: 0 };

      function* enumerateShapesOfSize(k) {
         if (k === 0) { yield SHAPE_LEAF; return; }
         for (const a of ALLOWED) {
            for (const tuple of compositions(k - 1, a)) {
               yield* enumerateShapeProduct(a, tuple);
            }
         }
      }
      function* enumerateShapeProduct(a, tuple) {
         const lists = tuple.map(sz => [...enumerateShapesOfSize(sz)]);
         function* cart(i, acc) {
            if (i === lists.length) {
               const children = acc.slice();
               const leaves = children.reduce((s, c) => s + c.leaves, 0);
               const internals = 1 + children.reduce((s, c) => s + c.internals, 0);
               yield { arity: a, children, leaves, internals };
               return;
            }
            for (const c of lists[i]) { acc.push(c); yield* cart(i + 1, acc); acc.pop(); }
         }
         yield* cart(0, []);
      }

      function shapeOpProduct(s) {
         if (s.arity === 0) return 1n;
         let p = BigInt(opCount(s.arity));
         for (const c of s.children) p *= shapeOpProduct(c);
         return p;
      }
      function shapeLeafProduct(s) { return BigInt(L) ** BigInt(s.leaves); }
      function shapeBlockSize(s) { return shapeOpProduct(s) * shapeLeafProduct(s); }

      function collectRadices(s, op, leaf) {
         if (s.arity === 0) { leaf.push(BigInt(L)); return; }
         op.push(BigInt(opCount(s.arity)));
         for (const c of s.children) collectRadices(c, op, leaf);
      }
      // leftmost-MSB mixed-radix
      function mixedToDigits(n, radices) {
         const digits = new Array(radices.length);
         const strides = new Array(radices.length);
         let s = 1n;
         for (let i = radices.length - 1; i >= 0; i--) { strides[i] = s; s *= radices[i]; }
         let rem = n;
         for (let i = 0; i < radices.length; i++) {
            digits[i] = Number(rem / strides[i]);
            rem = rem % strides[i];
         }
         return digits;
      }
      function digitsToMixed(digits, radices) {
         let v = 0n;
         const strides = new Array(radices.length);
         let s = 1n;
         for (let i = radices.length - 1; i >= 0; i--) { strides[i] = s; s *= radices[i]; }
         for (let i = 0; i < digits.length; i++) v += BigInt(digits[i]) * strides[i];
         return v;
      }

      function nodeToShape(n) {
         if (n.type === 'value') return SHAPE_LEAF;
         const children = n.args.map(nodeToShape);
         const leaves = children.reduce((s, c) => s + c.leaves, 0);
         const internals = 1 + children.reduce((s, c) => s + c.internals, 0);
         return { arity: n.args.length, children, leaves, internals };
      }
      function sameShape(a, b) {
         if (a.arity !== b.arity) return false;
         if (a.children.length !== b.children.length) return false;
         for (let i = 0; i < a.children.length; i++) if (!sameShape(a.children[i], b.children[i])) return false;
         return true;
      }

      function unrankAlt(k, idx) {
         idx = BigInt(idx);
         for (const s of enumerateShapesOfSize(k)) {
            const block = shapeBlockSize(s);
            if (idx < block) {
               const opProd = shapeOpProduct(s);
               const leafProd = shapeLeafProduct(s);
               let opLocal, leafLocal;
               if (ranking === 'leafMajor') {
                  opLocal = idx / leafProd;
                  leafLocal = idx % leafProd;
               } else { // opMajor
                  leafLocal = idx / opProd;
                  opLocal = idx % opProd;
               }
               const opRadices = [], leafRadices = [];
               collectRadices(s, opRadices, leafRadices);
               const opDigits = mixedToDigits(opLocal, opRadices);
               const leafDigits = mixedToDigits(leafLocal, leafRadices);
               let oc = 0, lc = 0;
               function build(s) {
                  if (s.arity === 0) return leafSym(leafDigits[lc++]);
                  const opName = opSym(s.arity, opDigits[oc++]);
                  return `${opName}(${s.children.map(build).join(',')})`;
               }
               return build(s);
            }
            idx -= block;
         }
         throw new Error(`unrankAlt: out of range for size ${k}`);
      }

      function rankAlt(node) {
         const ours = nodeToShape(node);
         const k = ours.internals;
         let cum = 0n;
         let matched = null;
         for (const s of enumerateShapesOfSize(k)) {
            if (sameShape(s, ours)) { matched = s; break; }
            cum += shapeBlockSize(s);
         }
         if (!matched) throw new Error('rankAlt: shape not found in enumeration');
         const opDigits = [], leafDigits = [];
         function walk(n) {
            if (n.type === 'value') {
               const li = leafIndex(n.name);
               if (li < 0) throw new Error(`Leaf "${n.name}" not in domain x`);
               leafDigits.push(li);
               return;
            }
            const a = n.args.length;
            const oi = opIndex(a, n.name);
            if (oi < 0) throw new Error(`Operator "${n.name}" not in domain o${a}`);
            opDigits.push(oi);
            for (const c of n.args) walk(c);
         }
         walk(node);
         const opRadices = [], leafRadices = [];
         collectRadices(matched, opRadices, leafRadices);
         const opLocal = digitsToMixed(opDigits, opRadices);
         const leafLocal = digitsToMixed(leafDigits, leafRadices);
         const opProd = shapeOpProduct(matched);
         const leafProd = shapeLeafProduct(matched);
         const local = (ranking === 'leafMajor')
            ? opLocal * leafProd + leafLocal
            : leafLocal * opProd + opLocal;
         return cum + local;
      }

      const finalRank = (ranking === 'leafMinor') ? rank : rankAlt;
      const finalUnrank = (ranking === 'leafMinor') ? unrank : unrankAlt;

      function rankExprFinal(node) {
         const k = countNodes(node);
         let cum = 0n;
         for (let i = 0; i < k; i++) cum += count(i);
         return cum + finalRank(node);
      }
      function exprByIndexFinal(rawIndex) {
         const idx = BigInt(rawIndex);
         if (idx < 0n) throw new RangeError(`ASTLayer: index ${idx} is negative`);
         let cum = 0n;
         for (let k = 0; k <= maxNodes; k++) {
            const block = count(k);
            if (idx < cum + block) return finalUnrank(k, idx - cum);
            cum += block;
         }
         throw new RangeError(`ASTLayer: index ${idx} is past the maxNodes ${maxNodes} cap`);
      }

      return {
         count,
         unrank: finalUnrank,
         rank: finalRank,
         rankExpr: rankExprFinal,
         exprByIndex: exprByIndexFinal,
         countNodes,
      };
   }
}
