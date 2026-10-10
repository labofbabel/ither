// ITHER.js — Codec
// Pure, stateless combinatorial conversions: mixed-radix <-> BigInt, Cantor
// pairing, base-string helpers, and the loose parsers used by the layers.
// Every method is static; nothing here holds state.

import { LooseObjectParser } from './LooseObjectParser.js';

export class Codec {

   // URL-safe base64 digit alphabet
   static alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

   //////////////////////////////////////////////////////////////////////////
   // CANTOR PAIRING / LIST PACKING
   //////////////////////////////////////////////////////////////////////////

   static pairInts(a, b) {
      const s = a + b;
      return (s * (s + 1n) / 2n) + b;
   }

   static unpairInt(z) {
      const w = ((Codec.bigIntSqrt(8n * z + 1n) - 1n) / 2n);
      const t = (w * (w + 1n)) / 2n;
      const b = z - t;
      const a = w - b;
      return [a, b];
   }

   static bigIntSqrt(n) {
      if (n < 2n) return n;
      let x0 = n, x1 = (n >> 1n) + 1n;
      while (x1 < x0) {
         x0 = x1;
         x1 = ((n / x1) + x1) >> 1n;
      }
      return x0;
   }

   static packList(values) {
      // fold Cantor pairing over the array
      return values.reduce((acc, x, i) => i === 0 ? x : Codec.pairInts(acc, x), 0n);
   }

   static unpackList(code, N) {
      const out = Array(N);
      let acc = code;
      for (let i = N - 1; i >= 1; i--) {
         const [prev, xi] = Codec.unpairInt(acc);
         out[i] = xi;
         acc = prev;
      }
      out[0] = acc;
      return out;
   }

   // NOTE: axis remapping (groupPack/groupUnpack) and the combine families
   // (box/gray/scramble/cantor) live in Combinators.js — combines are pluggable
   // algorithm families, kept out of this pure-conversion module. Codec keeps the
   // Cantor primitives (packList/unpackList) they build on.

   //////////////////////////////////////////////////////////////////////////
   // STRING / OBJECT / ARRAY PARSING
   //////////////////////////////////////////////////////////////////////////

   /**
    * Parse a loose object/array string into a value, then deterministically
    * sort keys (code-unit order). Bare values are kept as strings by default
    * (coerceBareValues:false) so domain literals like "1.0" survive intact;
    * typing happens later (decode / inferTypes / domainIndexOf).
    */
   static str_to_obj(input, { coerceBareValues = false } = {}) {
      if (input == null) return {};
      if (typeof input === 'object') return Codec._sortKeysDeep(input);

      const src = String(input).trim();
      if (!src) return {};

      const parsed = new LooseObjectParser(src, { coerceBareValues, allowTopLevelArray: true }).parse();
      return Codec._sortKeysDeep(parsed);
   }

   // Recursively sort object keys by code unit (locale-independent, deterministic).
   // Arrays keep their order — element order is meaningful in ITHER.
   static _sortKeysDeep(value) {
      if (Array.isArray(value)) return value.map(v => Codec._sortKeysDeep(v));
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
         Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, Codec._sortKeysDeep(v)])
      );
   }

   /**
    * Parse a nested expression (e.g. "mix(dot(nrm(F), I), F.x, 1.0)") into an
    * AST. Returns { symbols, symbolKeys, ast, arities }.
    */
   static str_to_ast(str) {
      let i = 0;
      const s = str.replaceAll(/\s/g, '');
      const aritySet = new Set();
      const symbols = [];
      const symbolKeys = [];

      function skipWS() {
         while (/\s/.test(s[i])) i++;
      }

      function parseNode() {
         skipWS();
         const start = i;
         // Identifiers are "anything not structural" — the AST grammar's only
         // structural characters are '(', ')', ',', and whitespace. Anything else
         // (letters, digits, '_', '.', '&', '$', '@', '#', '-', etc.) is part of
         // an identifier. Domain values like "&V.x" or shader-style names need this.
         while (i < s.length && !/[(),\s]/.test(s[i])) i++;
         if (i === start) throw new Error(`Expected identifier at pos ${i}`);
         const name = s.slice(start, i);
         skipWS();

         let arityLabel = 'x'; // default

         if (s[i] === '(') {
            i++; // skip '('
            const args = [];
            skipWS();
            if (s[i] !== ')') {
               while (true) {
                  args.push(parseNode());
                  skipWS();
                  if (s[i] === ',') {
                     i++;
                     skipWS();
                     continue;
                  }
                  break;
               }
            }
            if (s[i] !== ')') throw new Error(`Expected ')' at pos ${i}`);
            i++; // skip ')'
            arityLabel = `o${args.length}`;
            aritySet.add(args.length);
            symbols.push(name);
            symbolKeys.push(arityLabel);
            return {
               type: 'call',
               name,
               args,
               arity: arityLabel
            };
         }

         // value node
         symbols.push(name);
         symbolKeys.push(arityLabel);
         return {
            type: 'value',
            name,
            arity: arityLabel
         };
      }

      const node = parseNode();
      skipWS();
      if (i < s.length) throw new Error(`Unexpected token at pos ${i}`);

      return {
         symbols,
         symbolKeys,
         ast: node,
         arities: [...aritySet].sort((a, b) => a - b)
      };
   }

   static ast_to_str(node, { abstract = false } = {}) {
      if (node.type === 'value') {
         return abstract ? 'x' : node.name;
      }

      if (node.type === 'call') {
         const argsStr = node.args.map(arg =>
            Codec.ast_to_str(arg, { abstract })
         ).join(',');

         const name = abstract ? node.arity : node.name;
         return `${name}(${argsStr})`;
      }

      throw new Error(`Unknown node type: ${node.type}`);
   }

   /**
    * Parse "[1,2,3]" or "1,2,3" into [1,2,3]; numeric items become numbers.
    * Passing an actual array returns it unchanged.
    */
   static str_to_arr(input) {
      if (Array.isArray(input)) return input;
      if (typeof input !== "string") {
         throw new TypeError("str_to_arr expects a string or array");
      }
      let s = input.trim();
      if (s.startsWith("[") && s.endsWith("]")) {
         s = s.slice(1, -1).trim();
      }
      if (s === "") return [];
      return s
         .split(",")
         .map(item => {
            const t = item.trim();
            return /^[+-]?\d+(\.\d+)?$/.test(t)
               ? (t.includes(".") ? parseFloat(t) : parseInt(t, 10))
               : t;
         });
   }

   //////////////////////////////////////////////////////////////////////////
   // MIXED-RADIX  <->  BIGINT
   //////////////////////////////////////////////////////////////////////////

   /**
    * Decode a BigInt (or 'rank::code') into mixed-base digits. A code outside
    * [0, max] has no digits and throws — decode reports OUTSIDE before reaching here.
    */
   static int_to_mixedBase(n, baseStr) {
      let prefix = '';
      let code;
      if (typeof n === 'string' && n.includes('::')) {
         [prefix, n] = n.split('::');
         prefix += '::';
         code = BigInt(n);
      } else {
         code = typeof n === 'bigint' ? n : BigInt(n);
      }

      const maxAcc = Codec.max_value(baseStr);
      if (code < 0n || code > maxAcc) {
         throw new RangeError(`Codec.int_to_mixedBase: ${code} is outside [0, ${maxAcc}]`);
      }

      const L = baseStr.length;
      const radices = Array.from(baseStr, c => BigInt(Codec.char_to_int(c) + 1));
      const digits = Array(L);

      for (let i = L - 1; i >= 0; i--) {
         const r = radices[i];
         const d = code % r;
         digits[i] = Codec.int_to_char(Number(d));
         code = code / r;
      }

      return prefix + digits.join('');
   }

   static intArr_to_baseStr(baseArr, { maxDigit = true } = {}) {
      return baseArr
         .map(b => {
            const v = maxDigit ? b - 1 : b;
            return Codec.int_to_char(v);
         })
         .join('');
   }

   static baseStr_to_intArr(str, { maxDigit = true } = {}) {
      return [...str].map(char => {
         const v = Codec.char_to_int(char);
         return maxDigit ? v + 1 : v;
      });
   }

   static intArr_to_coordStr(coordArr, baseArr) {
      const coordStr = coordArr.map(Codec.int_to_char).join('');
      const baseStr = baseArr.map(b => Codec.int_to_char(b - 1)).join('');
      return `${coordStr}~${baseStr}`;
   }

   static coordStr_to_intArr(str) {
      return [...str].map((char) => Codec.char_to_int(char));
   }

   // Digits and ranks outside their radices throw: a clamped value would name a
   // different structure than the one asked for.
   static coordArr_to_int(coordArr, baseArr) {
      if (coordArr.length !== baseArr.length) {
         throw new Error("Coordinate and base arrays must be the same length");
      }

      let result = 0n;

      for (let i = 0; i < coordArr.length; i++) {
         const b = BigInt(baseArr[i]);
         const c = BigInt(coordArr[i]);
         if (c < 0n || c >= b) throw new RangeError(`Codec.coordArr_to_int: digit ${i} (${c}) is outside [0, ${b})`);
         result = result * b + c;
      }

      return result;
   }

   static int_to_coordArr(rank, baseArr) {
      rank = BigInt(rank);

      let max = 0n;
      for (let i = 0; i < baseArr.length; i++) {
         const b = BigInt(baseArr[i]);
         max = max * b + (b - 1n);
      }

      if (rank < 0n || rank > max) {
         throw new RangeError(`Codec.int_to_coordArr: ${rank} is outside [0, ${max}]`);
      }

      const coordArr = new Array(baseArr.length);
      for (let i = baseArr.length - 1; i >= 0; i--) {
         const b = BigInt(baseArr[i]);
         coordArr[i] = Number(rank % b);
         rank = rank / b;
      }

      return coordArr;
   }

   static coordStr_to_int(str) {
      const { coordArr, baseArr } = Codec.parseCoordStr(str);
      return Codec.coordArr_to_int(coordArr, baseArr);
   }

   static int_to_coordStr(rank, baseStr) {
      const baseArr = [...baseStr].map(c => Codec.char_to_int(c) + 1);
      const coordArr = Codec.int_to_coordArr(rank, baseArr);
      return Codec.intArr_to_coordStr(coordArr, baseArr);
   }

   static parseCoordStr(str) {
      const [coordStr, baseStr] = str.split('~');
      if (!coordStr || !baseStr) throw new Error("Invalid format: missing '~'");

      const coordArr = [...coordStr].map(Codec.char_to_int);
      const baseArr = [...baseStr].map(c => Codec.char_to_int(c) + 1); // base = maxDigit + 1

      if (coordArr.length !== baseArr.length) {
         throw new Error("Coordinate and base length mismatch");
      }

      return { coordArr, baseArr };
   }

   static char_to_int(c) {
      const idx = Codec.alphabet.indexOf(c);
      if (idx === -1) throw new Error(`Invalid digit/base character: ${c}`);
      return idx;
   }

   static int_to_char(v) {
      if (v < 0 || v >= Codec.alphabet.length) {
         throw new Error(`Invalid base64 value: ${v}`);
      }
      return Codec.alphabet[v];
   }

   /**
    * Maximum representable value for a baseStr: ∏(radix_i) − 1.
    */
   static max_value(baseStr) {
      return Array.from(baseStr).reduce((acc, c) => {
         const radix = BigInt(Codec.char_to_int(c) + 1);
         return acc * radix + (radix - 1n);
      }, 0n);
   }

   /**
    * Encode a mixed-base string into a BigInt (strict bounds, no saturation).
    *   coord: 'digitStr~baseStr' or 'rank::digitStr~baseStr'
    * Returns a BigInt, or 'rank::code' when prefixed.
    */
   static mixedBase_to_int(coord) {
      let prefix = '';
      if (coord.includes('::')) {
         [prefix, coord] = coord.split('::');
         prefix += '::';
      }
      const [digitStr, baseStr] = coord.split('~');
      // baseStr must be present (there was a '~') and match digit length. The empty
      // case "~" (zero positions) is valid — it decodes to 0n (e.g. an STR with an
      // empty/variable-free template, which a chained layer can legitimately produce).
      if (baseStr === undefined || digitStr.length !== baseStr.length) {
         throw new Error('Invalid format: digitStr and baseStr must be same length');
      }

      let acc = 0n;
      for (let i = 0; i < digitStr.length; i++) {
         const d = BigInt(Codec.char_to_int(digitStr[i]));
         const radix = BigInt(Codec.char_to_int(baseStr[i]) + 1);
         if (d < 0n || d >= radix) {
            throw new Error(`Digit out of bounds at index ${i}: ${d} not in [0..${radix - 1}]`);
         }
         acc = acc * radix + d;
      }

      return prefix ? prefix + acc.toString() : acc;
   }

   /**
    * Coerce a coordinate argument to BigInt with a helpful error. Accepts a
    * BigInt or a decimal string; rejects 'digits~base' strings (which should go
    * through mixedBase_to_int / Ither.mixedToInt first).
    */
   static asCoordInt(coord) {
      try {
         return BigInt(coord);
      } catch {
         throw new Error("decode expects a BigInt coordinate (or decimal string); for a 'digits~base' string use Ither.mixedToInt() first");
      }
   }

   //////////////////////////////////////////////////////////////////////////
   // KLEENE — bounded sequences over an alphabet (rank/unrank/count)
   //////////////////////////////////////////////////////////////////////////
   // Enumerates every sequence of length 0..maxLen over an alphabet of size A,
   // ordered by length then base-A lexicographically. Repetition allowed. This
   // is the primitive behind variable-length structures: L-system production
   // RHSs and the symbol selections that make up a schema (schema space).

   static kleeneCount(A, maxLen) {
      const a = BigInt(A);
      let total = 0n, pow = 1n;
      for (let k = 0; k <= maxLen; k++) { total += pow; pow *= a; }
      return total; // sum_{k=0}^{maxLen} A^k
   }

   // index -> array of alphabet indices (length 0..maxLen). Throws if out of range.
   static kleeneUnrank(index, A, maxLen) {
      const a = BigInt(A);
      let idx = BigInt(index);
      const total = Codec.kleeneCount(A, maxLen);
      if (idx < 0n || idx >= total) throw new RangeError(`Codec.kleeneUnrank: ${idx} is outside [0, ${total})`);

      let pow = 1n; // A^k
      for (let k = 0; k <= maxLen; k++) {
         if (idx < pow) {
            const digits = new Array(k);
            let rem = idx;
            for (let i = k - 1; i >= 0; i--) { digits[i] = Number(rem % a); rem = rem / a; }
            return digits;
         }
         idx -= pow;
         pow *= a;
      }
      return []; // unreachable (range checked above)
   }

   // array of alphabet indices -> index
   static kleeneRank(seqIdx, A, maxLen) {
      const a = BigInt(A);
      const k = seqIdx.length;
      if (k > maxLen) throw new Error(`kleeneRank: length ${k} exceeds maxLen ${maxLen}`);
      let offset = 0n, pow = 1n;
      for (let j = 0; j < k; j++) { offset += pow; pow *= a; } // sum_{j<k} A^j
      let local = 0n;
      for (const d of seqIdx) {
         if (d < 0 || d >= A) throw new Error(`kleeneRank: symbol index ${d} out of [0,${A})`);
         local = local * a + BigInt(d);
      }
      return offset + local;
   }

   //////////////////////////////////////////////////////////////////////////
   // BASE64URL (UTF-8 safe, cross-platform: browser + Node 16+)
   //////////////////////////////////////////////////////////////////////////

   static toBase64url(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
   }

   static fromBase64url(b64) {
      const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
   }

   //////////////////////////////////////////////////////////////////////////
   // MISC HELPERS
   //////////////////////////////////////////////////////////////////////////

   static extractSymbols(expr) {
      return expr
         .replaceAll(/\s/g, '')
         .split(/[\(\),]+/)
         .filter(token => token.length > 0);
   }

   static replaceSymbolsInExpr(expr, symbols) {
      let i = 0;
      return expr.replace(/[A-Za-z_][A-Za-z0-9_\.]*/g, match => {
         if (i >= symbols.length) {
            throw new Error(`Too few symbols — ran out at '${match}'`);
         }
         return symbols[i++];
      });
   }

   static intArrEqual(a, b) {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
         if (a[i] !== b[i]) return false;
      }
      return true;
   }

   static isAstStruct(str) {
      let depth = 0;
      let hasParens = false;
      for (let i = 0; i < str.length; i++) {
         const c = str[i];
         if (c === '(') {
            depth++;
            hasParens = true;
         } else if (c === ')') {
            if (--depth < 0) return false;
         } else if (c === ':' || c === '=') {
            return false;
         }
      }
      return hasParens && depth === 0;
   }

   static isObjStruct(str) {
      const parts = [];
      let depth = 0;
      let start = 0;

      for (let i = 0; i < str.length; i++) {
         const c = str[i];
         if (c === '[') depth++;
         else if (c === ']') depth--;
         else if (c === ',' && depth === 0) {
            parts.push(str.slice(start, i));
            start = i + 1;
         }
      }

      parts.push(str.slice(start));

      let score = 0;
      for (const part of parts) {
         const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.+)$/);
         if (!match) return false;

         const [, , value] = match;
         const isArray = value.startsWith('[') && value.endsWith(']');
         const isSimple = /^-?\d+(\.\d+)?$/.test(value) || /^[A-Za-z0-9_\.\-]+$/.test(value);

         if (isArray || isSimple) {
            score++;
         } else {
            return false;
         }
      }

      return score > 0 && score === parts.length;
   }

   /**
    * Index of `value` within `domain`, trying exact (string) match first, then
    * falling back to type-coerced equality (so "2" matches a "2.0" entry, and a
    * decoded typed value re-encodes cleanly). Returns -1 if not found.
    */
   static domainIndexOf(domain, value) {
      const direct = domain.indexOf(value);
      if (direct !== -1) return direct;
      const cv = Codec.inferTypes(value);
      return domain.findIndex(d => Codec.inferTypes(d) === cv);
   }

   static extractAritiesFromDomains(obj) {
      const result = new Set();
      for (const key in obj) {
         if (!Array.isArray(obj[key]) || obj[key].length === 0) continue;
         const match = key.match(/^o(\d+)$/);
         if (match) {
            result.add(Number(match[1]));
         }
      }
      return result;
   }

   /**
    * Coerce a string (or nested structure) into numbers / booleans / null.
    * Used to give OBJ and ARR layers typed decode output.
    */
   static inferTypes(obj) {
      if (typeof obj === "string") {
         if (/^[+\-]?\d+(\.\d+)?(?:[eE][+\-]?\d+)?$/.test(obj)) {
            return Number(obj);
         }
         if (obj === "true" || obj === "false") {
            return obj === "true";
         }
         if (obj === "null") {
            return null;
         }
         return obj;
      }
      if (Array.isArray(obj)) {
         return obj.map(Codec.inferTypes);
      }
      if (obj && typeof obj === "object") {
         return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, Codec.inferTypes(v)])
         );
      }
      return obj;
   }
}
