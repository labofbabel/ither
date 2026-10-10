# TODO


## After 0.3.0

### Canonical BigInt text

Define a small display and round-trip convention for coordinates, records, reports and
manifests so every CLI, server and browser consumer does not need to invent the same
`JSON.stringify` replacer and reviver.

### Partial-structure encoding

Consider a convenience operation for the documented
`space.encode(space.recover(partial))` composition. Keep the explicit operations as the
primitive contract.

### Combine reproducibility checks

Restore a focused development benchmark for contiguity and locality claims across
`box`, `gray`, `morton`, `hilbert`, `scramble` and `cantor`. Keep benchmark claims out of
user documentation unless the command and fixtures that reproduce them ship with the
repository.

### Deterministic sampling geometries

Consider random and low-discrepancy query geometries only with an exact resumption
contract: point `k` must be a pure function of `(seed, k)` so paging remains stable.

### Native nested spaces

Decide whether a compiled Space can become a layer of another Space. Version `0.3.0`
supports formula spaces as an explicit two-stage application pattern, not as a native
formula-layer contract.
