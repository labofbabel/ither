# Changelog

All notable changes to Ither are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) — while the version is `0.x`, a minor
release may break the API.

A release that changes the coordinate ↔ structure mapping of any formula is always
called out here, because it moves every saved coordinate.

## 0.3.0 — 2026-10-08 (first public release)

- Published on npm as `@labofbabel/ither`.
- Three tiers: `Ither.from(formula)` compiles a Space; `Ither({ space, query })` decodes
  or encodes grids, rays and lists as records with a manifest; `Ither({ analysis })` runs
  analysis capsules on a space, a geometry, or live or saved records.
- Eight layer types: `AST`, `OBJ`, `ARR`, `STR`, `LSM`, `TRI`, `NUM`, `PERM`.
- Six combine families: `box` (default), `gray`, `morton`, `hilbert`, `scramble`, `cantor`.
- `scramble` uses a deterministic reversible bit-mixing permutation across every folded
  source; this replaces the earlier linear multiplier and changes its coordinates.
- A versioned formula bank in `formulas/`, and `dist/ither.min.js`, a single-file build.
