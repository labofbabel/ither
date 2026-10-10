// Ither — recover
//
// The explicit counterpart of "encode takes every layer": from a partial
// structure, recover the structures of the layers that the given chained layers take
// their templates from. A chained STR's text is its template with every variable filled
// in, so the template — which is the source layer's structure (an AST or STR string) —
// can be read back from it. Nothing is guessed:
//   - only a source is recovered from its chained layer, never a chained layer from its
//     source (the source does not determine which values fill the template);
//   - the text is read once, left to right, and no alternative is ever tried:
//       an AST source's text is a tree, `sym(child,…)`, so it is read token by token — the
//       text between '(' ',' ')' is one whole value, and the tree says which symbols it can
//       stand for (a leaf's, or an operator's of that arity); exactly one must match. A value
//       that is a prefix of another is therefore not ambiguous ('0' and '0.5', '&V4' and
//       '&V4.r').
//       Otherwise (a STR source, or a fill value that itself contains '(' ',' ')'), it is read
//       character by character: where one domain value matches it is that variable, where
//       none matches it is template text, and where two match (the same value in two
//       variables, or one value a prefix of another) the recovery is refused there;
//   - the one reading must hold: it re-encodes to the same text, and the source layer
//     encodes it; otherwise the recovery is refused;
//   - an LSM source cannot be read back (its derivation is not its structure), and a
//     domain value '' leaves no trace in the text: both are refused.

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function recover(space, partial) {
   const names = space.layerNames;
   if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new TypeError('Space.recover: expected a partial structure keyed by layer name');
   }
   for (const key of Object.keys(partial)) {
      if (!names.includes(key)) throw new Error(`Space.recover: unknown layer '${key}' (layers: ${names.join(', ')})`);
   }
   const out = {};
   for (const name of names) if (hasOwn(partial, name)) out[name] = partial[name];

   const layers = space.formula.layers;
   let progressed = true;
   while (progressed) {
      progressed = false;
      for (const chainedName of names) {
         const source = layers[chainedName].from;
         if (source == null || !hasOwn(out, chainedName) || hasOwn(out, source)) continue;
         out[source] = readSource(space, source, chainedName, out[chainedName]);
         progressed = true;
      }
   }

   const missing = names.filter(name => !hasOwn(out, name));
   if (missing.length > 0) {
      throw new Error(`Space.recover: layer '${missing[0]}' cannot be recovered — only a layer another given layer is chained from can be read back`);
   }
   return out;
}

function readSource(space, sourceName, chainedName, text) {
   const layers = space.formula.layers;
   const what = `layer '${sourceName}' from layer '${chainedName}'`;
   if (layers[sourceName].type === 'LSM') {
      throw new Error(`Space.recover: cannot recover ${what}: an LSM's derivation does not determine its structure`);
   }
   if (typeof text !== 'string') throw new TypeError(`Space.recover: layer '${chainedName}' must be a string to recover ${what}`);

   const domains = layers[chainedName].domains;
   const values = [];
   for (const [variable, list] of Object.entries(domains)) {
      for (const value of list) {
         const string = String(value);
         if (string === '') throw new Error(`Space.recover: cannot recover ${what}: variable '${variable}' has an empty value, which leaves no trace in the text`);
         values.push({ variable, string });
      }
   }

   const engine = space._engine;
   const chained = engine.layers[space.layerNames.indexOf(chainedName)];
   const sourceIndex = space.layerNames.indexOf(sourceName);
   const sourceLayer = engine.layers[sourceIndex];
   const holds = template => {
      try {
         chained.setTemplate(template);
         if (chained.decode(chained.encode(text)) !== text) return false;
         // a chained source is checked when its own source is recovered
         if (sourceLayer.chainFrom != null) return true;
         return sourceLayer.decode(sourceLayer.encode(template)) === template;
      } catch {
         return false;
      }
   };

   const tokenized = layers[sourceName].type === 'AST' && !values.some(({ string }) => /[(),]/.test(string));
   const template = tokenized ? readTree(what, text, values, layers[sourceName].domains) : readCharacters(what, text, values);
   if (!holds(template)) throw new Error(`Space.recover: cannot recover ${what}: reading '${text}' as '${template}' does not produce it again`);
   return template;
}

// An AST source's text, token by token. Each token is a whole fill value; the AST symbols a
// node may carry (domains.x for a leaf, domains['o' + arity] for an operator) narrow which
// variable it fills, and exactly one must remain.
function readTree(what, text, values, sourceDomains) {
   const refuse = reason => { throw new Error(`Space.recover: cannot recover ${what}: '${text}' ${reason}`); };
   let position = 0;
   const node = () => {
      const start = position;
      while (position < text.length && !'(),'.includes(text[position])) position++;
      const token = text.slice(start, position);
      const children = [];
      if (text[position] === '(') {
         position++;
         for (;;) {
            children.push(node());
            if (text[position] === ',') { position++; continue; }
            if (text[position] === ')') { position++; break; }
            refuse(`is not a tree: expected ',' or ')' at position ${position}`);
         }
      }
      const symbols = children.length === 0 ? sourceDomains.x ?? [] : sourceDomains[`o${children.length}`] ?? [];
      const matches = values.filter(({ variable, string }) => string === token && symbols.includes(variable));
      const kind = children.length === 0 ? 'a leaf' : `an operator of arity ${children.length}`;
      if (matches.length === 0) refuse(`has '${token}' at position ${start}, which is no value of a symbol ${kind} can carry`);
      if (matches.length > 1) {
         const [a, b] = matches;
         refuse(`is ambiguous at position ${start}: '${token}' is a value of both ${a.variable} and ${b.variable}`);
      }
      return children.length === 0 ? matches[0].variable : `${matches[0].variable}(${children.join(',')})`;
   };
   const template = node();
   if (position !== text.length) refuse(`is not a tree: unexpected '${text[position]}' at position ${position}`);
   return template;
}

// Any other text, character by character (see the header).
function readCharacters(what, text, values) {
   let template = '';
   for (let position = 0; position < text.length;) {
      const matches = values.filter(({ string }) => text.startsWith(string, position));
      if (matches.length > 1) {
         const [a, b] = matches;
         throw new Error(`Space.recover: cannot recover ${what}: '${text}' is ambiguous at position ${position}: '${a.string}' (${a.variable}) and '${b.string}' (${b.variable}) both match`);
      }
      if (matches.length === 0) {
         template += text[position];
         position += 1;
      } else {
         template += matches[0].variable;
         position += matches[0].string.length;
      }
   }
   return template;
}
