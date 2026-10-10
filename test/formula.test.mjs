// Tier 1 — the formula contract.
//
// A formula is the complete, strict definition of a space. Anything the library does
// not understand is refused with a message naming the key and the layer; nothing is
// silently ignored, defaulted, or rerouted. Facts about a space have one canonical
// route: the space analysis.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Ither, Space, Codec, capabilities, formulaSchema } from '../src/index.js';
import { LAYER_RULES, FORMULA_RULES, COMBINE_DEFAULT } from '../src/formula/FormulaRules.js';
import { Engine, LAYER_CLASSES } from '../src/formula/Engine.js';
import { Combinators } from '../src/formula/Combinators.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = value => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));

// One valid formula per layer type, using every key its rules declare.
const EVERY_KEY = {
   AST: { type: 'AST', domains: { x: ['a', 'b'], o2: ['f'] }, options: { maxNodes: 3, ranking: 'opMajor' } },
   OBJ: { type: 'OBJ', domains: { p: [0, 1], q: ['u', 'v'] }, shape: ['q', 'p'] },
   ARR: { type: 'ARR', domains: { b: [0, 1] }, shape: ['b', 'b'] },
   STR: { type: 'STR', domains: { a: ['1', '2'] }, shape: 'a+a' },
   LSM: { type: 'LSM', domains: { alphabet: ['F', '+'] }, shape: { variables: ['F'], axiom: 'F' }, options: { maxLen: 2, iterations: 1 } },
   TRI: { type: 'TRI', shape: { n: 5 } },
   NUM: { type: 'NUM', domains: { v: { min: 0, max: 1, steps: 3 } }, shape: ['v'] },
   PERM: { type: 'PERM', shape: { n: 3 } },
};

const refuses = (formula, ...patterns) => {
   let error = null;
   try { Ither.from(formula); } catch (e) { error = e; }
   assert.ok(error, `expected ${text(formula)} to be refused`);
   for (const pattern of patterns) assert.match(error.message, pattern);
};

//////////////////////////////////////////////////////////////////////////////
// 4.1 one definition of what a formula may contain
//////////////////////////////////////////////////////////////////////////////

test('4.1 the rules table names every layer type the engine builds', () => {
   assert.deepEqual(Object.keys(LAYER_RULES).sort(), Object.keys(LAYER_CLASSES).sort());
   assert.deepEqual(Object.keys(EVERY_KEY).sort(), Object.keys(LAYER_RULES).sort());
});

test('4.1 validation reads the rules table: every declared key compiles, anything else is refused', () => {
   for (const [type, rule] of Object.entries(LAYER_RULES)) {
      const layer = EVERY_KEY[type];
      const declared = new Set(['type', ...Object.keys(rule.keys)]);
      for (const key of Object.keys(layer)) assert.ok(declared.has(key), `${type} fixture uses undeclared key '${key}'`);
      assert.doesNotThrow(() => Ither.from({ layers: { l: layer } }), type);
      for (const key of ['shape', 'from', 'domains', 'options']) {
         if (declared.has(key)) continue;
         refuses({ layers: { l: { ...layer, [key]: {} } } }, new RegExp(`layer 'l'`), new RegExp(`'${key}'`));
      }
      const options = rule.keys.options?.schema.properties ?? {};
      for (const option of Object.keys(options)) assert.ok(option in (layer.options ?? {}), `${type} fixture omits option '${option}'`);
   }
});

test('4.1 the JSON Schema and capabilities are derived from the same table', () => {
   const schema = formulaSchema();
   assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(FORMULA_RULES).sort());
   const specs = schema.properties.layers.additionalProperties.oneOf;
   const caps = capabilities();
   assert.deepEqual(Object.keys(caps.layerTypes).sort(), Object.keys(LAYER_RULES).sort());
   for (const [type, rule] of Object.entries(LAYER_RULES)) {
      const spec = specs.find(s => s.properties.type.const === type);
      assert.ok(spec, type);
      assert.deepEqual(Object.keys(spec.properties).sort(), ['type', ...Object.keys(rule.keys)].sort(), type);
      assert.deepEqual(
         Object.keys(spec.properties.options?.properties ?? {}).sort(),
         Object.keys(rule.keys.options?.schema.properties ?? {}).sort(),
         `${type} options`,
      );
      assert.deepEqual(caps.layerTypes[type].schema, spec, `${type} capabilities`);
   }
   // AST ranking was accepted by the engine but missing from the hand-kept copies
   assert.ok('ranking' in specs.find(s => s.properties.type.const === 'AST').properties.options.properties);
   assert.equal(caps.combinators.default, COMBINE_DEFAULT);
   assert.deepEqual(caps.combinators.registered, [...Combinators.keys()]);
});

test('4.1 formulas/formula.schema.json is the generated schema, not a hand-kept copy', () => {
   const onDisk = JSON.parse(readFileSync(join(root, 'formulas', 'formula.schema.json'), 'utf8'));
   assert.deepEqual(onDisk, JSON.parse(JSON.stringify(formulaSchema())));
});

//////////////////////////////////////////////////////////////////////////////
// 4.2 reject what is not understood
//////////////////////////////////////////////////////////////////////////////

const obj = () => ({ type: 'OBJ', domains: { p: ['a', 'b'], q: [0, 1] } });

test('4.2 an unknown top-level key is refused, naming it', () => {
   refuses({ layers: { a: obj() }, projectoin: [['a']] }, /'projectoin'/);
});

test('4.2 an unknown layer key is refused, naming the key and the layer', () => {
   refuses({ layers: { a: { ...obj(), shpae: ['p', 'q'] } } }, /'shpae'/, /layer 'a'/);
});

test('4.2 an unknown option is refused, naming the option and the layer', () => {
   refuses({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'] }, options: { maxnodes: 2 } } } }, /'maxnodes'/, /layer 't'/);
});

test('4.2 an option on a type that has none is refused', () => {
   refuses({ layers: { a: { ...obj(), options: { maxNodes: 2 } } } }, /layer 'a'/, /'options'|'maxNodes'/);
});

test('4.2 a projection part naming a variable the layer lacks is refused', () => {
   refuses({
      layers: {
         t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         e: { type: 'STR', from: 't', domains: { x: ['a'], o2: ['f'] } },
      },
      projection: [['t'], ['e.x'], ['e.o2'], ['e.nope']],
   }, /'nope'/, /layer 'e'/);
   refuses({ layers: { a: obj() }, projection: [['a.p'], ['a.q'], ['a.r']] }, /'r'/, /layer 'a'/);
});

test('4.2 malformed values are refused where the table types them', () => {
   refuses({ layers: { a: { type: 'OBJ', domains: 'p:[a,b]' } } }, /layer 'a'/, /domains/);
   refuses({ layers: { a: { type: 'OBJ', domains: { p: [{}] } } } }, /layer 'a'/, /domains/);
   refuses({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'] }, options: { maxNodes: 0 } } } }, /layer 't'/, /maxNodes/);
   refuses({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'], y: ['b'] } } } }, /layer 't'/, /'y'/);
   refuses({ layers: { g: { type: 'LSM', domains: { alphabet: ['F'], extra: ['x'] }, shape: { variables: ['F'], axiom: 'F' }, options: { maxLen: 1 } } } }, /layer 'g'/, /'extra'/);
   refuses({ layers: { a: obj() }, options: { speed: 1 } }, /options/, /'speed'/);
   refuses({ layers: { a: obj() }, projection: [] }, /projection/);
   refuses({ layers: { a: obj() }, projection: [[]] }, /projection/);
});

test('4.2 domains and shape agree: no shape key without a domain, no domain left unused', () => {
   refuses({ layers: { a: { type: 'OBJ', domains: { p: [0, 1] }, shape: ['p', 'q'] } } }, /layer 'a'/, /'q'/);
   refuses({ layers: { a: { type: 'OBJ', domains: { p: [0, 1], q: [0, 1] }, shape: ['p'] } } }, /layer 'a'/, /'q'/);
   refuses({ layers: { a: { type: 'OBJ', domains: { p: [0, 1] }, shape: ['p', 'p'] } } }, /layer 'a'/, /'p'/);
   refuses({ layers: { r: { type: 'ARR', domains: { b: [0, 1], c: [0, 1] }, shape: ['b'] } } }, /layer 'r'/, /'c'/);
   refuses({ layers: { s: { type: 'STR', domains: { a: ['1'], b: ['2'] }, shape: 'a+a' } } }, /layer 's'/, /'b'/);
});

test('4.2 aliases are gone: one name per thing', () => {
   refuses({ layers: { a: obj() }, dimensions: [['a']] }, /'dimensions'/);
   refuses({ layers: { a: obj() }, projection: ['a'] }, /projection/);           // an entry is an array of references
   refuses({ layers: { a: obj() }, projection: [['a.0'], ['a.1']] }, /'0'/);     // an OBJ part is named by its key
   refuses({ layers: { r: { type: 'ARR', domains: { b: [0, 1] }, shape: ['b', 'b'] } }, projection: [['r.b']] }, /'b'/); // an ARR part is a position
   assert.doesNotThrow(() => Ither.from({ layers: { r: { type: 'ARR', domains: { b: [0, 1] }, shape: ['b', 'b'] } }, projection: [['r.0'], ['r.1']] }));

   const space = Ither.from({ layers: { a: obj() } });
   assert.equal('schema' in space, false);
   assert.equal('HOLE' in Space, false);
   assert.equal('OUTSIDE' in Space, false);
   assert.equal('HOLE' in Codec, false);
   assert.equal('OUTSIDE' in Codec, false);
   assert.equal(typeof Ither.HOLE, 'symbol');
   assert.equal(typeof Ither.OUTSIDE, 'symbol');

   const legacyBlob = Codec.toBase64url(JSON.stringify({ v: Ither.version, schema: space.formula }));
   assert.throws(() => Space.unpack(legacyBlob), /schema/);
});

//////////////////////////////////////////////////////////////////////////////
// 4.3 fallbacks become errors
//////////////////////////////////////////////////////////////////////////////

test('4.3 a layer assigned to no axis is refused', () => {
   refuses({ layers: { a: obj(), b: obj() }, projection: [['a']] }, /layer 'b'/);
});

test('4.3 a position of a parted layer assigned to no axis is refused', () => {
   refuses({ layers: { a: obj() }, projection: [['a.p']] }, /layer 'a'/, /'q'/);
   refuses({ layers: { r: { type: 'ARR', domains: { b: [0, 1] }, shape: ['b', 'b', 'b'] } }, projection: [['r.0'], ['r.2']] }, /layer 'r'/, /'1'/);
});

test('4.3 a part assigned to two axes is refused', () => {
   refuses({ layers: { a: obj() }, projection: [['a.p'], ['a.q'], ['a.p']] }, /layer 'a'/, /'p'/);
});

test('4.3 guardrail: a variable of a parted STR assigned to no axis is refused (it used to fall to digit 0)', () => {
   // Today f(a,b) and g(a,b) both encode to [1,1], and [1,1] decodes to f(a,b).
   const formula = {
      layers: {
         t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         e: { type: 'STR', from: 't', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      },
      projection: [['t'], ['e.x']],
   };
   refuses(formula, /layer 'e'/, /'o2'/);
   refuses({ layers: { s: { type: 'STR', domains: { a: ['1', '2'], b: ['3'] }, shape: 'a+b' } }, projection: [['s.a']] }, /layer 's'/, /'b'/);
});

//////////////////////////////////////////////////////////////////////////////
// 4.4 combinators: one global combine, resolved per axis, never replaced
//////////////////////////////////////////////////////////////////////////////

const FAMILIES = ['box', 'gray', 'scramble', 'cantor', 'morton', 'hilbert'];

// Encode every structure of the space into it: distinct coordinates that decode back.
// For a bounded family the coordinates also fill its range exactly.
function assertFamily(space, structures, label, at = null) {
   const seen = new Set();
   for (const structure of structures) {
      const coordinate = space.encode(structure);
      const key = text(coordinate);
      assert.ok(!seen.has(key), `${label}: ${key} names two structures`);
      seen.add(key);
      assert.deepEqual(space.decode(coordinate), structure, `${label}: ${key} does not round-trip`);
      const bounds = space.axisBounds(at ?? coordinate);
      coordinate.forEach((value, axis) => {
         if (bounds[axis] != null) assert.ok(value < bounds[axis], `${label}: ${key} is past its bound`);
      });
   }
   return seen.size;
}

// every structure of a space, read from its box-combined twin
function structuresOf(formula, axes) {
   const box = Ither.from({ ...formula, options: { combine: 'box' } });
   const out = [];
   const total = axes.reduce((p, e) => p * e, 1n);
   for (let n = 0n; n < total; n++) {
      const point = new Array(axes.length);
      let r = n;
      for (let i = axes.length - 1; i >= 0; i--) { point[i] = r % axes[i]; r /= axes[i]; }
      out.push(box.decode(point));
   }
   return out;
}

test('4.4 per-layer options.combine is removed', () => {
   refuses({ layers: { a: { ...obj(), options: { combine: 'gray' } } } }, /layer 'a'/, /'options'|'combine'/);
   refuses({ layers: { t: { type: 'AST', domains: { x: ['a'], o2: ['f'] }, options: { combine: 'gray' } } } }, /layer 't'/, /'combine'/);
});

test('4.4 the global combine is validated against the registry', () => {
   refuses({ layers: { a: obj() }, options: { combine: 'nope' } }, /combine/, /'nope'/);
});

test('4.4 every family as the global combine on a shared axis', () => {
   const formula = {
      layers: { a: { type: 'OBJ', domains: { k: [0, 1, 2, 3] } }, b: { type: 'OBJ', domains: { m: [0, 1, 2, 3] } } },
      projection: [['a', 'b']],
   };
   const structures = structuresOf(formula, [16n]);
   const results = {};
   for (const combine of FAMILIES) {
      const space = Ither.from({ ...formula, options: { combine } });
      const bounded = Combinators.get(combine).bounded;
      assert.deepEqual(space.axisBounds(), [bounded ? 16n : null], combine);
      assert.equal(assertFamily(space, structures, combine), 16, combine);
      results[combine] = structures.map(s => text(space.encode(s))).join('|');
   }
   assert.notEqual(results.box, results.gray, 'the declared family is the one applied');
   assert.notEqual(results.box, results.hilbert);
});

test('4.4 every family as the global combine on a parted OBJ (keys)', () => {
   const formula = {
      layers: { c: { type: 'OBJ', domains: { r: [0, 1], g: [0, 1], b: [0, 1, 2, 3], a: [0, 1, 2, 3] } } },
      projection: [['c.r', 'c.g'], ['c.b', 'c.a']],
   };
   const structures = structuresOf(formula, [4n, 16n]);
   for (const combine of FAMILIES) {
      const space = Ither.from({ ...formula, options: { combine } });
      const bounded = Combinators.get(combine).bounded;
      assert.deepEqual(space.axisBounds(), bounded ? [4n, 16n] : [null, null], combine);
      assert.equal(assertFamily(space, structures, combine), 64, combine);
   }
});

test('4.4 every family as the global combine on a parted STR (byVar)', () => {
   const fixed = {
      layers: { s: { type: 'STR', domains: { a: ['0', '1'], b: ['x', 'y'], c: ['p', 'q', 'r', 's'] }, shape: 'a b c c' } },
      projection: [['s.a', 's.b'], ['s.c']],
   };
   const fixedStructures = structuresOf(fixed, [4n, 16n]);
   for (const combine of FAMILIES) {
      const space = Ither.from({ ...fixed, options: { combine } });
      const bounded = Combinators.get(combine).bounded;
      assert.deepEqual(space.axisBounds(), bounded ? [4n, 16n] : [null, null], combine);
      assert.equal(assertFamily(space, fixedStructures, combine), 64, combine);
   }
   // a chained STR: its slot count follows its template
   const chained = {
      layers: {
         t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 2 } },
         e: { type: 'STR', from: 't', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      },
      projection: [['t'], ['e.x', 'e.o2']],
   };
   // topology 2 is o2(x,o2(x,x)): three leaves and two operators, 32 structures
   const box = Ither.from(chained);
   assert.equal(box.decode([2n, 0n]).t, 'o2(x,o2(x,x))');
   const chainedStructures = Array.from({ length: 32 }, (_, c) => box.decode([2n, BigInt(c)]));
   for (const combine of FAMILIES.filter(f => f !== 'hilbert')) {
      const space = Ither.from({ ...chained, options: { combine } });
      assert.equal(space.axisBounds([2n, 0n])[1], Combinators.get(combine).bounded ? 32n : null, combine);
      assert.equal(assertFamily(space, chainedStructures, combine, [2n, 0n]), 32, combine);
   }
});

test('4.4 a combine that cannot apply is refused, never replaced', () => {
   const shared = (combine, k, m) => ({
      layers: { a: { type: 'OBJ', domains: { k: Array.from({ length: k }, (_, i) => i) } }, b: { type: 'OBJ', domains: { m: Array.from({ length: m }, (_, i) => i) } } },
      projection: [['a', 'b']],
      options: { combine },
   });
   refuses(shared('morton', 3, 4), /morton/, /axis 0/);
   refuses(shared('hilbert', 4, 8), /hilbert/, /axis 0/);
   refuses({
      layers: { a: obj(), b: obj(), c: obj() },
      projection: [['a', 'b', 'c']],
      options: { combine: 'hilbert' },
   }, /hilbert/, /axis 0/);
   // parted slot groups
   refuses({ layers: { c: { type: 'OBJ', domains: { r: [0, 1, 2], g: [0, 1] } } }, projection: [['c.r', 'c.g']], options: { combine: 'morton' } }, /morton/, /axis 0/);
   // a chained layer's slot count on an axis is not fixed, so hilbert cannot be checked
   refuses({
      layers: {
         t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         e: { type: 'STR', from: 't', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
      },
      projection: [['t'], ['e.x', 'e.o2']],
      options: { combine: 'hilbert' },
   }, /hilbert/, /axis 1/);
   // a split has no bound, so only an unbounded family can carry it
   refuses({ layers: { a: obj() }, projection: [['a'], ['a']] }, /layer 'a'/, /split/, /box/);
   refuses({ layers: { a: obj(), b: obj() }, projection: [['a'], ['a', 'b']], options: { combine: 'gray' } }, /split/, /gray/);
   refuses({ layers: { a: obj(), b: obj() }, projection: [['a'], ['a', 'b']], options: { combine: 'scramble' } }, /split/, /scramble/);
   assert.doesNotThrow(() => Ither.from({ layers: { a: obj(), b: obj() }, projection: [['a'], ['a', 'b']], options: { combine: 'cantor' } }));
});

test('4.4 each axis records the combine it resolved to', async () => {
   const { analysis } = await Ither({
      space: { layers: { a: obj(), b: obj() }, projection: [['a', 'b']], options: { combine: 'gray' } },
      analysis: { suite: ['space-axes', 'space-layers'] },
   });
   const axes = analysis.results.find(result => result.type === 'space-axes').metrics.axes;
   assert.deepEqual(axes.map(axis => axis.combine), ['gray']);
   const layers = analysis.results.find(result => result.type === 'space-layers').metrics.layers;
   assert.ok(layers.every(layer => !('combine' in layer)), 'a layer carries no combine of its own');
});

//////////////////////////////////////////////////////////////////////////////
// 4.5 canonical, versioned serialization (revised by 5.0: no fingerprint, any version unpacks)
//////////////////////////////////////////////////////////////////////////////

test('4.5 equal spaces have one canonical formula and pack', () => {
   const terse = { layers: { t: { type: 'AST', domains: { x: ['a', 'b'], o2: ['f'] } }, a: obj() } };
   const explicit = {
      options: { combine: 'box' },
      projection: [['a'], ['t']],
      layers: {
         a: { shape: ['p', 'q'], domains: { q: [0, 1], p: ['a', 'b'] }, type: 'OBJ' },
         t: { options: { ranking: 'leafMinor', maxNodes: 64 }, domains: { o2: ['f'], x: ['a', 'b'] }, type: 'AST' },
      },
   };
   const x = Ither.from(terse);
   const y = Ither.from(explicit);
   assert.equal(x.pack(), y.pack());
   assert.equal(JSON.stringify(x.formula), JSON.stringify(y.formula));
   assert.deepEqual(x.formula.options, { combine: 'box' });
   assert.deepEqual(x.formula.layers.t.options, { maxNodes: 64, ranking: 'leafMinor' });
   assert.deepEqual(x.formula.layers.a.shape, ['p', 'q']);
   assert.deepEqual(x.formula.projection, [['a'], ['t']]);
   assert.notEqual(Ither.from({ ...terse, options: { combine: 'gray' } }).pack(), x.pack());
   assert.equal(Space.unpack(x.pack()).pack(), x.pack());
});

test('5.0 there is no fingerprint', () => {
   const space = Ither.from({ layers: { a: obj() } });
   assert.equal('fingerprint' in space, false);
   assert.equal(existsSync(join(root, 'src', 'formula', 'Fingerprint.js')), false);
   assert.doesNotMatch(JSON.stringify(capabilities().api), /fingerprint/i);
});

const packedAs = (space, change) => Codec.toBase64url(JSON.stringify(change(JSON.parse(Codec.fromBase64url(space.pack())))));

test('5.0 a space records which version packed it: null when compiled from a formula object', () => {
   const space = Ither.from({ layers: { a: obj() } });
   const payload = JSON.parse(Codec.fromBase64url(space.pack()));
   assert.deepEqual(Object.keys(payload).sort(), ['formula', 'v']);
   assert.equal(payload.v, Ither.version);
   assert.equal(space.packedBy, null);
   assert.equal(Space.unpack(space.pack()).packedBy, Ither.version);
});

test('5.0 a payload packed by another version is accepted and indicated, not refused, and nothing is written to the console', () => {
   const space = Ither.from({ layers: { a: obj() } });
   const calls = [];
   const saved = {};
   for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
      saved[method] = console[method];
      console[method] = (...args) => calls.push([method, ...args]);
   }
   let other;
   try {
      other = Space.unpack(packedAs(space, payload => ({ ...payload, v: '0.0.1' })));
   } finally {
      Object.assign(console, saved);
   }
   assert.deepEqual(calls, []);
   assert.equal(other.packedBy, '0.0.1');
   assert.deepEqual(other.formula, space.formula);
   // packing again stamps the version that packs it now
   assert.equal(JSON.parse(Codec.fromBase64url(other.pack())).v, Ither.version);
});

test('5.0 a malformed payload is still refused: not an object, no v, no formula, unknown keys', () => {
   const space = Ither.from({ layers: { a: obj() } });
   const raw = value => Codec.toBase64url(JSON.stringify(value));
   assert.throws(() => Space.unpack(raw([1])), /object/);
   assert.throws(() => Space.unpack(raw('text')), /object/);
   assert.throws(() => Space.unpack(packedAs(space, ({ formula }) => ({ formula }))), /'v'/);
   assert.throws(() => Space.unpack(packedAs(space, ({ v }) => ({ v }))), /'formula'/);
   assert.throws(() => Space.unpack(packedAs(space, payload => ({ ...payload, extra: 1 }))), /'extra'/);
   assert.throws(() => Space.unpack(packedAs(space, payload => ({ ...payload, v: 2 }))), /'v'.*string/);
});

test('5.0 the space analysis reports which version packed the space', async () => {
   const space = Ither.from({ layers: { a: obj() } });
   const other = Space.unpack(packedAs(space, payload => ({ ...payload, v: '0.0.1' })));
   for (const [subject, packedBy] of [[space, null], [other, '0.0.1']]) {
      const { analysis } = await Ither({ space: subject, analysis: { suite: ['space-summary'] } });
      assert.deepEqual(analysis.provenance, { itherVersion: Ither.version, packedBy, mapping: null, manifest: null });
      assert.equal(analysis.results[0].metrics.packedBy, packedBy);
      assert.equal(analysis.results[0].metrics.itherVersion, Ither.version);
      assert.equal('fingerprint' in analysis.results[0].metrics, false);
   }
});

//////////////////////////////////////////////////////////////////////////////
// 4.6 the legacy side channels are gone
//////////////////////////////////////////////////////////////////////////////

test('4.6 a Space has no feedback channel', () => {
   const space = Ither.from({ layers: { a: obj() } });
   assert.equal('feedback' in space, false);
   assert.equal('warnings' in space, false);
   assert.equal('_compilationNotices' in space, false);
   assert.equal(existsSync(join(root, 'src', 'formula', 'Feedback.js')), false);
});

test('4.6 encode takes every layer\'s input and deduces nothing', () => {
   const space = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o2: ['o2'] } },
         pgm: { type: 'STR', from: 'topo', domains: { x: ['&V', '&V4'], o2: ['add', 'mul'] } },
      },
   });
   const full = space.decode([12n, 7n]);
   assert.deepEqual(space.encode(full), [12n, 7n]);
   assert.throws(() => space.encode({ pgm: full.pgm }), /'topo'/);
   assert.throws(() => space.encode({ ...full, extra: 'x' }), /'extra'/);
   assert.equal('reverseTemplate' in space._engine.layers[1], false);
});

test('4.6 the formula tier writes nothing to the console', () => {
   const dir = join(root, 'src', 'formula');
   for (const file of readdirSync(dir)) {
      assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /console\./, file);
   }
});

//////////////////////////////////////////////////////////////////////////////
// 4.7 the engine: internal, and only what the formula needs
//////////////////////////////////////////////////////////////////////////////

test('4.7 the engine keeps only what compilation uses', () => {
   for (const name of ['strToObj', 'strToArr', 'intToMixed', 'mixedToInt', 'sanitizeSchema', 'stringifySchema', 'parseSchema', 'packSchema', 'unpackSchema', 'unpack']) {
      assert.equal(name in Engine, false, `Engine.${name}`);
   }
   for (const name of ['pack', 'unpack', 'pop', 'push', 'pushLayer', 'toLayer']) {
      assert.equal(name in Engine.prototype, false, `engine.${name}`);
   }
   const space = Ither.from({ layers: { a: obj() } });
   for (const name of ['ither', 'layers', 'mapping']) assert.equal(name in space, false, `space.${name}`);
});

//////////////////////////////////////////////////////////////////////////////
// 4.8 one canonical route to facts about a space
//////////////////////////////////////////////////////////////////////////////

test('4.8 the space analysis reports why each axis has the bound it has', async () => {
   const { analysis } = await Ither({
      space: {
         layers: {
            o: { type: 'OBJ', domains: { k: [0, 1, 2] } },
            t: { type: 'AST', domains: { x: ['x'], o2: ['o2'] }, options: { maxNodes: 3 } },
            s: { type: 'OBJ', domains: { v: [0, 1, 2, 3] } },
            e: { type: 'STR', from: 't', domains: { x: ['a', 'b'], o2: ['f', 'g'] } },
         },
         projection: [['o'], ['t'], ['s'], ['s'], ['e']],
         options: { combine: 'cantor' },
      },
      analysis: { suite: ['space-summary', 'space-axes'] },
   });
   const byType = type => analysis.results.find(result => result.type === type).metrics;
   assert.equal(byType('space-summary').finite, false);
   const axes = byType('space-axes').axes;
   assert.deepEqual(axes.map(axis => axis.boundReason), ['fixed', 'capped', 'sparse', 'sparse', 'dependent']);
   assert.deepEqual(axes.map(axis => axis.bound), [3n, null, null, null, null]);
});

test('the formula bank: every registered file exists, and every formula file is registered', async () => {
   const { registry } = await import('../formulas/bank.mjs');
   const bankDir = join(root, 'formulas');
   const entries = (await registry()).formulas;
   const registered = new Set(entries.map(entry => entry.file));
   for (const file of registered) assert.ok(existsSync(join(bankDir, file)), `registered but missing: ${file}`);
   const onDisk = readdirSync(bankDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(dir => readdirSync(join(bankDir, dir.name)).filter(name => name.endsWith('.json')).map(name => `${dir.name}/${name}`));
   assert.deepEqual(onDisk.filter(file => !registered.has(file)), [], 'formula files missing from registry.json');
   assert.equal(new Set(entries.map(entry => entry.name)).size, entries.length, 'names are unique');
});
