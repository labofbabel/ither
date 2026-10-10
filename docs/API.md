# Ither — API reference

This document is the public JavaScript API for Ither `0.3.0`. For concepts, design
guidance, and longer workflows, use the [manual](MANUAL.md).

```js
import { Ither, Space, Codec, capabilities, formulaSchema } from '@labofbabel/ither';
```

## Contents

- [Conventions and package surface](#conventions-and-package-surface)
- [Chapter 1 — Tier 1: define a Space](#chapter-1--tier-1-define-a-space)
  - [1.1 Formula object — `Formula`](#11-formula-object--formula)
  - [1.2 Layer specs — `AST`, `OBJ`, `ARR`, `STR`, `LSM`, `TRI`, `NUM`, `PERM`](#12-layer-specs--ast-obj-arr-str-lsm-tri-num-perm)
  - [1.3 Axes and ordering — `projection`, `options.combine`](#13-axes-and-ordering--projection-optionscombine)
  - [1.4 Compile a Space — `Ither.from()`, `new Space()`, `Ither({ space })`](#14-compile-a-space--itherfrom-new-space-ither-space-)
  - [1.5 Inspect a Space — properties, `axisBounds()`, `axisDependencies()`](#15-inspect-a-space--properties-axisbounds-axisdependencies)
  - [1.6 Decode one coordinate — `space.decode()`](#16-decode-one-coordinate--spacedecode)
  - [1.7 Encode one structure — `space.encode()`](#17-encode-one-structure--spaceencode)
  - [1.8 Complete a partial structure — `space.recover()`](#18-complete-a-partial-structure--spacerecover)
  - [1.9 Store and restore a Space — `space.pack()`, `Space.unpack()`](#19-store-and-restore-a-space--spacepack-spaceunpack)
- [Chapter 2 — Tier 2: query a Space](#chapter-2--tier-2-query-a-space)
  - [2.1 Choose an input — grid, ray, coordinate list, structure list](#21-choose-an-input--grid-ray-coordinate-list-structure-list)
  - [2.2 Run a query — `Ither({ space, query })`](#22-run-a-query--ither-space-query-)
  - [2.3 Consume records — `query.write()`](#23-consume-records--querywrite)
  - [2.4 Page, monitor, and stop — `offset`, `limit`, `progress`, `signal`](#24-page-monitor-and-stop--offset-limit-progress-signal)
  - [2.5 Read the result — `QueryReport`](#25-read-the-result--queryreport)
  - [2.6 Save the walk — `QueryManifest`](#26-save-the-walk--querymanifest)
- [Chapter 3 — Tier 3: analyze](#chapter-3--tier-3-analyze)
  - [3.1 Choose analysis inputs — space, geometry, live or saved records](#31-choose-analysis-inputs--space-geometry-live-or-saved-records)
  - [3.2 Run analysis — `Ither({ analysis })`](#32-run-analysis--ither-analysis-)
  - [3.3 Adapt saved rows — `analysis.adapt()`](#33-adapt-saved-rows--analysisadapt)
  - [3.4 Select built-in capsules and suites](#34-select-built-in-capsules-and-suites)
  - [3.5 Read the result — `AnalysisReport`](#35-read-the-result--analysisreport)
  - [3.6 Add custom capsules and suites](#36-add-custom-capsules-and-suites)
- [Appendix A — Introspection and version](#appendix-a--introspection-and-version)
  - [`Ither.version`, `Ither.HOLE`, `Ither.OUTSIDE`](#a1-static-values)
  - [`capabilities()`](#a2-capabilities)
  - [`formulaSchema()`](#a3-formulaschema)
- [Appendix B — Formula bank](#appendix-b--formula-bank)
  - [`registry()`, `listFormulas()`, `loadFormula()`, `loadAll()`](#b1-bank-functions)
- [Appendix C — `Codec` utility surface (stub)](#appendix-c--codec-utility-surface-stub)
- [Appendix D — Failure behavior](#appendix-d--failure-behavior)

## Conventions and package surface

- Coordinates, ordinals, counts, and fixed bounds are `BigInt` unless stated otherwise.
- A coordinate is always an array: `[4n]`, not `4n`.
- A structure is always keyed by layer name: `{ color: { r: 128 } }`.
- Arrays are ordered. Object key order is not significant.
- Unknown keys in formulas and requests are rejected.
- Returned values are JavaScript values, not JSON. `BigInt` requires an application-chosen
  representation when stored as JSON.

The root package exports only `Ither`, `Space`, `Codec`, `capabilities`, and
`formulaSchema`. The single-file build is available at
`@labofbabel/ither/dist/ither.min.js`.

# Chapter 1 — Tier 1: define a Space

## 1.1 Formula object — `Formula`

**Shape**

```js
{
  layers: {
    <layerName>: <LayerSpec>,
  },
  projection: [ [<reference>, ...], ... ], // optional
  options: { combine: 'box' },             // optional
}
```

**Fields**

| field | required | value |
|---|---:|---|
| `layers` | yes | Named layer specs; at least one. |
| `projection` | no | Ordered output axes. Default: one axis per layer in resolution order. |
| `options.combine` | no | `box`, `gray`, `scramble`, `cantor`, `morton`, or `hilbert`. Default: `box`. |

**Returns**

A formula becomes a `Space` when passed to `Ither.from()`, `new Space()`, or
`Ither({ space })`. The resulting `space.formula` is the frozen canonical form with
defaults written in.

**Throws**

Compilation throws on missing required fields, unknown fields, invalid layer names or
references, dependency cycles, and incompatible projection/combine choices.

**Example**

```js
const formula = {
  layers: {
    color: {
      type: 'NUM',
      domains: {
        r: { min: 0, max: 255, steps: 256 },
        g: { min: 0, max: 255, steps: 256 },
        b: { min: 0, max: 255, steps: 256 },
      },
      shape: ['r', 'g', 'b'],
    },
  },
  projection: [['color.r'], ['color.g'], ['color.b']],
};
```

## 1.2 Layer specs — `AST`, `OBJ`, `ARR`, `STR`, `LSM`, `TRI`, `NUM`, `PERM`

**Shape**

Every layer uses some part of this envelope:

```js
{ type, domains?, shape?, from?, options? }
```

| type | accepted shape | decoded structure | addressable parts |
|---|---|---|---|
| `AST` | `{ type:'AST', domains:{ x:[...], o1:[...], o2:[...], ... }, options? }` | expression string | none |
| `OBJ` | `{ type:'OBJ', domains:{ key:[...], ... }, shape? }` | object | keys |
| `ARR` | `{ type:'ARR', domains:{ name:[...], ... }, shape:['name', ...] }` | array | positions |
| `STR` | `{ type:'STR', domains:{ name:[...], ... }, shape:'...' }` or `{ ..., from:'layer' }` | string | variables |
| `LSM` | `{ type:'LSM', domains:{ alphabet:[...] }, shape:{ variables, axiom }, options:{ maxLen, iterations? } }` | production object | none |
| `TRI` | `{ type:'TRI', shape:{ n } }` | triangle list | none |
| `NUM` | `{ type:'NUM', domains:{ key:{ min,max,steps }, ... }, shape? }` | number object | keys |
| `PERM` | `{ type:'PERM', shape:{ n } }` | permutation array | none |

**Parameters**

- `AST.domains.x` is the leaf domain. `oN` is the domain of operators with arity `N`.
  `options.maxNodes` defaults to `64`; `options.ranking` is `leafMinor`, `leafMajor`, or
  `opMajor` and defaults to `leafMinor`.
- `OBJ.shape` and `NUM.shape` contain every domain key once. When omitted, sorted domain
  keys are used.
- `ARR.shape` names the domain used by each position. Names may repeat; every declared
  domain must be used.
- `STR` accepts exactly one of `shape` or `from`. A fixed `shape` must use every domain
  key. `from` names an upstream `AST`, `STR`, or `LSM` layer.
- Layers resolve with each `from` source before its consumers; unrelated ties use
  code-unit name order. This order appears in `space.layerNames` and supplies the default
  projection.
- `LSM.shape.variables` is a non-empty string array; `shape.axiom` is a string.
  `options.maxLen` is required and non-negative; `options.iterations` defaults to `2`.
- `TRI.shape.n >= 3`. `PERM.shape.n >= 1`.
- `NUM` requires finite numeric `min` and `max`, `max >= min`, and integer `steps >= 1`.
- Ordinary domain values are strings, numbers, or booleans.

**Returns**

Layer results appear under their layer names in every decoded structure.

**Throws**

Compilation rejects unknown keys, invalid domain/shape relationships, invalid `from`
targets or cycles, and empty or malformed required values.

**Example**

```js
const layers = {
  topo: {
    type: 'AST',
    domains: { x: ['x'], o1: ['o1'], o2: ['o2'] },
  },
  fill: {
    type: 'STR',
    from: 'topo',
    domains: { x: ['a', 'b'], o1: ['sin'], o2: ['add', 'mul'] },
  },
};
```

## 1.3 Axes and ordering — `projection`, `options.combine`

**Shape**

```js
projection: [
  ['topo'],
  ['fill.x'],
  ['fill.o1', 'fill.o2'],
],
options: { combine: 'gray' }
```

**Parameters**

| reference pattern | result |
|---|---|
| `['layer']` | Put a whole layer on one axis. |
| `['a', 'b']` | Put several sources on one axis using `options.combine`. |
| `['layer.part']` | Put one `OBJ`/`NUM` key, `ARR` position, or `STR` variable on an axis. |
| `'layer'` on several axes | Split one layer across axes; requires the unbounded `cantor` combine. |

Every layer or part must be assigned exactly once, except a whole layer may repeat when it
is split. A layer cannot be referenced both whole and by part.

| combine | ordering | requirement |
|---|---|---|
| `box` | mixed-radix odometer | bounded sources |
| `gray` | one source changes by `±1` per step | bounded sources |
| `scramble` | deterministic per-axis permutation | bounded sources |
| `morton` | Z-order bit interleave | every source cardinality is a power of two |
| `hilbert` | 2-D Hilbert order | exactly two equal power-of-two cardinalities |
| `cantor` | sparse Cantor pairing | unbounded; may contain holes |

**Returns**

Projection entry `i` becomes coordinate axis `i`. The combine controls how multiple
values on an axis map to its single integer.

**Throws**

Compilation rejects unknown or repeated parts, incomplete assignments, incompatible
combines, and a chained layer sharing an axis with another source.

**Example**

```js
const space = Ither.from({
  layers,
  projection: [['topo'], ['fill.x'], ['fill.o1', 'fill.o2']],
  options: { combine: 'gray' },
});
```

## 1.4 Compile a Space — `Ither.from()`, `new Space()`, `Ither({ space })`

**Signatures**

```js
Ither.from(formula)       // -> Space
new Space(formula)        // -> Space
await Ither({ space })    // -> { space: Space }
```

**Parameters**

`formula` / `space` may be a formula object. In the workflow form, `space` may also be an
existing `Space`, which is returned by identity.

**Returns**

`Ither.from()` and `new Space()` return synchronously. `Ither()` always returns a Promise
of a frozen result envelope.

**Throws / rejects**

Invalid formulas fail during compilation. `new Ither()` throws; `Ither` is a function,
not a constructor.

**Example**

```js
const space = Ither.from(formula);
const { space: sameSpace } = await Ither({ space });
```

## 1.5 Inspect a Space — properties, `axisBounds()`, `axisDependencies()`

**Signatures**

```js
space.formula
space.layerNames
space.axisCount
space.cardinality
space.packedBy
space.axisBounds(coordinate?)
space.axisDependencies()
```

**Parameters**

`axisBounds(coordinate?)` accepts an optional coordinate when dependent axes must be
resolved for a chained layer.

**Returns**

| member | return value |
|---|---|
| `formula` | Deeply frozen canonical formula. |
| `layerNames` | Frozen names in dependency/resolution order. |
| `axisCount` | Number of coordinate axes. |
| `cardinality` | Structure count as `BigInt`, or `null` for capped, chained, or otherwise unfixed spaces. |
| `packedBy` | Version string from `Space.unpack()`, otherwise `null`. |
| `axisBounds()` | `(BigInt \| null)[]`; each bound is exclusive. |
| `axisDependencies()` | `number[][]`; source axes on which each axis range depends. |

**Throws**

`axisBounds(coordinate)` may throw when the coordinate cannot resolve a dependent range.

**Example**

```js
space.axisCount;          // 3
space.axisBounds();       // [65n, 2n, 2n] or null entries where not fixed
space.axisDependencies(); // [[], [0], [0]] for dependent fill axes
```

## 1.6 Decode one coordinate — `space.decode()`

**Signature**

```js
space.decode(coordinate)
```

**Parameters**

`coordinate` is an array containing exactly one `BigInt` per axis.

**Returns**

```js
{ <layerName>: <decoded structure>, ... }
Ither.HOLE     // in range, but no structure occupies this coordinate
Ither.OUTSIDE  // at least one axis is outside its range at this coordinate
```

Compare sentinels by identity: `value === Ither.HOLE`.

**Throws**

A non-array coordinate, wrong axis count, or non-`BigInt` component throws.

**Example**

```js
const value = space.decode([7n, 1n, 0n]);
if (value !== Ither.HOLE && value !== Ither.OUTSIDE) {
  console.log(value);
}
```

## 1.7 Encode one structure — `space.encode()`

**Signature**

```js
space.encode(structure)
```

**Parameters**

`structure` is an object containing every layer name.

**Returns**

An array containing one `BigInt` per axis.

**Throws**

The outer object must contain every layer and no unknown layer. A layer value that cannot
be encoded throws. `OBJ` ignores extra keys inside its layer value and does not validate
missing keys. `NUM` snaps to the nearest grid step, clamps to `[min, max]`, and treats a
missing or non-number value as `min`.

**Example**

```js
space.encode({
  topo: 'o2(x,x)',
  fill: 'add(a,b)',
}); // -> [BigInt, BigInt, BigInt]
```

## 1.8 Complete a partial structure — `space.recover()`

**Signature**

```js
space.recover(partial)
```

**Parameters**

`partial` is a structure object containing enough chained-layer output to recover missing
upstream layers.

**Returns**

A full structure object suitable for `space.encode()`.

**Throws**

Recovery rejects ambiguous or non-reversible text, empty domain values, `LSM` sources,
and cases where the supplied layer cannot determine a missing downstream layer.

**Example**

```js
const complete = space.recover({ fill: 'add(a,b)' });
const coordinate = space.encode(complete);
```

## 1.9 Store and restore a Space — `space.pack()`, `Space.unpack()`

**Signatures**

```js
space.pack()          // -> string
Space.unpack(packed)  // -> Space
```

**Parameters**

`packed` is the base64url text returned by `space.pack()`.

**Returns**

`pack()` encodes `{ formula, v }`, using the canonical formula and current Ither version.
`unpack()` accepts any recorded version and exposes it as `restored.packedBy`.

**Throws**

`Space.unpack()` rejects malformed base64url/JSON, missing `formula` or `v`, non-string
`v`, unknown payload keys, and formulas that no longer compile.

**Example**

```js
const packed = space.pack();
const restored = Space.unpack(packed);
restored.packedBy; // '0.3.0'
```

# Chapter 2 — Tier 2: query a Space

## 2.1 Choose an input — grid, ray, coordinate list, structure list

**Shapes**

```js
// Decode an inclusive grid; one entry per Space axis.
{ decode: { type: 'grid', axes: [
  { start: 0n, end: 9n, step: 1n },
] } }

// Decode start + direction * k for 0 <= k < count.
{ decode: { type: 'ray', start: [0n], direction: [1n], count: 100n } }

// Decode explicit coordinates.
{ decode: { type: 'list', coordinates: [[0n], [3n], [8n]] } }

// Encode explicit structures.
{ encode: { type: 'list', structures: [{ f: 'add(a,b)' }] } }
```

**Parameters**

| input | requirements | ordinal |
|---|---|---|
| grid | One axis spec per Space axis; `start <= end`; `step > 0`, default `1n`. | Position in the box; last axis changes fastest. |
| ray | `start` and `direction` match the axis count; `start >= 0`; direction is not all zero; `count >= 0`. | `k`. |
| coordinate list | Every coordinate contains one `BigInt` per Space axis. | Array index. |
| structure list | Every item is an object with exactly the Space's layer names. | Array index. |

**Returns**

The chosen input is walked as an ordered sequence of ordinals.

**Throws**

Malformed input is rejected before any record is delivered. A query requires exactly one
of `decode` or `encode`.

**Example**

```js
const decode = {
  type: 'grid',
  axes: [{ start: 0n, end: 15n }, { start: 0n, end: 15n }],
};
```

## 2.2 Run a query — `Ither({ space, query })`

**Signature**

```js
await Ither({
  space,
  query: {
    decode,             // or encode
    offset: 0n,         // optional
    limit: 1_000n,      // optional
    write(record) {},   // required unless analysis consumes records
    progress(report) {},// optional
    signal,             // optional AbortSignal
    manifest: true,     // optional; default false
  },
});
```

**Parameters**

`space` is a formula or `Space`. `query` accepts only `decode`, `encode`, `offset`,
`limit`, `write`, `progress`, `signal`, and `manifest`.

**Returns**

```js
{ space, query: <QueryReport> }
{ space, query: <QueryReport>, manifest: <QueryManifest> } // manifest: true
```

**Rejects**

The Promise rejects for a malformed request, invalid geometry, invalid paging values,
invalid callbacks, or an exception thrown by `write` or `progress`.

**Example**

```js
const records = [];
const result = await Ither({
  space,
  query: {
    decode: { type: 'list', coordinates: [[0n], [1n], [2n]] },
    write: record => records.push(record),
  },
});
```

## 2.3 Consume records — `query.write()`

**Signature**

```js
write(record) // -> false to stop; any other synchronous value to continue
```

**Parameters**

```js
// Decode records
{ ordinal, coordinate, status: 'structure', structure }
{ ordinal, coordinate, status: 'hole' }
{ ordinal, coordinate, status: 'error', error: { name, message } }

// Encode records
{ ordinal, structure, status: 'structure', coordinate }
{ ordinal, structure, status: 'error', error: { name, message } }
```

Each record is frozen. An error at one point becomes an error record; the walk continues.
An out-of-range point produces no record.

**Returns**

Return `false` to stop after the current record. Any other non-Promise value continues.

**Throws / rejects**

Returning a Promise rejects the query because `write` must be synchronous. Throwing from
`write` rejects the query.

**Example**

```js
write(record) {
  if (record.status === 'structure') save(record);
  return record.ordinal < 999n;
}
```

## 2.4 Page, monitor, and stop — `offset`, `limit`, `progress`, `signal`

**Signature**

```js
{
  offset: 0n,
  limit: 1_000n,
  progress(report) {},
  signal: controller.signal,
}
```

**Parameters**

- `offset` defaults to `0n` and must be within `[0, count]`.
- `limit` is an optional non-negative `BigInt`.
- The page is `[offset, min(offset + limit, count))` in ordinals.
- `progress` is synchronous and receives interim `QueryReport` values plus the final report.
- `signal` is an `AbortSignal`. Aborting resolves normally with `stop: 'signal'`.

**Returns**

`report.nextOffset` is the exact ordinal from which to resume. Out-of-range omissions still
advance it.

**Throws / rejects**

Invalid `offset`, `limit`, callback, or signal values reject before the walk. A Promise or
exception from `progress` rejects during the walk.

**Example**

```js
const first = await Ither({
  space,
  query: { decode, limit: 100n, write },
});

const next = await Ither({
  space,
  query: { decode, offset: first.query.nextOffset, limit: 100n, write },
});
```

## 2.5 Read the result — `QueryReport`

**Shape**

```js
{
  kind: 'query-report', version: 1,
  offset, limit, count, nextOffset,
  fraction,
  records, structures, holes, errors, outside,
  total, remaining,
  elapsedMs, recordsPerSecond, remainingMs,
  stop, complete,
}
```

**Fields**

| field | value |
|---|---|
| `offset`, `limit` | Requested page; `limit` is `null` when omitted. |
| `count` | Total ordinals in the input. |
| `nextOffset` | Resume ordinal. |
| `fraction` | Page fraction walked, `0..1` as `Number`. |
| `records` | Records delivered to `write`. |
| `structures`, `holes`, `errors` | Outcome counts. |
| `outside` | Out-of-range ordinals omitted. |
| `total`, `remaining` | Deliverable records in the page and remaining records, or `null` when not known before walking. |
| `elapsedMs`, `recordsPerSecond`, `remainingMs` | Numeric timing values; unavailable estimates are `null`. |
| `stop` | `null` while running; final value is `end`, `limit`, `write`, or `signal`. |
| `complete` | Whether the page's full ordinal range was walked. |

**Returns**

The final report is `result.query`. Progress reports have the same shape.

**Example**

```js
const { query } = await Ither({ space, query: { decode, write } });
console.log(query.stop, query.records, query.nextOffset);
```

## 2.6 Save the walk — `QueryManifest`

**Signature**

```js
query: { ..., manifest: true }
```

**Returns**

```js
{
  kind: 'query-manifest',
  version: 1,
  itherVersion: '0.3.0',
  packedBy: null,
  formula,
  decode,                 // or encode
  offset,
  limit,
  nextOffset,
  policy: { hole: 'record', outside: 'omit' },
  omitted: { outside: [[ordinal, length], ...] },
}
```

The records and omitted runs together cover `[offset, nextOffset)` exactly. `formula` and
the query input are canonical frozen values.

**Throws / rejects**

`manifest` must be boolean. Manifest creation adds no separate failure mode after the
query request has validated.

**Example**

```js
const { manifest } = await Ither({
  space,
  query: { decode, write, manifest: true },
});

await Ither({
  space: manifest.formula,
  query: {
    decode: manifest.decode,
    offset: manifest.offset,
    ...(manifest.limit === null ? {} : { limit: manifest.limit }),
    write,
  },
});
```

# Chapter 3 — Tier 3: analyze

## 3.1 Choose analysis inputs — space, geometry, live or saved records

**Shapes**

```js
// Space only
{ space, analysis: { suite: ['space-suite'] } }

// Space + decode geometry, without walking it
{ space, analysis: { suite: ['geometry-summary'], geometry: decodeGeometry } }

// Live query records
{ space, query: { decode: decodeGeometry }, analysis: { suite: ['query-suite'] } }

// Saved records
{ space, analysis: { records, manifest, suite: ['query-suite', 'lib-suite'] } }
```

**Parameters**

| analysis input | source |
|---|---|
| `space` | Top-level `request.space`. |
| `geometry` | `analysis.geometry`, live decode query, or saved manifest's `decode`. |
| `records` | Live query, or `analysis.records` iterable/async iterable. |
| `manifest` | Live query, or `analysis.manifest`. |

One input cannot have two sources. A live query supplies its own records and manifest, so
`analysis.records`, `analysis.manifest`, and `analysis.geometry` cannot accompany it.

**Returns**

Each selected capsule receives only the inputs declared in its `requires` array. Missing
inputs produce an `inapplicable` capsule result rather than rejecting the request.

**Throws / rejects**

Conflicting input sources and malformed geometry, records, or manifest values reject.

**Example**

```js
const result = await Ither({
  space,
  analysis: {
    geometry: { type: 'ray', start: [0n], direction: [1n], count: 100n },
    suite: ['geometry-summary'],
  },
});
```

## 3.2 Run analysis — `Ither({ analysis })`

**Signature**

```js
await Ither({
  space,       // optional unless a selected capsule requires it
  query,       // optional live source
  analysis: {
    suite,     // required, non-empty
    capsules,  // optional custom definitions
    context,   // optional application value
    geometry,  // optional decode geometry
    records,   // optional iterable or async iterable
    adapt,     // optional; requires records
    manifest,  // optional QueryManifest
  },
});
```

**Parameters**

`suite` contains capsule names or `{ type, parameters }` items:

```js
suite: [
  'dataset-integrity',
  { type: 'structure-distribution', parameters: { maxDistinct: 10_000 } },
]
```

**Returns**

```js
{ analysis: <AnalysisReport> }
{ space, analysis: <AnalysisReport> }
{ space, query: <QueryReport>, manifest?, analysis: <AnalysisReport> }
```

**Rejects**

Malformed requests, missing/empty `suite`, unknown or duplicate capsule names, unknown
parameters, invalid custom definitions, and exceptions during capsule creation reject.
Exceptions during capsule observation or finishing become `error` results.

**Example**

```js
const { analysis } = await Ither({
  space,
  analysis: { suite: ['space-suite', 'space-serialization'] },
});
```

## 3.3 Adapt saved rows — `analysis.adapt()`

**Signature**

```js
adapt(item, row, context) // -> record | Promise<record>
```

**Parameters**

- `item` is one value from `analysis.records`.
- `row` is its zero-based `BigInt` position.
- `context` is `analysis.context`.

Unlike query callbacks, `adapt` may be asynchronous.

**Returns**

A query-record-shaped value consumed by record capsules.

**Throws / rejects**

An adapter exception or rejected Promise is reported to capsules through `adapterError`;
iteration continues with the next row.

**Example**

```js
const result = await Ither({
  analysis: {
    records: storedRows,
    adapt: row => ({
      ...row,
      ordinal: BigInt(row.ordinal),
      coordinate: row.coordinate?.map(BigInt),
    }),
    suite: ['dataset-integrity'],
  },
});
```

## 3.4 Select built-in capsules and suites

**Shape**

```js
analysis: { suite: ['space-suite', 'query-suite', 'lib-suite'] }
```

**Built-ins**

| type | requires | principal result data |
|---|---|---|
| `space-summary` | `space` | Axis count, finiteness, coordinate/structure cardinality, layers, versions. |
| `space-axes` | `space` | Per-axis bound, reason, dependencies, combine, and routed sources. |
| `space-layers` | `space` | Per-layer type, cardinality, parting, chain source, and domain sizes. |
| `space-checks` | `space` | Empty-domain and degenerate-axis checks/notices. |
| `geometry-summary` | `space`, `geometry` | Type, ordinal count, known in-range total, box, dependent axes. |
| `dataset-integrity` | `records` | Record/status/ordinal validation and counts. |
| `dataset-coverage` | `records`, `manifest` | Exact coverage of `[offset, nextOffset)`. |
| `structure-distribution` | `records` | Structure kinds and distinct count; accepts `maxDistinct`. |
| `mapping-roundtrip` | `space`, `records` | Encode/decode round-trip checks. |
| `space-serialization` | `space` | `pack -> unpack -> pack` stability. |
| `space-suite` | members | `space-summary`, `space-axes`, `space-layers`, `space-checks`. |
| `query-suite` | members | `dataset-integrity`, `dataset-coverage`, `structure-distribution`, `geometry-summary`. |
| `lib-suite` | members | `mapping-roundtrip`, `space-serialization`. |

**Returns**

Dependencies and suite members run first. Every planned capsule appears once in
`analysis.results`.

**Throws / rejects**

Unknown capsules, duplicate selections, and unsupported parameter names reject.

**Example**

```js
analysis: {
  suite: [
    'dataset-integrity',
    { type: 'structure-distribution', parameters: { maxDistinct: 4096 } },
  ],
}
```

## 3.5 Read the result — `AnalysisReport`

**Shape**

```js
{
  kind: 'analysis-report',
  version: 1,
  provenance: {
    itherVersion,
    packedBy,
    mapping,
    manifest,
  },
  summary: {
    requested,
    status,
    counts: { pass, warn, fail, inapplicable, error },
    categories,
  },
  results: [
    { type, category, version, status, reason?, ...data },
  ],
}
```

**Fields**

| field | value |
|---|---|
| `result.status` | `pass`, `warn`, `fail`, `inapplicable`, or `error`. |
| `result.reason` | Required for `inapplicable`; supplied for runner-generated `error`. |
| `summary.status` | `error` if any capsule broke; otherwise worst verdict among capsules that ran; `inapplicable` if none ran. |
| `provenance.mapping` | `live`, `manifest-matches`, `manifest-differs`, `unverified`, or `null`. |
| `provenance.manifest` | Saved-manifest comparison or `null`. |

Counts are `BigInt`. Capsule-specific data commonly appears under `metrics`, `checks`,
`notices`, or `issues`.

**Returns**

The report is `result.analysis`.

**Example**

```js
const failed = analysis.results.filter(result =>
  result.status === 'fail' || result.status === 'error'
);
```

## 3.6 Add custom capsules and suites

**Signatures**

```js
const capsule = {
  type: 'structure-rate',
  category: 'query',
  version: 1,
  description: 'Share of records that are structures.', // optional
  requires: ['records'],                                 // optional
  parameters: ['minimum'],                               // optional
  after: ['dataset-integrity'],                          // optional
  create({ parameters, context, inputs }) {
    return {
      observe(record, row) {},                // optional
      adapterError(row, error) {},            // optional
      finish({ inputs, results }) {
        return { status: 'pass', metrics: {} };
      },
    };
  },
};

const suite = {
  type: 'project-suite',
  category: 'query',
  version: 1,
  description: 'Project checks.', // optional
  members: ['dataset-integrity', 'structure-rate'],
};
```

**Parameters**

Labels are lowercase hyphenated strings. `requires` may contain `space`, `geometry`,
`records`, and `manifest`. A records capsule also receives `inputs.direction` as
`decode`, `encode`, or `null`. `results` is a `Map` containing completed dependencies.

**Returns**

`finish()` returns plain data with `status: 'pass' | 'warn' | 'fail' | 'inapplicable'`.
An `inapplicable` result requires a non-empty `reason`. The runner adds `type`, `category`,
and `version`.

**Throws / rejects**

Custom definitions cannot replace built-ins. Invalid definitions or `create()` failures
reject the request. `observe()` and `finish()` failures become `error` results. Result data
must contain only primitives, plain objects, and arrays, without cycles.

**Example**

```js
await Ither({
  analysis: {
    records,
    capsules: [capsule, suite],
    suite: [{ type: 'structure-rate', parameters: { minimum: 0.9 } }],
  },
});
```

# Appendix A — Introspection and version

## A.1 Static values

**Signatures**

```js
Ither.version   // '0.3.0'
Ither.HOLE      // Symbol
Ither.OUTSIDE   // Symbol
```

`Ither.HOLE` and `Ither.OUTSIDE` are the exact sentinels returned by `space.decode()`.

## A.2 `capabilities()`

**Signature**

```js
capabilities()
```

**Returns**

```js
{
  itherVersion,
  analysisTypes,
  analysisCategories,
  analysisInputs,
  analysisCapsules,
  layerTypes,
  combinators,
  formulaSchema,
  api,
}
```

This snapshot exposes the formula, combine, analysis, and high-level call contracts as
data.

**Example**

```js
const { layerTypes, combinators } = capabilities();
```

## A.3 `formulaSchema()`

**Signature**

```js
formulaSchema()
```

**Returns**

The draft 2020-12 JSON Schema for `Formula`. A generated copy ships as
[`formulas/formula.schema.json`](../formulas/formula.schema.json).

**Example**

```js
const schema = formulaSchema();
```

# Appendix B — Formula bank

The formula bank is a packaged example set, not part of the root library workflow.

```js
import {
  registry,
  listFormulas,
  loadFormula,
  loadAll,
} from '@labofbabel/ither/formulas/bank.mjs';
```

## B.1 Bank functions

**Signatures**

```js
registry()                              // -> Promise<FormulaRegistry>
listFormulas({ collection?, tag? }?)   // -> Promise<FormulaEntry[]>
loadFormula(name)                      // -> Promise<Formula>
loadAll({ collection?, tag? }?)        // -> Promise<(FormulaEntry & { formula })[]>
```

**Parameters**

`collection` and `tag` filter registry metadata. `name` is a registry entry name.

**Returns**

```js
// FormulaRegistry
{ schema, formulas: [<FormulaEntry>, ...] }

// FormulaEntry
{ name, title, collection, file, tags, description? }
```

Every returned value is a caller-owned clone.

**Rejects**

`loadFormula()` rejects unknown names. Module/JSON loading failures reject all functions.

**Example**

```js
const formula = await loadFormula('ast-shader-expression');
const space = Ither.from(formula);
```

# Appendix C — `Codec` utility surface (stub)

`Codec` is public in `0.3.0` as an auxiliary, stateless utility. It is not part of the
main three-tier workflow. This appendix indexes its public surface; detailed per-method
contracts are not yet documented.

**Static value**

- `Codec.alphabet`

**Pairing and list packing**

- `Codec.pairInts(a, b)`
- `Codec.unpairInt(z)`
- `Codec.bigIntSqrt(n)`
- `Codec.packList(values)`
- `Codec.unpackList(code, N)`

**Mixed-radix coordinates**

- `Codec.int_to_mixedBase(n, baseStr)`
- `Codec.mixedBase_to_int(coord)`
- `Codec.coordArr_to_int(coordArr, baseArr)`
- `Codec.int_to_coordArr(rank, baseArr)`
- `Codec.intArr_to_coordStr(coordArr, baseArr)`
- `Codec.coordStr_to_intArr(str)`
- `Codec.coordStr_to_int(str)`
- `Codec.int_to_coordStr(rank, baseStr)`
- `Codec.parseCoordStr(str)`
- `Codec.max_value(baseStr)`
- `Codec.char_to_int(c)`
- `Codec.int_to_char(v)`
- `Codec.baseStr_to_intArr(str, options?)`
- `Codec.intArr_to_baseStr(baseArr, options?)`
- `Codec.asCoordInt(coord)`

**Bounded Kleene sequences**

- `Codec.kleeneCount(A, maxLen)`
- `Codec.kleeneRank(seqIdx, A, maxLen)`
- `Codec.kleeneUnrank(index, A, maxLen)`

**Base64url**

- `Codec.toBase64url(str)`
- `Codec.fromBase64url(b64)`

**Parsing and structural helpers**

- `Codec.str_to_obj(input, options?)`
- `Codec.str_to_arr(input)`
- `Codec.str_to_ast(str)`
- `Codec.ast_to_str(node, options?)`
- `Codec.inferTypes(value)`
- `Codec.domainIndexOf(domain, value)`
- `Codec.extractAritiesFromDomains(obj)`
- `Codec.extractSymbols(expr)`
- `Codec.replaceSymbolsInExpr(expr, symbols)`
- `Codec.isAstStruct(str)`
- `Codec.isObjStruct(str)`
- `Codec.intArrEqual(a, b)`

# Appendix D — Failure behavior

| event | behavior |
|---|---|
| Invalid formula | `Ither.from()` / `new Space()` throws; `Ither()` rejects. |
| Malformed workflow, query, geometry, analysis, or custom definition | `Ither()` rejects. |
| Invalid single coordinate or structure | `space.decode()` / `space.encode()` throws. |
| Decode/encode failure at one query point | An `error` record is emitted; the query continues. |
| Out-of-range query point | No record; `outside` increases and the manifest records the omitted run. |
| Missing capsule input | `inapplicable` result; other capsules continue. |
| Capsule `observe()` or `finish()` failure | `error` result; other capsules continue. |
| Saved-row adapter failure | Reported to record capsules; iteration continues. |
| Different formula or Ither version in saved data | Reported by provenance; not rejected. |
