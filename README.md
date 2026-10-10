# Ither

Ither is a toolkit for combinatorial mapping of structured and text-based data. A
**formula** defines a family of structures and a reversible mapping that gives each
structure an exact numerical coordinate. The compiled **Space** handles individual
encode/decode operations; **queries** explore many coordinates as grids, rays, or lists;
**analysis** inspects spaces and checks live or saved datasets. These are Ither's three
tiers: formula, query, and analysis.

Eight layer types define the structure families: `AST` for expression trees, `OBJ` for
key/value objects, `ARR` for fixed-shape arrays, `STR` for fill-in templates, `LSM` for
L-system grammars, `TRI` for polygon triangulations, `NUM` for quantized real-valued
parameters, and `PERM` for permutations.

Layers are composable: a formula can arrange whole layers together,
expose selected parts as independent dimensions, or chain one layer's decoded output into
another layer's template. This lets a small set of layer types describe compound and
topology-dependent structure families.

A formula's **projection** lays those layers and parts across one or more integer axes:
dimensions can remain separate, several sources can share an axis, or one source can be
split across axes. Its **combine** determines how values sharing an axis are ordered and
therefore what adjacency means, using `box`, `gray`, `morton`, `hilbert`, `scramble`, or
`cantor`. The mapping is deterministic and does not require materializing the space. Ither
uses ES modules, has zero runtime dependencies, and represents coordinates with `BigInt`.

**Manual:** [concepts, workflows, and integration](docs/MANUAL.md) ·
**API:** [exact request and return contracts](docs/API.md) ·
**Changes:** [CHANGELOG.md](CHANGELOG.md)

## Install

```bash
npm install @labofbabel/ither
```

```js
import { Ither } from '@labofbabel/ither';
```

ES modules, no runtime dependencies, no consumer build step; Node ≥ 20.10, modern browsers
and Deno. The same API works in server processes, command-line scripts and browser apps.
Ither does not start a server, read arguments or choose storage; those concerns stay with
the application. For runtimes without a package manager, vendor `dist/ither.min.js` — see
[Manual §5.4](docs/MANUAL.md#54-deno-and-single-file-vendoring).

## Quick start

A space is defined by **one object — a formula**.

```js
import { Ither } from '@labofbabel/ither';

const space = Ither.from({
  layers: { f: { type: 'AST', domains: { x: ['a', 'b', 'c', '0', '1'], o2: ['add', 'mul', 'sub'] } } },
});

space.encode({ f: 'add(mul(a,b),c)' });   // [1337n]
space.decode([1337n]);                    // { f: 'add(mul(a,b),c)' }
space.decode([1338n]);                    // a neighbouring expression
```

A coordinate is an array with one `BigInt` per axis; a structure is an object keyed by
layer name — always, also for one axis or one layer.

## Three tiers

| tier | input | does | output |
|---|---|---|---|
| **1. formula** | a formula object | defines the coordinate ↔ structure mapping, strictly | a `Space` |
| **2. query** | a Space and coordinates (or structures) | decodes (or encodes) them, one record contract for every input | records, a progress report, a final report, and on request a manifest |
| **3. analysis** | a space, a geometry, records (live or saved), a manifest | runs capsules, each on the inputs it declares; one that cannot run says so | an analysis report with provenance |

```txt
formula ──▶ Space ──query──▶ records + manifest ──analysis──▶ report
```

Each tier is useful alone: a Space answers single `encode`/`decode` calls without a query,
and analysis can read records saved months ago — with the manifest saying which formula
and version produced them.

## The core idea

A design space normally has no addresses: you edit structures, but cannot ask what lives
at a particular point. Ither gives it integer axes. That makes it possible to enumerate,
search, sample, page through, and store positions in the space without generating the
whole family first.

For a bounded contiguous axis, `coordinate + 1` means the next structure in the ordering
chosen by the formula. With several axes, a coordinate is an array of those integers.
Projection and combine determine whether adjacency preserves a useful notion of locality,
deliberately destroys it, or uses a sparse range that can contain holes. See
[Manual Chapter 1](docs/MANUAL.md#chapter-1--model-and-workflow) for the model and
[Manual §2.5](docs/MANUAL.md#25-choosing-a-combine) for the ordering choices.

## Concepts

One-line definitions; the full vocabulary is in the
[Manual glossary](docs/MANUAL.md#appendix-a--glossary).

- **formula** — the one object that defines a space: `{ layers, projection?, options? }`.
- **space** — the compiled formula: `Ither.from(formula)`. You encode, decode and query it.
- **coordinate** — one `BigInt` per projection axis; a unique address in the space.
- **structure** — what a coordinate decodes to, keyed by layer name.
- **layer** — the encoder/decoder for one structure family.
- **projection** — how layer coordinates are laid out across the axes.
- **bound** — an axis's exclusive upper limit where the formula fixes one.
- **outside** / **hole** — a coordinate past its axis's range / in range but naming no structure.
- **query** — decoding a grid, a ray or a list of coordinates (or encoding a list of
  structures) as records.
- **manifest** — what a query walked, with which formula and version, and every ordinal
  without a record.

> **Convention:** anything that is an **array** is ordered and the order is meaningful;
> anything that is an **object** is named and its key order is irrelevant.

## Layers

| type | encodes | example layer spec |
|---|---|---|
| `AST` | expression trees (topology + symbols jointly) | `{ type:'AST', domains:{ x:[…], o1:[…], o2:[…] } }` |
| `OBJ` | key/value objects | `{ type:'OBJ', domains:{ k1:[…], k2:[…] } }` |
| `ARR` | fixed-shape arrays | `{ type:'ARR', shape:['a','b'], domains:{ a:[…], b:[…] } }` |
| `STR` | fill-in templates | `{ type:'STR', shape:'(a + b)', domains:{ a:[…], b:[…] } }` |
| `LSM` | L-system grammar spaces | `{ type:'LSM', shape:{ variables, axiom }, domains:{ alphabet:[…] }, options:{ maxLen } }` |
| `TRI` | convex-polygon triangulations (Catalan) | `{ type:'TRI', shape:{ n } }` |
| `NUM` | real-valued axes (quantized) | `{ type:'NUM', domains:{ frq:{ min, max, steps } } }` |
| `PERM` | permutations of `[0,n)` (Lehmer) | `{ type:'PERM', shape:{ n } }` |

Every layer spec uses the same envelope — `{ type, domains?, shape?, from?, options? }`.
Anything a formula does not declare correctly is refused, naming the key and the layer.

## Composition in one example

Name the layers and project them onto axes. A `projection` entry is one axis; a reference
is a layer (`'topo'`) or a part (`'fill.o1'`). Several references on one axis **combine**
(by the formula's one `options.combine`, default `box`); `from` **chains** one layer's
output into another's template.

```js
const space = Ither.from({
  layers: {
    topo: { type: 'AST', domains: { x: ['x'], o1: ['o1'], o2: ['o2'], o3: ['o3'] } },
    fill: { type: 'STR', from: 'topo',          // template = topo's output (chaining)
            domains: { x: ['F','I','1.0'], o1: ['nrm','sin'], o2: ['dot','add'], o3: ['mix'] } },
  },
  projection: [ ['topo'], ['fill.x'], ['fill.o1','fill.o2','fill.o3'] ], // topology / leaves / operators
});

space.decode([7n, 4n, 1n]);
// { topo: 'o2(x,o1(x))', fill: 'dot(I,sin(I))' }

space.recover({ fill: 'dot(I,sin(I))' });
// { topo: 'o2(x,o1(x))', fill: 'dot(I,sin(I))' } — the topology read back from the text
```

For design guidance, see [Manual Chapter 2](docs/MANUAL.md#chapter-2--spaces). The
exact projection and combine contracts are in
[API §1.3](docs/API.md#13-axes-and-ordering--projection-optionscombine).

## Query many points

```js
const { query, manifest } = await Ither({
  space,
  query: {
    decode: { type: 'grid', axes: [{ start: 0n, end: 9n }, { start: 0n, end: 19n }, { start: 0n, end: 19n }] },
    write(record) {
      // { ordinal, coordinate, status: 'structure' | 'hole' | 'error', structure | error }
    },
    progress(report) { /* by time: fraction, records, outside, remainingMs, … */ },
    manifest: true,
  },
});
```

Inputs: `{ type: 'grid', axes }`, `{ type: 'ray', start, direction, count }`,
`{ type: 'list', coordinates }`, or `encode: { type: 'list', structures }`. A point past its
axis's range — a bound, a cap, or the range a chained layer's template gives it — is never
answered with another structure: it is omitted, counted in `outside`, and listed in the
manifest. `offset` and `limit` page in ordinals; `write` returning `false` or an
`AbortSignal` stops cleanly; `nextOffset` resumes exactly. See
[Manual Chapter 3](docs/MANUAL.md#chapter-3--queries) for the workflow and
[API Chapter 2](docs/API.md#chapter-2--tier-2-query-a-space) for the exact contract.

## Analyze a space, a geometry, or live or saved data

```js
const ray = { type: 'ray', start: [0n, 0n, 0n], direction: [1n, 1n, 1n], count: 100n };

const dryRun = await Ither({ space, analysis: { suite: ['geometry-summary'], geometry: ray } });

const live = await Ither({ space, query: { decode: ray }, analysis: { suite: ['query-suite'] } });

const saved = await Ither({
  space,
  analysis: { records, manifest, suite: ['query-suite', 'lib-suite'] },
});
saved.analysis.provenance.mapping;   // 'manifest-matches' — or 'manifest-differs' for data from another version or formula
```

Each capsule declares the inputs it needs (`space`, `geometry`, `records`, `manifest`). One
that cannot run on what a request supplies gives an `inapplicable` result naming why, and
the rest run. Ither owns no storage format; an `analysis.adapt(row, position, context)`
converts stored rows back into records. See
[Manual Chapter 4](docs/MANUAL.md#chapter-4--analyses) and
[API Chapter 3](docs/API.md#chapter-3--tier-3-analyze).

## Formula bank

A versioned set of example formulas lives in [`formulas/`](formulas/), shared by tests
and client projects:

```js
import { listFormulas, loadFormula } from '@labofbabel/ither/formulas/bank.mjs';
const space = Ither.from(await loadFormula('ast-shader-expression'));
```

Bank format and access: [`formulas/README.md`](formulas/README.md).

## Determinism

For a given formula, the coordinate ↔ structure mapping is deterministic and identical on
any engine or OS — a pure function of `(version, canonical formula, structure)`. Golden
coordinates pin it in the tests. The version travels with what it produces — `space.pack()`
and every query manifest record it — so data from another version is detectable, and
analysis reports it instead of refusing it.

## Status

Version `0.3.0`, the first public release. The formula, query and analysis tiers each have
their contract; the API may still change before `1.0`.

## License

[Mozilla Public License 2.0](LICENSE).
