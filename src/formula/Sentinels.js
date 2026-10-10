// Ither — decode's two sentinels. Public as Ither.HOLE and Ither.OUTSIDE (src/Ither.js);
// everything inside the library imports them from here. Check with ===.
//
// HOLE — an in-range coordinate that names no structure. Most mappings are bijections,
// but a combine may be a partial bijection: encode stays total and injective, while
// decode returns HOLE for a coordinate that maps to no structure (a sparse Cantor or
// split axis).
//
// OUTSIDE — a coordinate past the range its axis has at that coordinate: fixed by the
// formula, or resolved from the template a chained layer took from its source. It is
// never a stand-in structure: a query skips such coordinates and counts them.

export const HOLE = Symbol('ither.hole');
export const OUTSIDE = Symbol('ither.outside');
