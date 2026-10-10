// Ither — public entry point
//
// This file is the whole public surface. Everything the library does is reached
// through the three tiers of the façade in ./Ither.js; the rest describes that
// contract or converts values for a client:
//
//   Ither            the façade: Ither.from(formula), Ither({ space, query, analysis }),
//                    Ither.HOLE, Ither.OUTSIDE, Ither.version
//   Space            the compiled space a formula becomes; Space.unpack(packed)
//   capabilities()   the contract as data; formulaSchema() the formula's JSON Schema
//   Codec            conversions a client may need
//
// src/formula, src/query and src/analysis are internal and not exported.

export { Ither } from './Ither.js';
export { Space } from './formula/Space.js';
export { Codec } from './formula/Codec.js';
export { capabilities, formulaSchema } from './Capabilities.js';
