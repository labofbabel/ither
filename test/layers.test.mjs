// Layers, chains and combines through the public Space — the core checks kept from the
// decommissioned pre-tier equivalence suite, rewritten against
// the tier contracts.
//
// The golden coordinates pin the mapping itself. A change that moves one is a breaking
// drift for every saved dataset: it must be deliberate, versioned, and said in CHANGELOG.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Ither, Codec } from '../src/index.js';
import { Combinator, Combinators } from '../src/formula/Combinators.js';

const text = value => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));
const one = (layer, extra = {}) => Ither.from({ layers: { l: layer }, ...extra });

// every coordinate of a one-axis space in [0, n): distinct structures that encode back
function assertBijective(space, n) {
   const seen = new Set();
   for (let c = 0n; c < n; c++) {
      const structure = space.decode([c]);
      assert.notEqual(structure, Ither.OUTSIDE, `${c} is inside`);
      assert.deepEqual(space.encode(structure), [c], `${c} round-trips`);
      seen.add(text(structure));
   }
   assert.equal(seen.size, Number(n), 'distinct structures');
}

//////////////////////////////////////////////////////////////////////////////
// golden coordinates
//////////////////////////////////////////////////////////////////////////////

const GOLDEN = [
   ['AST', { type: 'AST', domains: { x: ['F', 'I', 'F.x', 'I.y', 'I.x', '1.0', '0.0', '2.0', '3.0', '4.0', '5.0', '6.0', '7.0', '8.0', 'F.y'], o1: ['nrm', 'sin'], o2: ['dot', 'add', 'sub'], o3: ['mix'] } }, 'mix(dot(nrm(F), I), F.x, 1.0)', 2541420035n],
   ['AST', { type: 'AST', domains: { x: ['a', 'b', 'c', '0', '1'], o2: ['add', 'mul', 'sub'] } }, 'add(mul(a,b),c)', 1337n],
   ['OBJ', { type: 'OBJ', shape: ['frq', 'amp'], domains: { frq: [1.0, 2.0, 4.0, 8.0], amp: [0.5, 0.25, 0.0625] } }, { frq: 2, amp: 0.5 }, 3n],
   ['ARR', { type: 'ARR', shape: ['a', 'b', 'c', 'd', 'a'], domains: { a: [1, 2, 3], b: [4, 5, 6], c: [5, 7, 8, 9], d: [9, 11, 32] } }, [2, 4, 5, 11, 3], 113n],
   ['STR', { type: 'STR', shape: '(a + b) * c == d', domains: { a: ['1', '2', '3'], b: ['4', '5', '6'], c: ['5', '7', '8', '9'], d: ['9', '11', '32'] } }, '(2 + 4) * 5 == 9', 36n],
];

test('golden coordinates: the mapping of each layer type is pinned', () => {
   for (const [type, layer, structure, coordinate] of GOLDEN) {
      const space = one(layer);
      assert.deepEqual(space.encode({ l: structure }), [coordinate], type);
      assert.deepEqual(space.encode(space.decode([coordinate])), [coordinate], `${type} round-trips`);
   }
});

test('domain key order does not change a coordinate; the order within a domain does', () => {
   const ast = domains => one({ type: 'AST', domains }).encode({ l: 'add(neg(a),b)' })[0];
   assert.equal(ast({ x: ['a', 'b'], o1: ['neg'], o2: ['add'], o3: ['mix'] }), ast({ o3: ['mix'], o2: ['add'], o1: ['neg'], x: ['a', 'b'] }));
   const obj = domains => one({ type: 'OBJ', shape: ['p', 'q'], domains }).encode({ l: { p: 2, q: 3 } })[0];
   assert.equal(obj({ p: [1, 2], q: [3, 4] }), obj({ q: [3, 4], p: [1, 2] }));
   const ops = o2 => one({ type: 'AST', domains: { x: ['a', 'b'], o2 } }).encode({ l: 'add(a,b)' })[0];
   assert.notEqual(ops(['add', 'mul']), ops(['mul', 'add']));
});

//////////////////////////////////////////////////////////////////////////////
// layer types
//////////////////////////////////////////////////////////////////////////////

test('Kleene ranking is a bijection', () => {
   const total = Codec.kleeneCount(4, 4);
   for (let i = 0n; i < total; i++) assert.equal(Codec.kleeneRank(Codec.kleeneUnrank(i, 4, 4), 4, 4), i);
});

test('AST ranking modes are each bijective, and order structures differently', () => {
   const domains = { x: ['a', 'b', 'c'], o2: ['+', '*'] };
   const [minor, leafMajor, opMajor] = [undefined, 'leafMajor', 'opMajor'].map(ranking =>
      one({ type: 'AST', domains, ...(ranking ? { options: { ranking } } : {}) }));
   for (const space of [minor, leafMajor, opMajor]) {
      const seen = new Set();
      for (let c = 0n; c < 60n; c++) {
         const structure = space.decode([c]);
         assert.deepEqual(space.encode(structure), [c]);
         seen.add(structure.l);
      }
      assert.equal(seen.size, 60);
   }
   const at = (space, c) => space.decode([c]).l;
   assert.ok(at(leafMajor, 21n).startsWith('+(') && at(leafMajor, 29n).startsWith('+(a,') && at(leafMajor, 30n).startsWith('+(b,'), 'leafMajor: an outer leaf moves after the inner leaves');
   assert.ok(at(opMajor, 3n).startsWith('+(') && at(opMajor, 4n).startsWith('*('), 'opMajor: +1 flips the operator');
   assert.ok(at(minor, 3n).startsWith('+(') && at(minor, 4n).startsWith('+('), 'leafMinor: +1 changes the rightmost leaf');
});

test('LSM: a grammar round-trips, and a small grammar space is bijective', () => {
   const lsm = one({ type: 'LSM', shape: { variables: ['F'], axiom: 'F' }, domains: { alphabet: ['F', '+', '-'] }, options: { maxLen: 5 } });
   assert.deepEqual(lsm.decode(lsm.encode({ l: { F: 'F+F-F' } })), { l: { F: 'F+F-F' } });
   assertBijective(one({ type: 'LSM', shape: { variables: ['A', 'B'], axiom: 'A' }, domains: { alphabet: ['A', 'B'] }, options: { maxLen: 2 } }), 49n);
});

test('TRI: Catalan-sized and bijective for n = 3..7', () => {
   const catalan = { 3: 1n, 4: 2n, 5: 5n, 6: 14n, 7: 42n };
   for (const [n, size] of Object.entries(catalan)) {
      const space = one({ type: 'TRI', shape: { n: Number(n) } });
      assert.equal(space.cardinality, size);
      assertBijective(space, size);
   }
   assert.equal(one({ type: 'TRI', shape: { n: 6 } }).decode([10n]).l.length, 4, 'a hexagon has n - 2 triangles');
   assert.throws(() => one({ type: 'TRI', shape: { n: 2 } }));
});

test('PERM: Lehmer-ranked and bijective; a permutation is an ordering lever', () => {
   const perm = one({ type: 'PERM', shape: { n: 4 } });
   assert.deepEqual(perm.decode([0n]).l, [0, 1, 2, 3]);
   assert.deepEqual(perm.decode([23n]).l, [3, 2, 1, 0]);
   assertBijective(perm, 24n);
   assert.deepEqual(perm.decode(perm.encode({ l: [2, 0, 3, 1] })).l, [2, 0, 3, 1]);
   assert.throws(() => perm.encode({ l: [0, 0, 1, 2] }), /layer 'l'/);
   const dom = ['a', 'b', 'c', 'd'];
   const coordinateOfC = order => one({ type: 'OBJ', shape: ['k'], domains: { k: order.map(i => dom[i]) } }).encode({ l: { k: 'c' } })[0];
   assert.notEqual(coordinateOfC(perm.decode([0n]).l), coordinateOfC(perm.decode([10n]).l));
});

test('NUM: mins at 0, maxes at the end, and parting at any number of steps', () => {
   const num = one({ type: 'NUM', domains: { frq: { min: 0, max: 1, steps: 5 }, amp: { min: 0, max: 10, steps: 11 } } });
   assert.equal(num.cardinality, 55n);
   assert.deepEqual(num.decode([0n]).l, { amp: 0, frq: 0 });
   assert.deepEqual(num.decode([54n]).l, { amp: 10, frq: 1 });
   assert.deepEqual(num.encode(num.decode([27n])), [27n]);

   const big = Ither.from({ layers: { p: { type: 'NUM', domains: { frq: { min: 0, max: 1, steps: 128 }, amp: { min: 0, max: 1, steps: 128 } } } }, projection: [['p.frq'], ['p.amp']] });
   assert.deepEqual(big.axisBounds(), [128n, 128n]);
   for (const coordinate of [[0n, 0n], [127n, 127n], [64n, 3n], [5n, 100n]]) assert.deepEqual(big.encode(big.decode(coordinate)), coordinate);
});

test('an OBJ parted by key across two axes is bijective over the grid', () => {
   const space = Ither.from({
      layers: { o: { type: 'OBJ', shape: ['frq', 'amp', 'ofx', 'ofy'], domains: { frq: [1.0, 2.0, 4.0, 8.0], amp: [0.5, 0.25, 0.0625], ofx: [0, 1], ofy: [0, 1] } } },
      projection: [['o.frq', 'o.amp'], ['o.ofx', 'o.ofy']],
   });
   assert.deepEqual(space.axisBounds(), [12n, 4n]);
   const seen = new Set();
   for (let a = 0n; a < 12n; a++) for (let b = 0n; b < 4n; b++) {
      const structure = space.decode([a, b]);
      assert.deepEqual(space.encode(structure), [a, b]);
      seen.add(text(structure));
   }
   assert.equal(seen.size, 48);
});

//////////////////////////////////////////////////////////////////////////////
// chains
//////////////////////////////////////////////////////////////////////////////

test('an AST topology chained into a STR substitution round-trips, with the topology fixed while the substitution varies', () => {
   const space = Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o1: ['o1'], o2: ['o2'], o3: ['o3'] } },
         fill: { type: 'STR', from: 'topo', domains: { x: ['F', 'I', '1.0'], o1: ['nrm', 'sin'], o2: ['dot', 'add'], o3: ['mix'] } },
      },
   });
   const structure = space.decode([5n, 10n]);
   assert.deepEqual(space.encode(structure), [5n, 10n]);
   assert.equal(space.decode([5n, 0n]).topo, space.decode([5n, 3n]).topo);
});

test('an LSM chained into a STR round-trips', () => {
   const space = Ither.from({
      layers: {
         plant: { type: 'LSM', shape: { variables: ['F'], axiom: 'F' }, domains: { alphabet: ['F', '+', '-'] }, options: { maxLen: 4, iterations: 2 } },
         shape: { type: 'STR', from: 'plant', domains: { F: ['Fa', 'Fb'] } },
      },
   });
   const structure = space.decode([100n, 7n]);
   assert.match(structure.shape, /Fa|Fb/);
   assert.deepEqual(space.encode(structure), [100n, 7n]);
});

test('a 4-deep cascade is a bijection over its resolved ranges, independent of layer key order', () => {
   const cascade = {
      layers: {
         s0: { type: 'STR', shape: 'AB', domains: { A: ['a', 'b', 'c'], B: ['a', 'b', 'c'] } },
         s1: { type: 'STR', from: 's0', domains: { a: ['p', 'q'], b: ['p', 'q'], c: ['p', 'q'] } },
         s2: { type: 'STR', from: 's1', domains: { p: ['x', 'y'], q: ['x', 'y'] } },
         s3: { type: 'STR', from: 's2', domains: { x: ['1', '2'], y: ['1', '2'] } },
      },
   };
   const space = Ither.from(cascade);
   assert.deepEqual(space.layerNames, ['s0', 's1', 's2', 's3']);
   assert.deepEqual(space.axisBounds(), [9n, null, null, null]);
   const at = (...c) => space.axisBounds([...c, ...new Array(4 - c.length).fill(0n)])[c.length];
   const seen = new Set();
   for (let a = 0n; a < at(); a++) for (let b = 0n; b < at(a); b++) for (let c = 0n; c < at(a, b); c++) for (let d = 0n; d < at(a, b, c); d++) {
      const structure = space.decode([a, b, c, d]);
      assert.deepEqual(space.encode(structure), [a, b, c, d]);
      seen.add(text(structure));
   }
   assert.equal(seen.size, 576);

   const shuffled = Ither.from({ layers: { s2: cascade.layers.s2, s3: cascade.layers.s3, s0: cascade.layers.s0, s1: cascade.layers.s1 } });
   for (const coordinate of [[1n, 1n, 1n, 1n], [8n, 3n, 2n, 1n]]) assert.deepEqual(shuffled.decode(coordinate), space.decode(coordinate));
});

test('a formula whose structures are formulas: a decoded one compiles and runs', () => {
   const meta = Ither.from({ layers: { formula: { type: 'STR', shape: '{"layers":{"g":{"type":"NUM","domains":{"v":{"min":0,"max":MX,"steps":STP}}}}}', domains: { MX: ['1', '10'], STP: ['8', '16', '32'] } } } });
   const child = Ither.from(JSON.parse(meta.decode([3n]).formula));
   assert.equal(child.axisCount, 1);
   assert.equal(typeof child.decode([2n]).g.v, 'number');
});

//////////////////////////////////////////////////////////////////////////////
// combines
//////////////////////////////////////////////////////////////////////////////

const shared = combine => Ither.from({
   layers: { a: { type: 'OBJ', domains: { k: [0, 1, 2, 3, 4, 5, 6, 7] } }, b: { type: 'OBJ', domains: { m: [0, 1, 2, 3, 4, 5, 6, 7] } } },
   projection: [['a', 'b']],
   options: { combine },
});

test('box, gray and scramble are contiguous bijections; gray moves one source by one per step', () => {
   for (const combine of ['box', 'gray', 'scramble']) {
      const space = shared(combine);
      assert.deepEqual(space.axisBounds(), [64n], combine);
      assertBijective(space, 64n);
   }
   const gray = shared('gray');
   for (let n = 0n; n < 63n; n++) {
      const x = gray.decode([n]);
      const y = gray.decode([n + 1n]);
      assert.equal(Math.abs(x.a.k - y.a.k) + Math.abs(x.b.m - y.b.m), 1, `step ${n}`);
   }
});

test('scramble decorrelates every source instead of preserving mixed-radix strides', () => {
   const family = Combinators.get('scramble');
   const cards = [3n, 5n, 7n];
   const total = 105n;
   const seen = new Set();
   const deltas = cards.map(() => new Set());

   for (let a = 0n; a < cards[0]; a++) for (let b = 0n; b < cards[1]; b++) for (let c = 0n; c < cards[2]; c++) {
      const values = [a, b, c];
      const packed = family.pack(values, cards);
      assert.ok(packed >= 0n && packed < total);
      assert.deepEqual(family.unpack(packed, cards), values);
      seen.add(packed.toString());
      for (let source = 0; source < cards.length; source++) {
         if (values[source] + 1n === cards[source]) continue;
         const next = [...values];
         next[source]++;
         deltas[source].add(((family.pack(next, cards) - packed + total) % total).toString());
      }
   }

   assert.equal(seen.size, Number(total), 'the complete finite product is a bijection');
   deltas.forEach((steps, source) => assert.ok(steps.size > 1, `source ${source} must not keep one modular stride`));
   assert.deepEqual(
      [[0n, 0n, 0n], [0n, 0n, 1n], [1n, 2n, 3n], [2n, 4n, 6n]].map(values => family.pack(values, cards)),
      [104n, 21n, 59n, 57n],
      'the cardinality-derived ordering is stable across processes and runtimes',
   );
});

test('scramble does not leave short-period bands in two 16-value sources', () => {
   const family = Combinators.get('scramble');
   const cards = [16n, 16n];
   const sequence = Array.from({ length: 256 }, (_, coordinate) => family.unpack(BigInt(coordinate), cards));

   for (let source = 0; source < cards.length; source++) {
      const repeats = [];
      for (let lag = 1; lag <= 16; lag++) {
         let count = 0;
         for (let i = 0; i + lag < sequence.length; i++) {
            if (sequence[i][source] === sequence[i + lag][source]) count++;
         }
         repeats.push(count);
      }
      // A balanced 16-value sequence expects about 16 matches at each lag. The old
      // low-bit round function reached 86 at lag 4, visible as bands in colour grids.
      assert.ok(Math.max(...repeats) <= 32, `source ${source} has a short-period repeat: ${repeats}`);
   }
});

test('a registered combinator applies as the formula\'s combine, and one that names no structure yields holes', () => {
   class EvenHole extends Combinator {
      get key() { return 'evenhole-test'; }
      get holes() { return true; }
      bound(cards) { return 2n * cards.reduce((p, c) => p * c, 1n); } // a padded range
      pack(values, cards) { let a = 0n; for (let i = 0; i < values.length; i++) a = a * cards[i] + values[i]; return 2n * a; }
      unpack(value, cards) {
         if (value % 2n === 1n) return Ither.HOLE;
         const out = new Array(cards.length);
         let r = value / 2n;
         for (let k = cards.length - 1; k >= 0; k--) { out[k] = r % cards[k]; r /= cards[k]; }
         return out;
      }
   }
   Combinators.set('evenhole-test', new EvenHole());
   try {
      const space = Ither.from({ layers: { a: { type: 'OBJ', domains: { k: [0, 1, 2] } }, b: { type: 'OBJ', domains: { m: [0, 1, 2, 3] } } }, projection: [['a', 'b']], options: { combine: 'evenhole-test' } });
      assert.deepEqual(space.axisBounds(), [24n]);
      for (let n = 0n; n < 24n; n++) {
         const structure = space.decode([n]);
         if (n % 2n === 1n) assert.equal(structure, Ither.HOLE);
         else assert.deepEqual(space.encode(structure), [n]);
      }
   } finally {
      Combinators.delete('evenhole-test');
   }
});

test('the combine applies to a chained STR parted by variable, and stays exact', () => {
   const make = combine => Ither.from({
      layers: {
         topo: { type: 'AST', domains: { x: ['x'], o1: ['o1'], o2: ['o2'] }, options: { maxNodes: 8 } },
         fill: { type: 'STR', from: 'topo', domains: { x: ['0', '1', '2', '3'], o1: ['neg', 'abs'], o2: ['add', 'sub', 'mlt', 'div'] } },
      },
      projection: [['topo'], ['fill.o1', 'fill.o2'], ['fill.x']],
      options: { combine },
   });
   const Z = 6n; // o2(x,o2(x,x)): two operator slots (16 values), three leaf slots (64)
   const operators = fill => fill.match(/add|sub|mlt|div|neg|abs/g) || [];
   const multiSymbolSteps = space => {
      let previous = null;
      let steps = 0;
      for (let x = 0n; x < 16n; x++) {
         const current = operators(space.decode([Z, x, 0n]).fill);
         if (previous && current.filter((op, i) => op !== previous[i]).length > 1) steps++;
         previous = current;
      }
      return steps;
   };
   assert.equal(make('box').decode([Z, 0n, 0n]).topo, 'o2(x,o2(x,x))');
   assert.ok(multiSymbolSteps(make('box')) > 0);
   assert.equal(multiSymbolSteps(make('gray')), 0);
   assert.ok(multiSymbolSteps(make('scramble')) > 0);
   for (const combine of ['box', 'gray', 'scramble']) {
      const space = make(combine);
      for (let X = 0n; X < 16n; X++) for (let Y = 0n; Y < 64n; Y += 7n) assert.deepEqual(space.encode(space.decode([Z, X, Y])), [Z, X, Y], combine);
   }
});
