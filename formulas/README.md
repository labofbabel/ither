# Ither — formula bank

The packaged set of example Ither formulas. A *formula* is the object passed as
`Ither({ space: formula })` (`{ layers, projection?, options? }`); see the Manual's
[formula vocabulary](../docs/MANUAL.md#formula),
[space-design chapter](../docs/MANUAL.md#chapter-2--spaces), and
[API §§1.1–1.3](../docs/API.md#11-formula-object--formula).

Client-authored formulas should live with the client rather than being mixed into this
example set.

## Layout

```
formulas/
  registry.json      index of every formula (the manifest clients read)
  bank.mjs           accessor for every runtime: listFormulas / loadFormula / loadAll
  formula.schema.json  the formula JSON Schema
  v1/                a collection — the curated starter set
  advanced/          a collection — larger examples
    <name>.json      a bare formula object
```

**Collections** group formulas (`v1` is the starter set). Filter by `collection` and
`tags` rather than relying on folder layout.

## registry.json

```jsonc
{
  "schema": 1,
  "formulas": [
    {
      "name": "ast-shader-expression",   // unique id (also the filename stem)
      "title": "AST — shader expression", // human label
      "collection": "v1",                 // which collection it belongs to
      "file": "v1/ast-shader-expression.json", // path relative to formulas/
      "tags": ["ast", "single-layer", "shader", "expression"]
    }
  ]
}
```

Tags are free-form but conventionally include the **layer types** (`ast`, `obj`,
`arr`, `str`, `lsm`, `tri`, `num`, `perm`), a **shape** tag (`single-layer` /
`compound`), and **pattern** tags (`chained`, `split`, `combine`, `projection`,
`identity`, dimensionality like `2d`/`3d`, domain flavour like `shader`/`color`).

## Access

One accessor for Node (≥ 20.10), browsers and Deno. It loads the JSON as modules
relative to itself, so it works wherever `formulas/` is served or installed. Every call
is async and returns a fresh copy:

```js
import { listFormulas, loadFormula, loadAll } from 'ither/formulas/bank.mjs';

await listFormulas();                       // all entries (metadata only)
await listFormulas({ tag: 'ast' });         // filtered
await listFormulas({ collection: 'v1' });
await loadFormula('obj-synth-params');      // the formula object
await loadAll();                            // [{ ...entry, formula }] — entry + body
```

Raw subpaths also resolve through the package (`exports`):
`import reg from 'ither/formulas/registry.json' with { type: 'json' }` or read
`ither/formulas/v1/<name>.json` directly. In a browser, the import map must map
`ither/formulas/` to wherever the folder is served.
