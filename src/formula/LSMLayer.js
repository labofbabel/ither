// ITHER.js — LSMLayer (L-system grammars)
// Ranks the *space of L-system grammars* over a fixed alphabet. Each production
// RHS is a bounded sequence over the alphabet (a Kleene selection); the grammar
// coordinate is the mixed-radix combination of the per-variable RHS ranks.
//
// This is the distinctive capability: move through integers to explore grammars.
// (Parameters are not encoded here — combine an LSM layer with AST layers, à la
// examples/hybrid.mjs, to get parametric variation.)
//
// schema: {
//   type: 'LSM',
//   structure: { variables: ['F'], maxLen: 4, axiom: 'F' },
//   domains: 'alphabet:[F, +, -]'
// }
//
// encode(rules) where rules = { F: 'F+F', … } -> BigInt
// decode(coord) -> rules object
// expand(rules, iterations) -> the derived string (apply rules to the axiom)

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

function tokenize(str, alphabet) {
   const syms = [...alphabet].sort((a, b) => b.length - a.length); // longest first
   const out = [];
   let i = 0;
   while (i < str.length) {
      if (/\s/.test(str[i])) { i++; continue; }
      let matched = null;
      for (const s of syms) { if (str.startsWith(s, i)) { matched = s; break; } }
      if (matched === null) throw new Error(`LSMLayer: symbol at "${str.slice(i)}" not in alphabet`);
      out.push(alphabet.indexOf(matched));
      i += matched.length;
   }
   return out;
}

export class LSMLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
   }

   set schema(schema) {
      super.schema = schema;
      const s = this._schema;
      if (s && s.domains && s.structure) {
         this._alphabet = s.domains.alphabet;
         this._variables = s.structure.variables;
         this._maxLen = s.structure.maxLen;
         this._axiom = s.structure.axiom;
         this._A = this._alphabet.length;
         this._radix = Codec.kleeneCount(this._A, this._maxLen); // per-variable radix
      }
   }

   get schema() { return super.schema; }

   // number of grammars: radix^(number of variables)
   get cardinality() {
      return this._radix ** BigInt(this._variables.length);
   }

   // the count runs only up to the maxLen cap on each production
   get capped() { return true; }

   // value used when this layer is the source of a chain: the derived string
   // (so a downstream STR layer can substitute over the L-system's expansion).
   chainValue() {
      return this.expand(this._struct, this._schema.structure.iterations);
   }

   encode(rules = this._struct) {
      if (!rules || typeof rules !== 'object') {
         throw new Error('LSMLayer.encode: expects a rules object { variable: rhsString, … }');
      }
      this._struct = rules;

      let coord = 0n;
      for (const v of this._variables) {
         const rhs = rules[v];
         if (rhs === undefined) throw new Error(`LSMLayer.encode: missing production for "${v}"`);
         const rank = Codec.kleeneRank(tokenize(rhs, this._alphabet), this._A, this._maxLen);
         coord = coord * this._radix + rank;
      }
      this._coord = coord;
      return coord;
   }

   decode(coord = this._coord) {
      if (coord === null || coord === undefined || coord === '') {
         throw new Error('LSMLayer.decode: no coordinate provided');
      }
      let c = Codec.asCoordInt(coord);

      // outside the grammar space there is no grammar; then extract per-variable ranks
      const total = this._radix ** BigInt(this._variables.length);
      if (c < 0n || c >= total) throw new RangeError(`LSMLayer.decode: ${c} is outside [0, ${total})`);
      this._coord = c;

      const ranks = new Array(this._variables.length);
      for (let i = this._variables.length - 1; i >= 0; i--) {
         ranks[i] = c % this._radix;
         c = c / this._radix;
      }

      const rules = {};
      for (let i = 0; i < this._variables.length; i++) {
         const seq = Codec.kleeneUnrank(ranks[i], this._A, this._maxLen);
         rules[this._variables[i]] = seq.map(idx => this._alphabet[idx]).join('');
      }
      this._struct = rules;
      return rules;
   }

   // Apply the grammar to the axiom `iterations` times. Symbols with a rule are
   // rewritten; symbols without one are constants (kept as-is).
   expand(rules = this._struct, iterations = 3) {
      let cur = this._axiom;
      for (let it = 0; it < iterations; it++) {
         cur = tokenize(cur, this._alphabet)
            .map(idx => {
               const sym = this._alphabet[idx];
               return rules[sym] !== undefined ? rules[sym] : sym;
            })
            .join('');
      }
      return cur;
   }
}
