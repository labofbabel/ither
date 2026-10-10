// ITHER.js — STRLayer
// Fill-in templates: a literal template with variable slots, each drawing from
// its domain. Output is a string by construction, so values are not coerced.
//
// schema: { type:"STR", structure:"(a + b) * c == d", domains:{ a:[1,2,3], ... } }

import { Layer } from './Layer.js';
import { Codec } from './Codec.js';

export class STRLayer extends Layer {
   constructor(schema = {}) {
      super(schema);
      const tpl = this._schema.structure;
      if (tpl && typeof tpl === 'object' && tpl.from != null) {
         // chained: template comes from another layer's result at runtime
         this._chainFrom = tpl.from;
         this._tokens = null;
      } else {
         this._tokens = STRLayer._tokenizeTemplate(tpl, Object.keys(this._schema.domains));
      }
   }

   // index of the layer this STR's template is sourced from (chaining), or null
   get chainFrom() { return this._chainFrom ?? null; }

   // A chained STR's size is a fact about one template, never about the layer, so
   // `cardinality` is null for it. `resolvedCardinality` is the size of the template
   // set last — meaningful only inside the pass that set it.
   get cardinality() { return this._chainFrom != null ? null : super.cardinality; }
   get resolvedCardinality() { return super.cardinality; }

   // per-(variable-)slot views of the resolved template, for {byVar} dim mapping
   slotVars() { return this._tokens.filter(t => t.type === 'var').map(t => t.value); }
   slotBases() { return this._tokens.filter(t => t.type === 'var').map(t => this._schema.domains[t.value].length); }

   // resolve the template at runtime (used by the orchestrator for chained layers)
   setTemplate(str) {
      if (typeof str !== 'string') throw new TypeError('STRLayer.setTemplate: expected a string template');
      this._schema.structure = str;
      this._tokens = STRLayer._tokenizeTemplate(str, Object.keys(this._schema.domains));
   }

   /**
    * Turn template + var list into an ordered list of
    *   { type:"literal", value:"(...)" } or { type:"var", value:"a" }
    */
   static _tokenizeTemplate(template, vars) {
      // longer names first so they match before their prefixes; code-unit
      // tiebreak keeps tokenization deterministic regardless of domain key order
      vars = [...vars].sort((a, b) => (b.length - a.length) || (a < b ? -1 : a > b ? 1 : 0));
      const tokens = [];
      let pos = 0;
      while (pos < template.length) {
         let matchedVar = null;
         for (let v of vars) {
            if (template.startsWith(v, pos)) {
               matchedVar = v;
               break;
            }
         }
         if (matchedVar) {
            tokens.push({ type: "var", value: matchedVar });
            pos += matchedVar.length;
         } else {
            let nextPos = template.length;
            for (let v of vars) {
               const idx = template.indexOf(v, pos);
               if (idx >= 0 && idx < nextPos) nextPos = idx;
            }
            const lit = template.slice(pos, nextPos);
            tokens.push({ type: "literal", value: lit });
            pos = nextPos;
         }
      }
      return tokens;
   }

   encode(expr = this._struct) {
      if (this._tokens === null) throw new Error("STRLayer: chained template not resolved (set it via the orchestrator)");
      if (typeof expr !== "string") {
         throw new TypeError("STRLayer.encode: no structure provided (expected a string)");
      }
      this._struct = expr;

      const domains = this._schema.domains;
      const tokens = this._tokens;
      const coords = [];

      let cursor = 0;
      for (let i = 0; i < tokens.length; i++) {
         const tk = tokens[i];
         if (tk.type === "literal") {
            const lit = tk.value;
            if (expr.slice(cursor, cursor + lit.length) !== lit) {
               throw new Error(`Expected literal "${lit}" at position ${cursor}`);
            }
            cursor += lit.length;
         } else {
            // variable: match a domain value at the cursor, longest first. Matching
            // the domain directly (rather than consuming everything up to the next
            // literal) lets ADJACENT variable slots split unambiguously — e.g. a
            // chained L-system derivation "FF" with F:["Fa","Fb"] re-parses as two
            // slots, not one. Following literals are validated by their own tokens.
            const dom = domains[tk.value].map(String);
            const order = dom.map((v, vi) => [v, vi]).sort((a, b) => b[0].length - a[0].length);
            let vidx = -1;
            for (const [v, vi] of order) {
               if (v.length > 0 && expr.startsWith(v, cursor)) { vidx = vi; cursor += v.length; break; }
            }
            if (vidx < 0) {
               throw new Error(`No value of "${tk.value}" matches at position ${cursor} in "${expr}"`);
            }
            coords.push(vidx);
         }
      }

      const baseArr = tokens
         .filter(t => t.type === "var")
         .map(t => this._schema.domains[t.value].length);

      const mixed = Codec.intArr_to_coordStr(coords, baseArr);
      this._coord = Codec.mixedBase_to_int(mixed);
      return this._coord;
   }

   decode(coord = this._coord) {
      if (this._tokens === null) throw new Error("STRLayer: chained template not resolved (set it via the orchestrator)");
      if (coord === null || coord === undefined || coord === '') {
         throw new Error("STRLayer.decode: no coordinate provided");
      }
      const n = Codec.asCoordInt(coord);
      this._coord = n;

      const b = this.base;
      const [coordPart] = (Codec.int_to_mixedBase(n, b) + "~" + b).split("~");
      const idxs = Codec.coordStr_to_intArr(coordPart);

      const vars = this._tokens.filter(t => t.type === "var").map(t => t.value);
      const domains = vars.map(v => this._schema.domains[v]);

      if (idxs.length !== domains.length) {
         throw new Error("Coord length mismatch");
      }

      let result = "";
      let vidx = 0;
      for (let tk of this._tokens) {
         if (tk.type === "literal") {
            result += tk.value;
         } else {
            const val = domains[vidx][idxs[vidx]];
            result += String(val);
            vidx++;
         }
      }

      this._struct = result;
      return result;
   }

   get base() {
      // Derive the radix string from the SAME tokenized slots encode/decode use, not
      // a separate /\w+/ regex over the template. The regex disagreed whenever a
      // domain key appears as a substring of template text (e.g. key "F" inside the
      // word "FFF", which a chained L-system derivation produces): it saw 0 slots
      // where the tokenizer sees 3, giving a wrong cardinality and "Coord length
      // mismatch" on decode. `_tokens` is null only for an unresolved chained template.
      if (!this._tokens) return null;
      const domains = this._schema.domains;
      let baseStr = '';
      for (const t of this._tokens) {
         if (t.type === 'var') baseStr += Codec.int_to_char(domains[t.value].length - 1);
      }
      return baseStr;
   }
}
