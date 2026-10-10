# Ither — Manual

**The guidebook: the vocabulary, workflow, integration patterns, and practices.** Where
[API.md](API.md) is the exact reference and [README.md](../README.md) is the core idea and
quick start, this manual explains how the pieces fit together and how to use Ither well.

Everything written here describes version `0.3.0`. The manual follows the library's
working sequence: define a Space, query it, then analyse the results. It documents the
current library rather than using empty chapters to stand in for possible future material.

## Contents

- [Chapter 1 — Model and workflow](#chapter-1--model-and-workflow) — **written**
  - [1.1 The core loop](#11-the-core-loop)
  - [1.2 Coordinates and adjacency](#12-coordinates-and-adjacency)
  - [1.3 The three tiers](#13-the-three-tiers)
  - [1.4 The request model](#14-the-request-model)
  - [1.5 Supporting machinery](#15-supporting-machinery)
- [Chapter 2 — Spaces](#chapter-2--spaces) — **written**
  - [2.1 Compiling and using a Space](#21-compiling-and-using-a-space)
  - [2.2 Layer families](#22-layer-families)
  - [2.3 Domains, shapes, and ordering](#23-domains-shapes-and-ordering)
  - [2.4 Projection and composition](#24-projection-and-composition)
  - [2.5 Choosing a combine](#25-choosing-a-combine)
  - [2.6 Chaining and recovery](#26-chaining-and-recovery)
  - [2.7 Bounds, holes, and cardinality](#27-bounds-holes-and-cardinality)
  - [2.8 Formula spaces, nesting, and the tower](#28-formula-spaces-nesting-and-the-tower)
  - [2.9 Storing a Space](#29-storing-a-space)
- [Chapter 3 — Queries](#chapter-3--queries) — **written**
  - [3.1 The request](#31-the-request)
  - [3.2 Query inputs](#32-query-inputs)
  - [3.3 Records, holes, and the one bounds rule](#33-records-holes-and-the-one-bounds-rule)
  - [3.4 Paging, stopping, and resuming](#34-paging-stopping-and-resuming)
  - [3.5 Progress and the report](#35-progress-and-the-report)
  - [3.6 Keeping a dataset: the manifest](#36-keeping-a-dataset-the-manifest)
  - [3.7 Callback and concurrency rules](#37-callback-and-concurrency-rules)
- [Chapter 4 — Analyses](#chapter-4--analyses) — **written**
  - [4.1 Inputs and results](#41-inputs-and-results)
  - [4.2 Inspecting a space](#42-inspecting-a-space)
  - [4.3 A dry run: space and geometry](#43-a-dry-run-space-and-geometry)
  - [4.4 Live and saved records](#44-live-and-saved-records)
  - [4.5 Provenance and drift](#45-provenance-and-drift)
  - [4.6 Record capsules](#46-record-capsules)
  - [4.7 The report and suite composition](#47-the-report-and-suite-composition)
  - [4.8 Custom capsules](#48-custom-capsules)
- [Chapter 5 — Integration](#chapter-5--integration) — **written**
  - [5.1 Node applications, servers, and command-line scripts](#51-node-applications-servers-and-command-line-scripts)
  - [5.2 Formula bank subpaths](#52-formula-bank-subpaths)
  - [5.3 Browser applications](#53-browser-applications)
  - [5.4 Deno and single-file vendoring](#54-deno-and-single-file-vendoring)
  - [5.5 Package entry points](#55-package-entry-points)
- [Chapter 6 — Practices](#chapter-6--practices) — **written**
  - [6.1 Failure model](#61-failure-model)
  - [6.2 Working practices](#62-working-practices)
- [Appendix A — Glossary](#appendix-a--glossary) — **written**
  - [A.1 Terms A–Z](#a1-terms-az)

**Written** means the chapter covers its stated scope for `0.3.0`. It does not mean the
wording is final; the manual is still being edited for the first public release.

---

# Chapter 1 — Model and workflow

The ideas that organize the library. Canonical terminology is collected in
[Appendix A](#appendix-a--glossary).


## 1.1 The core loop

Ither gives a structured design space an integer coordinate system. The central terms fit
together in this order:

> A **formula** compiles into a **space**. Every valid **structure** has one exact
> **coordinate** (a `BigInt` address per axis), and every coordinate decodes to a
> structure, a hole, or outside. A formula's **layers** define the families of structure; its
> **projection** decides how their coordinates are laid out across the **axes**.

```txt
formula ──compile──▶ space ──decode──▶ structure
                       ▲                   │
                       └──────encode───────┘
        coordinate  ⇄  structure        (reversible wherever the coordinate names one)
```

Everything else is a refinement of, or a tool around, that loop.

## 1.2 Coordinates and adjacency

Ither addresses structures instead of materializing a collection of them. A coordinate is
an address, and moving by `+1` means “the next structure under this space's ordering”,
not “a semantically similar structure.”

That ordering comes from three decisions: the order of values inside each domain, the
projection of layer coordinates onto output axes, and the combine used when several
coordinates share an axis. Multiple axes make those movements independent where the
formula permits it. Dependent, capped, and sparse axes need more care; their range is
covered in [§2.7](#27-bounds-holes-and-cardinality).


## 1.3 The three tiers

Ither's responsibilities are divided into three tiers. They form a workflow, and each is
useful on its own.

### Tier 1 — spaces

**Input:** a [formula](#formula). **Output:** a compiled [space](#space).

This tier owns layers, projection, combine, cardinality and the coordinate ↔ structure
mapping. It answers what a coordinate means — for one point at a time
([decode / encode](#decode--encode), [recover](#recover)). A formula is the complete,
strict definition of its space: anything it does not declare correctly is
[refused](#refusal), never ignored or replaced.

### Tier 2 — query

**Input:** a space and a [geometry](#geometry) (or a list of structures).
**Output:** [records](#record), a [progress report](#report) while it runs, a final
[report](#report), and on request a [manifest](#manifest).

A query batches the single operation: a grid, a ray and a list are each a series of
exactly `space.decode` (an encode list, of `space.encode`), under one record contract. It
reports position and progress exactly, pages and resumes by [ordinal](#ordinal), and
names every [omission](#omission). It does not interpret what it produced.

### Tier 3 — analysis

**Input:** whatever a request supplies — a space, a [geometry](#geometry), [records](#record)
(live from a query, or saved) and a [manifest](#manifest). **Output:** an analysis report
with one result per [capsule](#capsule) and [provenance](#provenance).

Analysis is a container with one contract and a set of capsules. Each capsule declares the
inputs it needs; given them, it gives a verdict (`pass`, `warn`, `fail`); without them it is
[inapplicable](#inapplicable) and says why, and the other capsules still run. Only a malformed
request is [refused](#refusal). Records may arrive live from a query or from storage months
later; storage is the client's, and an adapter converts rows back into records. A manifest
stored with the records lets analysis check that the set is complete and detect that it was
produced by another version or formula.

```txt
formula ──compile──▶ space ──query──▶ records + manifest ──analyse──▶ report
        tier 1                tier 2                      tier 3
```

## 1.4 The request model

`Ither.from(formula)` compiles one [space](#space). The callable workflow accepts a space,
a query, an analysis, or the meaningful combinations of those three:

The exact signatures and return contracts are organized by tier in
[API Chapters 1–3](API.md#chapter-1--tier-1-define-a-space).

```js
import { Ither } from 'ither';

const space = Ither.from(formula);                 // tier 1: a formula becomes a Space

space.decode([3n, 4n]);                            // one point, directly
space.encode(structure);

const { query, manifest } = await Ither({          // tier 2: many points
  space,
  query: { decode: { type: 'grid', axes }, write: record => save(record), manifest: true },
});

const { analysis } = await Ither({                 // tier 3: inspect saved records
  space,
  analysis: { records: savedRecords, manifest, suite: ['query-suite'] },
});
```

`S`, `Q`, and `A` below mean that the request has a `space`, `query`, or `analysis` key:

| S | Q | A | valid | requirements | result |
|:-:|:-:|:-:|---|---|---|
| 0 | 0 | 0 | no | a request must do something | — |
| 1 | 0 | 0 | yes | `space` is a formula or a `Space` | `{ space }` |
| 0 | 1 | 0 | no | a query needs a space | — |
| 0 | 0 | 1 | yes | `analysis.suite`; records from `analysis.records`, if any | `{ analysis }` |
| 1 | 1 | 0 | yes | `query.write` | `{ space, query }` (+ `manifest` if asked) |
| 1 | 0 | 1 | yes | `analysis.suite`; `analysis.geometry`, `analysis.records`, `analysis.manifest` as needed | `{ space, analysis }` |
| 0 | 1 | 1 | no | a query needs a space | — |
| 1 | 1 | 1 | yes | `analysis.suite`; no `analysis.records`, `.manifest`, or `.geometry` because the query supplies them; `write` optional | `{ space, query, analysis }` (+ `manifest` if asked) |

Unknown keys are refused at every level. The result is frozen and has keys in the order
`space`, `query`, `manifest`, `analysis`. It is data, never a handle to continue with.

## 1.5 Supporting machinery

- **Capabilities** — `capabilities()` and `formulaSchema()` expose the public contract as
  data. See [API Appendix A](API.md#appendix-a--introspection-and-version).
- **Codec** — auxiliary stateless conversions. Its current public surface is indexed in
  [API Appendix C](API.md#appendix-c--codec-utility-surface-stub).
- **rank / unrank** — the mathematics-paper names for [encode / decode](#decode--encode).

---

# Chapter 2 — Spaces

A user designs a **space**. The formula is its declarative definition: layers say which
structures exist, and projection and composition say how their coordinates are arranged.
Because layers are composable, a small set of structure families can describe much richer
spaces without introducing a new layer type for every application.


## 2.1 Compiling and using a Space

The exact formula, compilation, inspection, encode, and decode contracts are in
[API Chapter 1](API.md#chapter-1--tier-1-define-a-space). The important working rule is
that a Space is an immutable compiled value: to change the mapping, compile another one.

```js
const formula = {
  layers: {
    point: {
      type: 'NUM',
      domains: {
        x: { min: 0, max: 1, steps: 101 },
        y: { min: 0, max: 1, steps: 101 },
      },
    },
  },
  projection: [['point.x'], ['point.y']],
};

const space = Ither.from(formula);
const again = await Ither({ space });              // again.space === space
```

`space.formula` is the canonical copy, deeply frozen, with every default written in. To
change a space, compile another; keeping several is normal.

```js
space.decode([3n, 4n]);                            // { point: { x: 0.03, y: 0.04 } }
space.encode({ point: { x: 0.03, y: 0.04 } });    // [3n, 4n]
space.decode([101n, 0n]);                          // Ither.OUTSIDE
```

A coordinate is always an array, and a structure is always keyed by layer name—even for
one axis or one layer. Check `Ither.HOLE` and `Ither.OUTSIDE` with `===`.

## 2.2 Layer families

Choose a layer for the structure it must encode, not for the application that will consume
it. The eight built-ins cover these families:

| layer | use it for | decoded value |
|---|---|---|
| `AST` | bounded expression-tree topologies and symbols | expression string |
| `OBJ` | named, fixed sets of choices | object |
| `ARR` | positional, fixed sets of choices | array |
| `STR` | fixed templates with replaceable fields | string |
| `LSM` | bounded L-system production rules | production object |
| `TRI` | triangulations of a convex polygon | triangle list |
| `NUM` | quantized real-valued parameters | numeric object |
| `PERM` | orderings of `[0,n)` | permutation array |

`OBJ`, `ARR`, `STR`, and `NUM` are fixed-shape layers. Their positions can be
exposed as separate semantic facets in a projection. `AST`, `LSM`, `TRI`, and
`PERM` are recurrence-ranked: each produces one opaque layer coordinate and cannot be
parted. The exact accepted fields for every family are in
[API §1.2](API.md#12-layer-specs--ast-obj-arr-str-lsm-tri-num-perm).


## 2.3 Domains, shapes, and ordering

A domain is an ordered set of choices. Its order is part of the mapping: changing
`['add', 'mul']` to `['mul', 'add']` preserves membership but changes coordinates and
adjacency. For `NUM`, the range descriptor creates the ordered quantized choices.

A shape describes where those choices appear: object keys, array positions, or variables
in a string template. The recurrence-ranked families instead derive their coordinates
through their own counting rules and limits. In a chained `STR`, `from` replaces a fixed
template with the decoded string of an earlier layer.

Layer names compose into one structure. This is the central architectural leverage:
topology can live in one layer, labels in another, numeric parameters in a third, and their
coordinate relationships remain explicit rather than being buried in one custom encoder.


## 2.4 Projection and composition

Projection turns layer coordinates into the Space's output axes. If it is omitted, every
layer receives one axis. An explicit projection can:

- place a whole layer on an axis;
- place several whole layers or parts on one axis, using the Space's combine;
- expose the positions of a fixed-shape layer as semantic parts;
- split one layer coordinate across several numeric axes.

Parting and splitting are different. A part names a meaningful facet such as `cfg.rate`
or `fill.op`; a split divides a numeric coordinate and does not reveal semantic fields.
Every layer or part must be assigned exactly once. The syntax and applicability rules are
in [API §1.3](API.md#13-axes-and-ordering--projection-optionscombine).


## 2.5 Choosing a combine

A combine answers one precise question: **when two or more source coordinates must share
one output axis, in what order should that product space be walked?** It changes ordering
and adjacency, not membership. The same structures exist under every applicable combine,
and `encode` / `decode` remain inverse; only their coordinates change.

The option belongs to the **formula**, beside `layers` and `projection`:

```js
const space = Ither.from({
  layers: {
    a: { type: 'OBJ', domains: { a: ['a0', 'a1', 'a2'] } },
    b: { type: 'OBJ', domains: { b: ['b0', 'b1', 'b2', 'b3'] } },
  },
  projection: [['a', 'b']],
  options: { combine: 'gray' },
});
```

`options.combine` is optional; its default is `box`. It is one global declaration for
the space, not a layer option and not an option on a projection entry. Exact applicability
requirements are in [API §1.3](API.md#13-axes-and-ordering--projection-optionscombine).

### Where the combine is exercised

Declaring a combine does not reorder every layer indiscriminately. It is used wherever
the engine must fold several coordinates into one:

1. several whole layers or parts share one projection axis, as in `['a', 'b']`;
2. one axis carries a group of positions from a parted OBJ, ARR, STR or NUM layer;
3. a chained STR part, such as `fill.x`, occurs several times in the source template;
4. one layer is split across several axes.

A whole layer alone on an axis is already one coordinate, so there is nothing to combine.
In particular, putting an AST alone on an axis does **not** make `gray` reorder the AST's
recurrence ranking. Its own domain order and `options.ranking` control the ordering inside
that layer.

For a chained topology/fill formula such as:

```js
projection: [
  ['topo'],
  ['fill.o1', 'fill.o2', 'fill.o3'],
  ['fill.x'],
],
options: { combine: 'gray' },
```

axis 0 keeps the AST ordering. Axes 1 and 2 use Gray ordering to fold the operator and
leaf slots present in the topology selected on axis 0. Their bounds are therefore
dependent. If a topology has one `o2`, one `o1` and two leaves, with domain sizes 14, 12
and 8, its bounds are `14 * 12 = 168` and `8 * 8 = 64` for those two axes.

### The built-in families

The six families and their exact requirements are listed in
[API §1.3](API.md#13-axes-and-ordering--projection-optionscombine). For selection, their
useful distinctions are: `box` preserves mixed-radix blocks; `gray` makes local one-slot
steps; `scramble` deliberately destroys locality; `morton` and `hilbert` provide spatial
orders for compatible power-of-two products; and `cantor` handles sparse or unbounded
pairing. Every fold in a formula must support its one global combine.

### `box` and `gray`, visibly

With the two-layer 3-by-4 example above, the first coordinates decode as follows:

| coordinate | `box` | `gray` |
|---:|---|---|
| 0 | `a0, b0` | `a0, b0` |
| 1 | `a0, b1` | `a0, b1` |
| 2 | `a0, b2` | `a0, b2` |
| 3 | `a0, b3` | `a0, b3` |
| 4 | `a1, b0` | `a1, b3` |
| 5 | `a1, b1` | `a1, b2` |
| 6 | `a1, b2` | `a1, b1` |
| 7 | `a1, b3` | `a1, b0` |
| 8 | `a2, b0` | `a2, b0` |

At the `box` carry from 3 to 4, both values change. Gray reverses the second row, so every
step changes exactly one source by one domain position. This makes `gray` a strong choice
when the property being optimized is specifically the size of each consecutive genotype
step.

That guarantee is deliberately narrow. It is about the folded **source coordinates**,
not semantic or rendered distance. Reordering a domain changes which values are adjacent,
an AST crossing to its next topology follows the AST ranking, and a renderer may amplify
a one-step genotype edit into a large phenotype change.

“Locality” and “clustering” therefore need an explicit metric. A metric over source
coordinates does not automatically measure semantic or rendered behaviour, mixed
operator arities, or a chained space whose slot layout changes with a topology axis.

`box` also preserves useful structure that the one-step metric ignores: every prefix of
the ordered source tuple owns one contiguous interval, and every such interval has the
same forward orientation. Gray preserves the interval hierarchy but reflects alternating
sub-intervals. Box can therefore cluster better when earlier slots are deliberately more
significant, when a behavioural class follows those prefixes, or when repeated slices
should line up in the same orientation. In a chained STR, Gray's reflections also depend
on the exact slot sequence of the selected topology; that guarantee holds within one
resolved tuple, not across different topologies.

### A practical selection rule

- Use `gray` when your target metric rewards every consecutive coordinate changing one
  slot by one domain position.
- Use `box` when meaningful choices occupy earlier positions, when aligned hierarchical
  blocks matter, or when measured semantic / rendered behaviour clusters better under it.
- Use `scramble` to test whether an observed result depends on locality.
- Use `morton` or `hilbert` only when their exact cardinality constraints describe the
  fold you actually have; they are not automatic upgrades over `gray`.
- Use `cantor` only when a split or unbounded source requires it, and plan queries without
  relying on a contiguous bound.

Domain order remains the other major locality lever. A Gray step moves by one *domain
index*, so put values that should be neighbours next to one another in each domain.

### Inspecting and testing a choice

Compile first: applicability errors are formula errors, not query-time surprises.
Then inspect the actual space rather than assuming the declaration was exercised:

```js
const { analysis } = await Ither({
  space,
  analysis: { suite: ['space-axes'] },
});

analysis.results[0].metrics.axes;
// per axis: bound, boundReason, dependsOn, combine, sources

space.axisBounds();                 // fixed bounds, null for capped/sparse/dependent
space.axisBounds([7n, 0n, 0n]);     // resolve dependent bounds at a coordinate
```

For a small formula, enumerate a short run under `box` and `gray` and compare consecutive
decoded structures. Test the laws independently of locality:

```js
for (let i = 0n; i < 12n; i++) {
  const structure = space.decode([i]);
  if (structure !== Ither.HOLE && structure !== Ither.OUTSIDE) {
    console.assert(space.encode(structure)[0] === i);
  }
}
```

For query-produced records, the built-in `mapping-roundtrip` capsule performs the same
mapping check. `capabilities().combinators` is the machine-readable list of registered
families, their default, locality description and applicability requirement.

## 2.6 Chaining and recovery

Chaining lets the decoded string of an earlier `AST`, `STR`, or `LSM` layer become
the template of a downstream `STR` layer. The common pattern separates topology from
labelling: one axis chooses an expression shape while other axes choose the symbols that
fill the positions present in that shape.

Because the downstream positions depend on the selected source, its axes are dependent.
A chained layer cannot share an axis with another source. This is still one Space and one
bijection; the dependency changes how bounds are resolved, not the coordinate contract.

### Recovering a partial structure

When a space chains a template layer from a source layer, the source can sometimes be read
back from the template's text:

```js
const space = Ither.from({
  layers: {
    topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
    expr: { type: 'STR', from: 'topo', domains: { x: ['p', 'q'], o2: ['add', 'mul'] } },
  },
});

const complete = space.recover({ expr: 'add(p,mul(q,p))' });
// { topo: 'o2(x,o2(x,x))', expr: 'add(p,mul(q,p))' }

space.encode(complete);
```

`recover` refuses whenever the text does not determine exactly one source structure: an
ambiguous token, an LSM source, an empty domain value, or a missing downstream layer. It
never picks among readings, and `encode` itself never deduces anything. The exact refusal
rules are in [API §1.8](API.md#18-complete-a-partial-structure--spacerecover).


## 2.7 Bounds, holes, and cardinality

`space.cardinality` is the number of structures only when the complete Space has a fixed,
finite count; otherwise it is `null`. `space.axisBounds()` returns exclusive `BigInt`
bounds for fixed axes and `null` for capped, sparse, or dependent axes. Supplying a
coordinate lets `axisBounds(coordinate)` resolve bounds that depend on an earlier axis.

`null` does not mean “infinite,” and it does not prevent finite queries. It means the
range cannot be expressed as one context-free contiguous bound:

- an `AST` or `LSM` axis is capped by `maxNodes` or `maxLen`;
- a Cantor-combined or split axis is sparse;
- a chained axis depends on the source decoded at the same coordinate.

A coordinate beyond its resolved range is **outside**. A sparse coordinate inside the
walkable range that names no structure is a **hole**. Direct decode returns
`Ither.OUTSIDE` or `Ither.HOLE`; queries omit outside points and record holes under the
default policy. Exact inspection calls are in
[API §§1.5–1.8](API.md#15-inspect-a-space--properties-axisbounds-axisdependencies).


## 2.8 Formula spaces, nesting, and the tower

Because a formula is data, a bounded `STR` layer can describe a space of formula-shaped
JSON strings. Decode one structure from that meta-space, parse its formula, and compile a
second Space. This **formula space** is a current two-stage application pattern; it does
not make a Space itself a native layer.

That distinction gives the tower precise current boundaries:

1. a **structure space** is the normal compiled Space;
2. a **formula space** is a bounded meta-space whose decoded structures can be compiled
   into Spaces;
3. a **configuration space** would address a complete stack and projection, but remains a
   conceptual level.

Native Space-as-layer nesting is not part of the `0.3.0` formula contract. Keeping that
limit explicit prevents the conceptual model from being mistaken for an available call.


## 2.9 Storing a Space

```js
const packed = space.pack();                       // base64url of { formula, v }
const restored = Space.unpack(packed);             // any version is accepted
restored.packedBy;                                 // the version that packed it
```

`packedBy` is `null` for a space compiled directly from a formula. Packing stores the
definition of a space; it is not a coordinate or a dataset. See
[API §1.9](API.md#19-store-and-restore-a-space--spacepack-spaceunpack) for the payload
contract and failure cases.

# Chapter 3 — Queries

Single points are the Space operations in [§2.1](#21-compiling-and-using-a-space). A query walks
many points—decoding a grid, ray, or list of coordinates, or encoding a list of
structures—under one record and reporting contract.

## 3.1 The request

The exact request keys and result envelope are in
[API §2.2](API.md#22-run-a-query--ither-space-query-). A typical query is:

```js
const { query } = await Ither({
  space,
  query: {
    decode: {
      type: 'grid',
      axes: [
        { start: 10n, end: 20n, step: 2n },
        { start: 0n, end: 4n },
      ],
    },
    write(record) { save(record); },
  },
});
```

## 3.2 Query inputs

Use a **grid** for a rectangular region, a **ray** for a directional walk, and a **list**
for coordinates selected elsewhere. Encoding is deliberately list-based: the application
already owns the structures and their order. A list containing one item is the single
operation expressed through the query record/report pipeline. Exact geometry shapes are
in [API §2.1](API.md#21-choose-an-input--grid-ray-coordinate-list-structure-list).

## 3.3 Records, holes, and the one bounds rule

Branch on `record.status`, not the truthiness of a layer value: `0`, `''`, and `false` can
all be legitimate structures. Decode and encode record shapes are in
[API §2.3](API.md#23-consume-records--querywrite).

A point past the range its axes have there—a fixed bound, an AST/LSM cap, the range a
chained layer's template gives, or a negative value—produces **no record**. It is counted
in `report.outside`, and its ordinal is a gap in the records. A grid over a chained space
skips whole runs arithmetically, so a wide box around a narrow template costs nothing per
skipped point:

```js
const { query } = await Ither({
  space,
  query: {
    decode: {
      type: 'grid',
      axes: [
        { start: 7n, end: 7n },
        { start: 0n, end: 19n },
        { start: 0n, end: 19n },
        { start: 0n, end: 19n },
      ],
    },
    write,
  },
});

// query.count 8000n · query.records 1344n · query.outside 6656n
```

A hole is different: it is inside the range and names no structure, so it is a record
under the default policy.

## 3.4 Paging, stopping, and resuming

`offset`, `limit`, `count`, and `nextOffset` all count ordinals. A page is
`[offset, min(offset + limit, count))`. It delivers at most `limit` records—fewer where
points are omitted. See [API §2.4](API.md#24-page-monitor-and-stop--offset-limit-progress-signal)
for the exact paging and stopping contract.

```js
for (let offset = 0n; ; offset += 10_000n) {
  const { query } = await Ither({
    space,
    query: { decode, offset, limit: 10_000n, write: save },
  });
  if (query.stop === 'end') break;
}
```

To stop after a number of records, return `false` from `write`. To stop from outside—a
timeout, Ctrl+C, or a button—abort a signal. The query yields periodically between points,
including while it delivers nothing, so the abort is seen promptly:

```js
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());

const { query } = await Ither({
  space,
  query: { decode, signal: controller.signal, write: save },
});

if (query.stop === 'signal') {
  console.error(`stopped — resume with offset ${query.nextOffset}`);
}
```

Either way the Promise resolves normally, and `nextOffset` resumes exactly.

## 3.5 Progress and the report

```js
await Ither({
  space,
  query: {
    decode,
    write: save,
    progress(report) {
      bar.update(report.fraction);
      if (report.remainingMs != null) eta.set(report.remainingMs);
    },
  },
});
```

`progress` fires once per time slice and once at the end with the final report—the same
object returned as `result.query`. Its exact fields are in
[API §2.5](API.md#25-read-the-result--queryreport).

`total` is known before walking when no axis depends on another. A chained space reports
`null`, and so does `remainingMs`: no estimate is presented as a fact.

## 3.6 Keeping a dataset: the manifest

A report is enough for a live experiment. A dataset you keep needs a manifest:

```js
const { query, manifest } = await Ither({
  space,
  query: { decode, write: save, manifest: true },
});
store(manifest);
```

It names everything needed to repeat the query and every ordinal without a record, so the
records plus `omitted` cover `[offset, nextOffset)` exactly. The manifest shape and repeat
recipe are in [API §2.6](API.md#26-save-the-walk--querymanifest).

## 3.7 Callback and concurrency rules

The callback contract is in [API §§2.3–2.4](API.md#23-consume-records--querywrite). Its
practical consequences are:

- `write` and `progress` are synchronous. Returning a Promise rejects the query: buffer
  inside the callback if storage is asynchronous.
- If either callback throws, the Promise rejects and no report is returned. Persist each
  record before returning if recovery matters, and checkpoint `nextOffset` from `progress`.
- Several queries may share one Space concurrently. A point completes in one pass; queries
  interleave only between points.

# Chapter 4 — Analyses

Analysis is a container with one contract and a set of **capsules**. A request supplies
inputs; each capsule declares the inputs it needs and gives exactly one result.

`suite` is required: nothing runs by default. Leave `analysis` out entirely when a query
only saves data. The exact request contract is in
[API §3.2](API.md#32-run-analysis--ither-analysis-).

## 4.1 Inputs and results

The four possible inputs are a space, a geometry, records, and a manifest. Each has one
source: supplied directly, inherited from a saved manifest, or produced by the live query
in the same request. The source rules and result statuses are listed in
[API §§3.1 and 3.5](API.md#31-choose-analysis-inputs--space-geometry-live-or-saved-records).

A request is rejected only when it is malformed. The same suite can therefore run on a
space, geometry, live query, or saved dataset: whatever cannot run says so, and the rest
runs.

## 4.2 Inspecting a space

```js
const { analysis } = await Ither({
  space,
  analysis: { suite: ['space-suite'] },
});
```

The space suite answers four different questions: what the space is, how its axes are
routed, what its layers contribute, and whether it contains empty domains or degenerate
axes. Each fact is reported once. The exact capsule inventory is in
[API §3.4](API.md#34-select-built-in-capsules-and-suites).

## 4.3 A dry run: space and geometry

```js
const { analysis } = await Ither({
  space,
  analysis: {
    suite: ['geometry-summary'],
    geometry: { type: 'grid', axes },
  },
});

// metrics: { type: 'grid', count, total, box: [{ min, max }, …], dependentAxes }
```

Nothing is decoded. `count` is the number of ordinals the geometry spans; `total` is the
number of in-range points where that can be known up front. It is `null` on a chained
space, whose `dependentAxes` resolve per coordinate. No time estimate is invented.

## 4.4 Live and saved records

A live query can feed analysis without materializing its records:

```js
const { query, analysis } = await Ither({
  space,
  query: { decode },                        // write is optional here
  analysis: { suite: ['query-suite', 'lib-suite'] },
});
```

Each record reaches the analysis before `write`. The query's geometry becomes the
analysis geometry, and a manifest is built for capsules that require one. It is still
returned as `result.manifest` only when `query.manifest` is `true`.

Saved rows may use any application-owned format. Adapt them back into records at the
boundary:

```js
const { analysis } = await Ither({
  space,                                    // optional
  analysis: {
    records: readRecords(file),             // iterable or async iterable
    manifest: readManifest(file),           // optional but strongly recommended
    context: { origin: [1000n, 2000n] },
    async adapt(row, position, context) {
      return {
        ordinal: BigInt(row.ordinal),
        coordinate: row.at.map((n, axis) => BigInt(n) + context.origin[axis]),
        status: row.error ? 'error' : 'structure',
        ...(row.error ? { error: row.error } : { structure: row.payload }),
      };
    },
    suite: ['query-suite'],
  },
});
```

Ither owns no storage format: `BigInt` has no JSON representation, and clients may store
relative coordinates, extra fields, or only what they need. `adapt` receives the item, its
position in `records` (from `0n`), and `context`. An adapter that throws produces an
`adapter-error` issue for that row, and reading continues.

A live query and a saved set with its manifest are the same analysis inputs and produce
the same results.

## 4.5 Provenance and drift

Every report carries provenance: the running version, the Space's packed version, and
whether saved records can be matched to the current mapping. The exact fields and mapping
values are in [API §3.5](API.md#35-read-the-result--analysisreport).

Old datasets remain analysable: a difference is reported, never refused. Deciding whether
to re-decode, translate, or trust them belongs to the caller and to the release that
introduced the mapping change.

## 4.6 Record capsules

The record capsules answer four separate questions: whether records are well formed,
whether they and the manifest cover the complete walk, what kinds of structures occur,
and whether each mapping round-trips. Select only the checks relevant to the dataset, or
use the built-in suites. Exact requirements and result data are in
[API §3.4](API.md#34-select-built-in-capsules-and-suites).

## 4.7 The report and suite composition

A suite names members and rolls up the ones that ran. Members and dependencies run first
and once, however many suites share them. The exact report shape is in
[API §3.5](API.md#35-read-the-result--analysisreport).

```js
analysis: { suite: ['space-suite', 'query-suite', 'lib-suite'] }
analysis: {
  suite: [{ type: 'structure-distribution', parameters: { maxDistinct: 10_000 } }],
}
```

## 4.8 Custom capsules

A request may bring its own capsules; nothing is installed globally. They follow the same
contract as the built-ins. The complete definition and hook contract is in
[API §3.6](API.md#36-add-custom-capsules-and-suites); this example adds a project-specific
rate check:

```js
const structureRate = {
  type: 'structure-rate',
  category: 'query',
  version: 1,
  requires: ['records'],
  parameters: ['minimum'],
  after: ['dataset-integrity'],
  create({ parameters }) {
    return {
      finish({ results }) {
        const { records, structures } = results.get('dataset-integrity').metrics;
        const rate = records === 0n ? null : Number(structures) / Number(records);
        return {
          status: rate != null && rate >= parameters.minimum ? 'pass' : 'fail',
          metrics: { rate },
        };
      },
    };
  },
};

await Ither({
  space,
  query: { decode },
  analysis: {
    capsules: [structureRate],
    suite: [{ type: 'structure-rate', parameters: { minimum: 0.95 } }],
  },
});
```

A capsule is handed only the inputs it requires. A live manifest arrives in `finish`.
`finish` is synchronous and returns a status plus acyclic plain data (`BigInt` allowed),
which Ither copies and freezes. Unknown parameters, replacement of a built-in, cycles,
unknown dependencies, and duplicate suite entries are refused before anything runs.

# Chapter 5 — Integration

Ither is an ESM library with no runtime dependencies. It does not start a server, parse
command-line arguments, read environment variables, or choose a storage format. A server,
CLI, browser application, or Deno program supplies those edges and calls the same formula,
query, and analysis API.

Node 20.10 or newer is required when importing the package source. The generated
`dist/ither.min.js` is runtime-neutral ESM targeting ES2022.

## 5.1 Node applications, servers, and command-line scripts

```bash
npm install ither
```

```js
import { Ither } from 'ither';
```

A command-line or server adapter normally provides a formula and a destination for query
records:

```js
import { Ither } from 'ither';

const records = [];
const result = await Ither({
  space: {
    layers: {
      point: {
        type: 'NUM',
        domains: { x: { min: 0, max: 1, steps: 16 } },
      },
    },
  },
  query: {
    decode: {
      type: 'ray',
      start: [0n],
      direction: [1n],
      count: 8n,
    },
    write: record => records.push(record),
  },
});

console.log(result.query, records);
```

For streaming or persistence, have `write` hand each record to the application-owned
transport or storage layer. [Chapter 3](#chapter-3--queries) covers paging, cancellation,
manifests, and resumption; [Chapter 4](#chapter-4--analyses) covers saved-record analysis.

## 5.2 Formula bank subpaths

The package includes an example formula bank. It is optional data rather than part of the
main workflow. Its loaders are documented in
[API Appendix B](API.md#appendix-b--formula-bank); its layout and access notes are in
[`formulas/README.md`](../formulas/README.md).

## 5.3 Browser applications

With a bundler, use the same package import as Node:

```js
import { Ither } from 'ither';
```

Without a bundler, vendor the single-file module described in §5.4 and import it by URL.
The runtime API is the same in either case.

## 5.4 Deno and single-file vendoring

The committed bundle has the same exports as the package root and no external imports:

```js
import { Ither } from './vendor/ither.min.js';
```

Copy it into a consumer repository:

```bash
mkdir -p vendor
cp /path/to/ither/dist/ither.min.js vendor/ither.min.js
```

The formula bank is separate data. Copy `formulas/` as well when a consumer needs it.

## 5.5 Package entry points

The supported entry points and root exports are listed under
[API conventions](API.md#conventions-and-package-surface) and
[API Appendix B](API.md#appendix-b--formula-bank).

# Chapter 6 — Practices

## 6.1 Failure model

Ither distinguishes three outcomes: malformed input rejects the operation; an expected
per-point problem becomes a record or omission; and a capsule that cannot run becomes an
`inapplicable` or `error` result without stopping the others. The complete behavior table
is in [API Appendix D](API.md#appendix-d--failure-behavior).

## 6.2 Working practices

1. Compile once; pass the same Space to every call.
2. Stream records through `write`; do not collect what you do not need in memory.
3. Ask for a manifest for anything you keep, and store it with the records. Without one,
   a dataset cannot prove it is complete or say what produced it.
4. Page with `offset` and `limit`; checkpoint `nextOffset` from `progress`.
5. Use live analysis when you do not need to store records.
6. Choose an explicit `BigInt` representation for storage, and convert back in `adapt`.
7. Validate structures before encoding them: encode applies layer policies, not checks.
8. Treat a `lib` failure as a defect in Ither, not a finding about the user's space.

# Appendix A — Glossary

The canonical terms used by the code and documentation.

## A.1 Terms (A–Z)

### axis
One **output coordinate axis** of a [space](#space) — the one name for it (never
"dimension"). A [formula](#formula)'s [projection](#projection) assigns layers (and their
[facets](#facet)) to axes; each carries one value of a [coordinate](#coordinate), bounded by
its [bound](#bound-axis-bound) when it has one. `space.axisCount` counts them. Omitting the
projection gives one axis per layer.

### bound (axis bound)
The finite **exclusive upper limit** of an [axis](#axis) where the formula fixes one: valid
values are `[0, bound)`. `space.axisBounds()` returns one per axis, or `null` for one of
three reasons:

- **capped** — the axis carries an `AST` or `LSM` layer, whose count runs only up to
  `maxNodes` / `maxLen`. A cap is a guardrail, never reported as a bound; past it a
  coordinate is [outside](#outside);
- **sparse** — a `cantor` axis or a [split](#split): no contiguous range;
- **dependent** — a [chained](#chaining) layer's axes. Their range follows the template the
  source decoded, so it is known only at a coordinate: `space.axisBounds(coordinate)`
  resolves it, and `space.axisDependencies()` names the axes it depends on.

An axis with a bound is **fixed**. A bound never depends on what was decoded before. A
`null` bound does not prevent a finite [geometry](#geometry): a query walks the range each
coordinate resolves to.

### canonicalization
Turning a formula into the one form a space keeps as `space.formula`: object keys in
code-unit order, **order-sensitive** things ([domains](#domain), arrays,
[projection](#projection)) preserved, and every default written in (combine, layer options,
OBJ/NUM shapes, the identity projection). Two formulas that mean the same space have the
same canonical form, pack identically and give the same coordinates (see
[determinism](#determinism)).

### capsule
One **analysis module**. It declares the inputs it needs, observes records when applicable,
and finishes with one result. A **suite** names member capsules and rolls up those that
ran. Built-in and request-defined capsules follow the same contract; see
[API §§3.4–3.6](API.md#34-select-built-in-capsules-and-suites).

### chaining
A [composition](#composition) mode in which a downstream `STR` layer's template **is an
earlier layer's decoded string** (the `from` field; the source is an `AST`, `STR` or
`LSM`). The canonical pattern: an `AST` layer emits a pure topology; a chained `STR`
substitutes labels into it — so topology and labelling become independent
[axes](#axis). A chained layer may not share an axis with another source, and
its axes are dependent. [recover](#recover) reads a source back out of a chained layer's
text.

### combine / combinator
How several sources **share one [axis](#axis)**. A formula declares **one**
combine for the whole space, `options.combine` (default `box`); it folds every shared
axis, every parted layer's slot groups, and a split. Built-ins: `box` (odometer), `gray`
(every `+1` moves one source by ±1), `scramble` (a
decorrelated control), `morton` (Z-order; powers of two), `hilbert` (two equal powers of
two), `cantor` (sparse; the only one that can carry a split or an unbounded source). A
combine that cannot apply to an axis is [refused](#refusal), never replaced by another.

### composition
The umbrella for the ways [layers](#layer) combine, all exact bijections:
[projection](#projection) (route / [combine](#combine--combinator) / [split](#split) /
[part](#part--parting)) and [chaining](#chaining). Formula spaces provide a current,
two-stage form of higher-order composition; native [nesting](#nesting) is not part of the
formula contract.

### coordinate
The **address of one [structure](#structure)**: an array of `BigInt`s, one per
[axis](#axis) — always an array, also for one axis. `encode` produces one;
`decode` consumes one. A structure's address is its exact coordinate array.

### dataset
A set of [records](#record) from a [query](#query), kept in storage for later analysis,
together with its [manifest](#manifest). Ither does not own its storage format.

### decode / encode
The two halves of the bijection. **decode**: [coordinate](#coordinate) →
[structure](#structure) (the combinatorics term is **unrank**). **encode**: structure →
coordinate (**rank**). Within the range each axis has at a coordinate they are mutual
inverses wherever that coordinate names a structure; a sparse in-range coordinate may be
a [hole](#hole). Past the resolved range, decode returns [OUTSIDE](#outside) and never a
different structure.
Encode takes a structure with every layer and **deduces nothing**; it does not validate a
structure either — layers apply documented [policies](#policy) (OBJ encodes a missing key
as a radix-1 digit; NUM snaps and clamps), and a part a layer cannot encode throws.

### decorated tree
A tree carrying a **symbol at every node**, ranked **shape-and-symbols jointly** (not
shape ranked separately then paired with labels). The generalized-Schröder fold that
achieves this is the `AST` layer's core technique and Ither's central technical
contribution.

### determinism
A [coordinate](#coordinate) is a pure function of **(library version, canonical
[formula](#formula), [structure](#structure))** — identical on any engine or OS. Enforced
by [canonicalization](#canonicalization), `BigInt` arithmetic, and the rule **array order
is significant; object key order is not**. Changing a ranking changes coordinates and is
a breaking change, made detectable by the [version stamp](#version-stamp).

### domain
An **ordered menu of values** a [layer](#layer) draws from
(`domains: { op: ["add", "mul"] }`). **Order is significant**: a domain index is a digit,
so reordering a domain changes coordinates.

### facet
A **semantically meaningful component** of a [structure](#structure) — topology, labels,
parameters, or a fixed position in an object/array/template. [Part](#part--parting)ing exposes
facets as their own [axes](#axis); [split](#split)ting cannot. **Split produces
numeric axes (arbitrary halves); part produces semantic axes (facets).**

### formula
The single plain object that **defines a whole [space](#space)** — Ither's canonical input:
`{ layers, projection?, options? }`. You hand it to `Ither.from(...)` and get a space
back. A formula is regular data: editable, diffable, serializable, machine-generable, and —
when bounded — itself rankable (see [the tower](#the-tower)). It is complete: nothing
outside it changes what it means. *A formula defines a space, not a single result.*

### genotype / phenotype
**Genotype** = the [structure](#structure) a coordinate decodes to (Ither's entire
concern). **Phenotype** = what a [renderer](#renderer) makes of it (a shader, a sound, a
drawing). Whether genotype locality survives the renderer into phenotype locality is the
open research question.

### geometry
The **coordinates a query walks**: a grid, ray, or explicit list. A geometry determines
which coordinates are visited and in what order; it neither decodes nor interprets them.
See [API §2.1](API.md#21-choose-an-input--grid-ray-coordinate-list-structure-list).

### hole
An in-range [coordinate](#coordinate) that **names no structure** — `decode` returns
`Ither.HOLE`. Over the valid structures represented by a formula, encode is injective;
decode may be partial over the surrounding coordinate range. A `cantor` axis or a split
has no contiguous range, so a coordinate on it
can name a tuple one of whose parts lies past its layer's size: that is a hole. In a query
a hole is a [record](#record) (`status: 'hole'`) under the default [policy](#policy).
Contrast [outside](#outside): a hole is inside the range.

### inapplicable
The result of a [capsule](#capsule) that **could not run on what it was given**: a missing
input (`reason: "missing input 'records'"`), a capsule it reads from that did not run, or
nothing to judge. It is neither a failed test (`fail`) nor a rejected request
([refusal](#refusal)); the rest of the analysis runs.

### layer
The compiled **encoder/decoder for one structure family**. A [formula](#formula)'s
`layers` is a named set of them. The eight built-ins:

| layer | family | counting basis |
|---|---|---|
| `AST` | expression trees ([decorated](#decorated-tree)) | generalized Schröder |
| `OBJ` | key/value objects | [mixed-radix](#mixed-radix) |
| `ARR` | fixed-shape arrays | [mixed-radix](#mixed-radix) |
| `STR` | fill-in templates | [mixed-radix](#mixed-radix) |
| `LSM` | L-system grammar spaces | [Kleene](#kleene-enumeration) |
| `TRI` | convex-polygon triangulations | Catalan |
| `NUM` | quantized real-valued axes | [mixed-radix](#mixed-radix) |
| `PERM` | permutations of `[0,n)` | Lehmer / factorial |

### layer spec
The per-layer object `{ type, domains?, shape?, from?, options? }` inside a
[formula](#formula)'s `layers`. Each key means the same for every type; which keys a type
accepts is fixed by the formula rules table.

### Kleene enumeration
Ranking all sequences over an alphabet up to a maximum length, shortest first — the
counting basis of the `LSM` layer (`Codec.kleeneCount / kleeneRank / kleeneUnrank`).

### manifest
The query's **record of what it did**, including the mapping, input, page, policy, and
[omitted](#omission) runs. It holds everything needed to repeat the query, and with the
records it covers `[offset, nextOffset)` exactly — which lets a stored
[dataset](#dataset) prove it is complete and say what produced it. See
[API §2.6](API.md#26-save-the-walk--querymanifest).

### measure
The probability weight uniform sampling places on structures. Uniform over *structures*
≠ uniform over *complexity*: for [decorated trees](#decorated-tree) the count is dominated
by large, high-arity trees, so a uniform draw is usually a big bushy tree. A property of
the mathematics, not a defect.

### mixed-radix
Positional numbering with a **per-position base** — the engine of the fixed-shape layers
(OBJ/ARR/STR/NUM). A structure is a numeral whose digit *i* draws from a domain of size
*bᵢ*; cardinality = ∏ *bᵢ*.

### nesting
Presenting an **entire space as a single layer** of another. This is not part of the
`0.3.0` formula contract. A formula space can still be built as two explicit stages:
decode a formula-shaped structure, then compile that formula into its own Space.

### omission
An **ordinal a query walked without producing a record**. Out-of-range points are always
omissions; holes are records under the default [policy](#policy). A query counts
omissions (`report.outside`) and its [manifest](#manifest) lists them as merged
`[ordinal, length]` runs, per kind.

### ordering / adjacency
The membership and size of a space are fixed; an encoding only chooses the
**adjacency** — which structures are neighbours (what `+1` does). Any product-space
ordering = *(per-component reindex) ∘ (component → axis assignment) ∘ (cross-component
[combine](#combine--combinator))*. In practice the lever is mostly combine selection plus
per-component [domain](#domain) order.

### ordinal
A point's **position in a query's input**: its index in a grid box (last axis fastest), a
ray (`k`), or a list. A record keeps its ordinal, so records may have gaps where points
were [omitted](#omission). `offset`, `limit`, `count` and `nextOffset` are all ordinals: a
page is `[offset, min(offset + limit, count))`.

### outside
A [coordinate](#coordinate) past the range one of its axes has **at that coordinate** —
`decode` returns `Ither.OUTSIDE`. The range is the axis's fixed
[bound](#bound-axis-bound), a layer cap, the range a [chained](#chaining) layer's
template resolves to, or non-negativity. Ither never answers such a coordinate with some
other structure: a [query](#query) omits it, counts it in `outside`, and lists it in the
[manifest](#manifest). Contrast [hole](#hole).

### pack / unpack
`space.pack()` → a `base64url` string of the canonical formula and the version packing it;
`Space.unpack()` restores a space from a payload packed by any version, recording that
version as `space.packedBy`. **Footgun:** this is storage, not a
[coordinate](#coordinate) — the string is sparse, so you cannot explore by incrementing it.

### part / parting
A [projection](#projection) operation: send **individual positions** of a fixed-shape
layer to their own [axes](#axis) — an OBJ/NUM key (`cfg.frq`), an ARR position
(`vec.0`), an STR variable (`fill.o1`) — exposing [facets](#facet) as semantic axes. Every
part of a parted layer is assigned exactly once. AST/LSM/TRI/PERM cannot be parted.

### policy
A **documented behaviour that is not a refusal**. Two kinds today: encode policies (OBJ
encodes a missing key as a radix-1 digit and ignores extra keys; NUM snaps to its grid,
clamps to `[min, max]` and encodes a missing value as `min`), and the query's record policy
— which outcomes become [records](#record) and which [omissions](#omission) (holes: record;
outside: omit), one table recorded in every manifest so it can become settable later.

### projection
The **routing of layer [coordinates](#coordinate) to output [axes](#axis)** —
Ither's central spatial lever. Operations: whole, [combine](#combine--combinator) (several
sources on one axis), [split](#split) (one layer across axes) and [part](#part--parting) (positions
to axes). In a formula it is an ordered array — entry *i* is axis *i* — of arrays of
references; omitted, it is the identity (one axis per layer). Every layer and part is
assigned; anything else is [refused](#refusal).

### provenance
The part of an analysis report that says **where its data came from**: the running
`itherVersion`, the Space's `packedBy`, a `mapping` verdict — `live` (records from the
request's own query), `manifest-matches` or `manifest-differs` (saved records and their
manifest compared with the Space), `unverified` (saved, without a manifest or a Space), or
`null` (no data) — and what was read from a saved manifest (`itherVersion`, `sameVersion`,
`sameFormula`). Drift is reported,
never refused.

### query
The tier-2 operation `Ither({ space, query: { decode | encode, … } })`. It walks a
[geometry](#geometry) (or a list of structures), calls the single operation per point,
and delivers [records](#record) to a synchronous `write`, a [report](#report) to
`progress` by time, and the final report as its result — plus the [manifest](#manifest)
when asked. It yields between points, never inside one, so it can be cancelled with an
`AbortSignal` and several can share a Space.

### record
One point of a [query](#query):
`{ ordinal, coordinate, status: 'structure' | 'hole' | 'error', structure | error }` (for
encode, `structure` is the input and `coordinate` the output). Frozen. Out-of-range points
produce no record.

### recover
The explicit operation that completes a **partial structure**: `space.recover(partial)`
reads each source layer back out of the text of a given [chained](#chaining) layer, so
`space.encode(space.recover({ fill }))` works. It reads the text once — an AST source's text
whole token by whole token, so `0` and `0.5` do not clash — and refuses loudly whenever the
reading is not one-to-one — a token two allowed symbols share (or, in a STR source's text, two
values matching at one position), an LSM source, an empty value — or a missing layer is
downstream of what was given.

### recurrence-ranked vs fixed-shape
The two [layer](#layer) classes. **Fixed-shape** (OBJ/ARR/STR/NUM): the coordinate is a
positional [mixed-radix](#mixed-radix) numeral, so positions can be [parted](#part--parting).
**Recurrence-ranked** (AST/LSM/TRI/PERM): the coordinate is a counting-recurrence rank
(Schröder / Kleene / Catalan / Lehmer), opaque to parting. This split explains most of the
projection rules.

### refusal
What Ither does with input it does not understand or cannot honour: it **throws, naming
the key, layer, axis or position**. A formula key the rules do not declare, a combine that
cannot apply, an unassigned layer, a malformed geometry, a structure missing a layer, a
recovery that is not one-to-one — each is refused. Defaults and non-refusing behavior are
explicit parts of the contract; see [policy](#policy).

### renderer
The (external) component that turns a decoded [structure](#structure) into a perceptible
[phenotype](#genotype--phenotype). Ither deliberately contains none.

### report
The query's **progress and result**: position, outcome counts, timing, stop reason, and
completion. The analysis tier returns an **analysis report** with provenance, a summary,
and one result per [capsule](#capsule). Exact shapes are in
[API §§2.5 and 3.5](API.md#25-read-the-result--queryreport).

### saturation / clamping
Decode never clamps: a coordinate past its range is [outside](#outside). `NUM` encode does
clamp numeric input to its declared range as an explicit [policy](#policy).

### space
The **compiled coordinate system** — `Ither.from(formula)`. A caller keeps one or more
spaces explicitly; there is no process-wide current space. A space holds its canonical
[formula](#formula) and answers single `decode`, `encode` and [recover](#recover) calls and
its facts (`axisCount`, `cardinality`, bounds); [queries](#query) batch it.

### split
A [projection](#projection) operation: spread **one** layer's coordinate across several
[axes](#axis) (a layer named on several axes). Only an unbounded combine
(`cantor`) can divide a layer, so a split needs `options.combine: 'cantor'`. Every grid
point is still a distinct structure or a hole, but the axes are **numeric halves, not
[facets](#facet)** — contrast [part](#part--parting).

### structure
The **native value a [coordinate](#coordinate) addresses**, keyed by layer name: per
layer an object, array, string, expression, triangulation, numeric object or permutation.
The genotype-level value Ither ranks and unranks; *not yet* a rendered artifact.

### the tower
Three nested levels of "what is being addressed":
**structure → formula → configuration**.
1. **structure space** — fix a formula; a coordinate names a structure (*built*).
2. **formula space** — a bounded *meta-formula* whose structures are formulas: a formula
   *itself* becomes a coordinate (*built*: a STR layer whose template is a formula).
3. **configuration space** — a whole stack + projection as one coordinate (*conceptual*).

### version stamp
`Ither.version` (currently `0.3.0`), carried by what a version produces: the packed
formula (`v`, read back as `space.packedBy`) and every query [manifest](#manifest)
(`itherVersion`). Analysis [provenance](#provenance) compares it with the running version,
which makes a breaking change to [determinism](#determinism) detectable in old data — and
leaves the decision to the caller.
