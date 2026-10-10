// Ither — formula bank
// The canonical, versioned set of Ither formulas. One accessor for every runtime:
// Node, browsers and Deno all load the JSON as modules, relative to this file.
//
//   import { listFormulas, loadFormula, loadAll } from '@labofbabel/ither/formulas/bank.mjs';
//   const all = await loadAll();                       // [{ name, title, collection, tags, formula }]
//   const f   = await loadFormula('ast-shader-expression');   // the formula object
//
// The bank is data, not engine: nothing here imports ../src. Compile a loaded
// formula with `Ither.from(formula)` from the library when you need a Space.

const readJSON = async rel => {
   const module = await import(new URL(rel, import.meta.url).href, { with: { type: 'json' } });
   // a JSON module is one shared object per runtime; hand each caller its own copy
   return structuredClone(module.default);
};

// The raw registry: { schema, formulas: [{ name, title, collection, file, tags }] }.
export function registry() { return readJSON('./registry.json'); }

// Registry entries (metadata only — no formula bodies). Optionally filter by
// collection and/or tag.
export async function listFormulas({ collection = null, tag = null } = {}) {
   return (await registry()).formulas.filter(e =>
      (collection == null || e.collection === collection) &&
      (tag == null || (e.tags || []).includes(tag)));
}

// The formula object for one entry, by name.
export async function loadFormula(name) {
   const e = (await registry()).formulas.find(f => f.name === name);
   if (!e) throw new Error(`@labofbabel/ither/formulas: no formula named '${name}'`);
   return readJSON(`./${e.file}`);
}

// Every entry with its formula body attached: [{ ...entry, formula }].
export async function loadAll(filter) {
   return Promise.all((await listFormulas(filter)).map(async e => ({ ...e, formula: await readJSON(`./${e.file}`) })));
}
