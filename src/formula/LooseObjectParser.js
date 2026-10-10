// ITHER.js — LooseObjectParser
// A small, deterministic recursive-descent parser for loose object/array syntax
// (unquoted keys, bare values, trailing commas), used by Codec.str_to_obj so a
// schema can be packed as a string. Replaces the earlier regex sanitizer.
//
// With coerceBareValues:false (the default Codec uses) every bare value is
// returned as a trimmed string — this keeps domain literals intact (e.g. "1.0"
// stays "1.0" so AST leaf matching works); typing happens later at decode.

export class LooseObjectParser {
   constructor(input, options = {}) {
      this.s = input;
      this.i = 0;
      this.coerceBareValues = options.coerceBareValues ?? true;
      this.allowTopLevelArray = options.allowTopLevelArray ?? true;
   }

   parse() {
      this._skipWs();

      let value;

      if (this._peek() === "{") {
         value = this._parseObject();
      } else if (this._peek() === "[") {
         if (!this.allowTopLevelArray) {
            this._err("Top-level arrays are not allowed.");
         }
         value = this._parseArray();
      } else {
         // Loose top-level object: a:1, b:foo
         value = this._parseLooseTopLevelObject();
      }

      this._skipWs();

      if (!this._eof()) {
         this._err(`Unexpected token '${this._peek()}'.`);
      }

      return value;
   }

   _parseLooseTopLevelObject() {
      const obj = {};

      this._skipWs();

      if (this._eof()) return obj;

      while (!this._eof()) {
         const key = this._parseKey();

         this._skipWs();
         this._expect(":");

         const value = this._parseValue();
         obj[key] = value;

         this._skipWs();

         if (this._eof()) break;

         this._expect(",");

         this._skipWs();

         // tolerate trailing comma
         if (this._eof()) break;
      }

      return obj;
   }

   _parseObject() {
      const obj = {};

      this._expect("{");
      this._skipWs();

      if (this._peek() === "}") {
         this.i++;
         return obj;
      }

      while (!this._eof()) {
         const key = this._parseKey();

         this._skipWs();
         this._expect(":");

         const value = this._parseValue();
         obj[key] = value;

         this._skipWs();

         if (this._peek() === "}") {
            this.i++;
            return obj;
         }

         this._expect(",");
         this._skipWs();

         // tolerate trailing comma
         if (this._peek() === "}") {
            this.i++;
            return obj;
         }
      }

      this._err("Unterminated object. Expected '}'.");
   }

   _parseArray() {
      const arr = [];

      this._expect("[");
      this._skipWs();

      if (this._peek() === "]") {
         this.i++;
         return arr;
      }

      while (!this._eof()) {
         arr.push(this._parseValue());

         this._skipWs();

         if (this._peek() === "]") {
            this.i++;
            return arr;
         }

         this._expect(",");
         this._skipWs();

         // tolerate trailing comma
         if (this._peek() === "]") {
            this.i++;
            return arr;
         }
      }

      this._err("Unterminated array. Expected ']'.");
   }

   _parseValue() {
      this._skipWs();

      const c = this._peek();

      if (c === '"' || c === "'") return this._parseString();
      if (c === "{") return this._parseObject();
      if (c === "[") return this._parseArray();

      return this._parseBareValue();
   }

   _parseKey() {
      this._skipWs();

      const c = this._peek();

      if (c === '"' || c === "'") {
         const key = this._parseString();

         if (typeof key !== "string" || !key.length) {
            this._err("Object key cannot be empty.");
         }

         return key;
      }

      const start = this.i;

      if (!this._isIdentStart(this._peek())) {
         this._err("Expected object key.");
      }

      this.i++;

      while (!this._eof() && this._isIdentPart(this._peek())) {
         this.i++;
      }

      return this.s.slice(start, this.i);
   }

   _parseString() {
      const quote = this._peek();
      this.i++;

      let out = "";

      while (!this._eof()) {
         const c = this.s[this.i++];

         if (c === quote) {
            return out;
         }

         if (c === "\\") {
            if (this._eof()) {
               this._err("Invalid escape at end of string.");
            }

            const e = this.s[this.i++];

            switch (e) {
               case '"': out += '"'; break;
               case "'": out += "'"; break;
               case "\\": out += "\\"; break;
               case "/": out += "/"; break;
               case "b": out += "\b"; break;
               case "f": out += "\f"; break;
               case "n": out += "\n"; break;
               case "r": out += "\r"; break;
               case "t": out += "\t"; break;

               case "u": {
                  const hex = this.s.slice(this.i, this.i + 4);
                  if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                     this._err("Invalid unicode escape.");
                  }
                  out += String.fromCharCode(parseInt(hex, 16));
                  this.i += 4;
                  break;
               }

               default:
                  // Be forgiving for loose strings.
                  out += e;
                  break;
            }

            continue;
         }

         out += c;
      }

      this._err("Unterminated string.");
   }

   _parseBareValue() {
      const start = this.i;
      let depthParen = 0;
      let depthBracket = 0;
      let depthBrace = 0;

      while (!this._eof()) {
         const c = this._peek();

         if (c === '"' || c === "'") {
            // Bare values may contain quoted substrings, e.g. fn("a,b").
            this._consumeStringWithoutReturning();
            continue;
         }

         if (c === "(") depthParen++;
         else if (c === ")") {
            if (depthParen > 0) depthParen--;
         }
         else if (c === "[") depthBracket++;
         else if (c === "]") {
            if (depthBracket === 0 && depthParen === 0 && depthBrace === 0) break;
            if (depthBracket > 0) depthBracket--;
         }
         else if (c === "{") depthBrace++;
         else if (c === "}") {
            if (depthBrace === 0 && depthParen === 0 && depthBracket === 0) break;
            if (depthBrace > 0) depthBrace--;
         }
         else if (c === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
            break;
         }

         this.i++;
      }

      const raw = this.s.slice(start, this.i).trim();

      if (!raw) {
         this._err("Expected value.");
      }

      if (!this.coerceBareValues) {
         return raw;
      }

      if (raw === "true") return true;
      if (raw === "false") return false;
      if (raw === "null") return null;

      if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
         return Number(raw);
      }

      return raw;
   }

   _consumeStringWithoutReturning() {
      const quote = this._peek();
      this.i++;

      while (!this._eof()) {
         const c = this.s[this.i++];

         if (c === "\\") {
            if (!this._eof()) this.i++;
            continue;
         }

         if (c === quote) return;
      }

      this._err("Unterminated string inside bare value.");
   }

   _skipWs() {
      while (!this._eof() && /\s/.test(this._peek())) {
         this.i++;
      }
   }

   _expect(char) {
      this._skipWs();

      if (this._peek() !== char) {
         this._err(`Expected '${char}'.`);
      }

      this.i++;
   }

   _peek() {
      return this.s[this.i];
   }

   _eof() {
      return this.i >= this.s.length;
   }

   _isIdentStart(c) {
      return /[A-Za-z_$]/.test(c || "");
   }

   _isIdentPart(c) {
      return /[A-Za-z0-9_$.-]/.test(c || "");
   }

   _err(message) {
      const pointer = `${this.s}\n${" ".repeat(Math.max(0, this.i))}^`;
      throw new Error(`[LooseObjectParser] ${message} At position ${this.i}.\n${pointer}`);
   }
}
