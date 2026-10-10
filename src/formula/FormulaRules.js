// Ither — FormulaRules
// The one definition of what a formula may contain. Three things are derived from it
// and nothing else describes a formula's keys:
//
//   validateFormula(formula)   refuses anything the table does not declare, naming the
//                              key and the layer, and returns the canonical formula
//   formulaSchema()            the JSON Schema (src/Capabilities.js; generated copy at
//                              formulas/formula.schema.json)
//   capabilities().layerTypes  the per-type description (src/Capabilities.js)
//
// The table is written in a small subset of JSON Schema (type, const, enum, minimum,
// minLength, minItems, minProperties, required, properties, patternProperties,
// additionalProperties, items, default, description). `checkValue` below interprets
// exactly that subset, so the schema a client reads is the schema the library enforces.
//
// What a schema cannot say — that a shape names only declared domains, that a projection
// references a real layer or part — is checked in validateFormula, after the table.

import { Combinators } from './Combinators.js';
import { STRLayer } from './STRLayer.js';

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const COMBINE_DEFAULT = 'box';

// the layer types whose decoded value is a string a chained STR can take as its template
const CHAIN_SOURCES = ['AST', 'STR', 'LSM'];

//////////////////////////////////////////////////////////////////////////
// THE TABLE
//////////////////////////////////////////////////////////////////////////

const domainValues = {
   type: 'array',
   items: { type: ['string', 'number', 'boolean'] },
   description: 'the choices, in order',
};
const listDomains = {
   type: 'object',
   additionalProperties: domainValues,
   description: 'named lists of choices',
};
const keyList = (description) => ({ type: 'array', items: { type: 'string' }, minItems: 1, description });

// Per layer type: what it is, and every key it accepts besides `type`. A key's
// `required` says whether a formula must give it; defaults live on option properties
// (a literal `default`) or in `derivedDefault` (computed from the layer, e.g. a shape).
export const LAYER_RULES = {
   AST: {
      role: 'expression trees, topology + per-node symbol ranked jointly (decorated Schröder)',
      cardinality: 'sum count(k) for 0 ≤ k ≤ maxNodes (a cap, never reported as a bound)',
      parting: null,
      keys: {
         domains: {
            required: true,
            schema: {
               type: 'object', required: ['x'], minProperties: 2,
               properties: { x: { ...domainValues, description: 'leaf symbols' } },
               patternProperties: { '^o\\d+$': { ...domainValues, description: 'operator symbols of arity n (o1, o2, …)' } },
               additionalProperties: false,
               description: "an 'x' leaf domain and at least one operator domain",
            },
         },
         options: {
            required: false,
            schema: {
               type: 'object', additionalProperties: false,
               properties: {
                  maxNodes: { type: 'integer', minimum: 1, default: 64, description: 'cap on internal-node count — a guardrail, not a bound: coordinates past it decode to OUTSIDE' },
                  ranking: { type: 'string', enum: ['leafMinor', 'leafMajor', 'opMajor'], default: 'leafMinor', description: 'digit layout within a tree size: which choices a +1 cycles first' },
               },
            },
         },
      },
   },
   OBJ: {
      role: 'key/value objects (type-coerced on decode)',
      cardinality: 'product of domain sizes',
      parting: 'keys',
      keys: {
         domains: { required: true, schema: listDomains },
         shape: { required: false, derivedDefault: 'sorted domain keys', schema: keyList('the order of the keys: every domain key, once') },
      },
   },
   ARR: {
      role: 'fixed-shape arrays (type-coerced on decode)',
      cardinality: 'product of domain sizes per shape position',
      parting: 'positions',
      keys: {
         domains: { required: true, schema: listDomains },
         shape: { required: true, schema: keyList('the domain of each position; entries may repeat, every domain is used') },
      },
   },
   STR: {
      role: 'fill-in templates (string output)',
      cardinality: 'product of slot radices (resolved per template when chained)',
      parting: 'variables',
      exactlyOne: ['shape', 'from'],
      keys: {
         domains: { required: true, schema: listDomains },
         shape: { required: false, schema: { type: 'string', minLength: 1, description: 'template; tokens matching domain keys are variable slots, and every domain key appears' } },
         from: { required: false, schema: { type: 'string', minLength: 1, description: 'name of an upstream layer whose decoded result is this template (chaining)' } },
      },
   },
   LSM: {
      role: 'L-system grammar space',
      cardinality: 'kleeneCount(|alphabet|, maxLen) ^ |variables| (a cap, never reported as a bound)',
      parting: null,
      keys: {
         domains: {
            required: true,
            schema: {
               type: 'object', required: ['alphabet'], additionalProperties: false,
               properties: { alphabet: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'the symbols' } },
            },
         },
         shape: {
            required: true,
            schema: {
               type: 'object', required: ['variables', 'axiom'], additionalProperties: false,
               properties: {
                  variables: keyList('symbols with a production'),
                  axiom: { type: 'string', description: 'the start string' },
               },
            },
         },
         options: {
            required: true,
            schema: {
               type: 'object', required: ['maxLen'], additionalProperties: false,
               properties: {
                  maxLen: { type: 'integer', minimum: 0, description: 'cap on each production length — a guardrail, not a bound' },
                  iterations: { type: 'integer', minimum: 0, default: 2, description: 'derivation depth of the string a chained layer takes' },
               },
            },
         },
      },
   },
   TRI: {
      role: 'triangulations of a convex polygon',
      cardinality: 'Catalan(n − 2)',
      parting: null,
      keys: {
         shape: {
            required: true,
            schema: { type: 'object', required: ['n'], additionalProperties: false, properties: { n: { type: 'integer', minimum: 3, description: 'polygon vertex count' } } },
         },
      },
   },
   NUM: {
      role: 'quantized real-valued axes',
      cardinality: 'product of steps',
      parting: 'keys',
      keys: {
         domains: {
            required: true,
            schema: {
               type: 'object',
               additionalProperties: {
                  type: 'object', required: ['min', 'max', 'steps'], additionalProperties: false,
                  properties: { min: { type: 'number' }, max: { type: 'number' }, steps: { type: 'integer', minimum: 1 } },
               },
               description: 'named ranges { min, max, steps }',
            },
         },
         shape: { required: false, derivedDefault: 'sorted domain keys', schema: keyList('the order of the keys: every domain key, once') },
      },
   },
   PERM: {
      role: 'permutations of [0, n) via Lehmer code',
      cardinality: 'n!',
      parting: null,
      keys: {
         shape: {
            required: true,
            schema: { type: 'object', required: ['n'], additionalProperties: false, properties: { n: { type: 'integer', minimum: 1 } } },
         },
      },
   },
};

// The formula itself. `layers` is described per type above.
export const FORMULA_RULES = {
   layers: {
      required: true,
      schema: { type: 'object', minProperties: 1, description: 'Named layer specs. Names are user-chosen; resolution order follows `from`.' },
   },
   projection: {
      required: false,
      derivedDefault: 'one axis per layer, in resolution order',
      schema: {
         type: 'array', minItems: 1,
         items: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
         description: 'Output axes in order — entry i is axis i, an array of references. Several references on one entry share that axis (combined by options.combine). A layer named in several entries is split across them (unbounded combine only). "layer.part" parts a layer: an OBJ/NUM key, an ARR position index, or an STR variable; every part of a parted layer is assigned exactly once. Every layer is assigned.',
      },
   },
   options: {
      required: false,
      schema: {
         type: 'object', additionalProperties: false,
         properties: {
            combine: {
               type: 'string',
               get enum() { return [...Combinators.keys()]; },
               default: COMBINE_DEFAULT,
               description: 'how several sources share one axis, for every axis of the space (and how a split divides a layer)',
            },
         },
      },
   },
};

//////////////////////////////////////////////////////////////////////////
// INTERPRETING THE TABLE
//////////////////////////////////////////////////////////////////////////

const fail = (message) => { throw new Error(`Space: ${message}`); };
const list = values => values.map(v => `'${v}'`).join(', ');
const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

function isType(value, type) {
   switch (type) {
      case 'object': return isPlainObject(value);
      case 'array': return Array.isArray(value);
      case 'string': return typeof value === 'string';
      case 'integer': return Number.isInteger(value);
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      case 'boolean': return typeof value === 'boolean';
      default: throw new Error(`FormulaRules: unknown type '${type}'`);
   }
}

// Check `value` against a schema of the subset above. `where` names the place in words
// ("layer 'a' options"), so every refusal names the key and the layer.
export function checkValue(value, schema, where) {
   if (schema.const !== undefined && value !== schema.const) fail(`${where} must be ${JSON.stringify(schema.const)}`);
   if (schema.type) {
      const types = [].concat(schema.type);
      if (!types.some(type => isType(value, type))) fail(`${where} must be ${types.join(' or ')} (got ${JSON.stringify(value)})`);
   }
   if (schema.enum && !schema.enum.includes(value)) fail(`${where} is ${typeof value === 'string' ? `'${value}'` : JSON.stringify(value)}; expected one of ${list(schema.enum)}`);
   if (typeof value === 'string' && schema.minLength != null && value.length < schema.minLength) fail(`${where} must not be empty`);
   if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) fail(`${where} must be at least ${schema.minimum} (got ${value})`);
   if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) fail(`${where} must have at least ${schema.minItems} entr${schema.minItems === 1 ? 'y' : 'ies'}`);
      if (schema.items) value.forEach((item, i) => checkValue(item, schema.items, `${where}[${i}]`));
   }
   if (isPlainObject(value) && (schema.properties || schema.patternProperties || schema.additionalProperties !== undefined || schema.required)) {
      for (const key of schema.required ?? []) {
         if (!hasOwn(value, key)) fail(`${where} is missing '${key}'`);
      }
      const patterns = Object.entries(schema.patternProperties ?? {}).map(([p, s]) => [new RegExp(p), s]);
      for (const key of Object.keys(value)) {
         const at = `${where} '${key}'`;
         if (schema.properties && hasOwn(schema.properties, key)) { checkValue(value[key], schema.properties[key], at); continue; }
         const pattern = patterns.find(([re]) => re.test(key));
         if (pattern) { checkValue(value[key], pattern[1], at); continue; }
         if (schema.additionalProperties === false) {
            const allowed = [...Object.keys(schema.properties ?? {}), ...Object.keys(schema.patternProperties ?? {}).map(p => `/${p}/`)];
            fail(`${where}: unknown key '${key}'${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ' (it takes none)'}`);
         }
         if (schema.additionalProperties) checkValue(value[key], schema.additionalProperties, at);
      }
   }
   if (isPlainObject(value) && schema.minProperties != null && Object.keys(value).length < schema.minProperties) {
      fail(`${where} must have at least ${schema.minProperties} entr${schema.minProperties === 1 ? 'y' : 'ies'}${schema.description ? ` (${schema.description})` : ''}`);
   }
}

// Keys of an object checked against a { key: { required, schema } } rule map.
function checkKeys(value, rules, where, extra = []) {
   if (!isPlainObject(value)) fail(`${where} must be an object`);
   const allowed = [...extra, ...Object.keys(rules)];
   for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) fail(`${where}: unknown key '${key}' (allowed: ${allowed.join(', ')})`);
   }
   for (const [key, rule] of Object.entries(rules)) {
      if (!hasOwn(value, key)) {
         if (rule.required) fail(`${where} is missing '${key}'`);
         continue;
      }
      checkValue(value[key], rule.schema, `${where} ${key}`);
   }
}

// An option object with every declared default written in.
function withDefaults(given, schema) {
   const out = {};
   for (const [name, property] of Object.entries(schema.properties)) {
      if (given && hasOwn(given, name)) out[name] = given[name];
      else if (property.default !== undefined) out[name] = property.default;
   }
   return out;
}

//////////////////////////////////////////////////////////////////////////
// THE FORMULA
//////////////////////////////////////////////////////////////////////////

// Validate a formula and return its canonical form: object keys in code-unit order,
// every default written in (options, an OBJ/NUM shape, the identity projection), and
// layers named in resolution order within `layerNames`. Equal spaces have equal
// canonical forms, which is what `pack` is made from.
export function validateFormula(formula) {
   checkKeys(formula, FORMULA_RULES, 'formula');
   const names = Object.keys(formula.layers);
   for (const name of names) validateLayer(name, formula.layers[name], formula.layers);

   const layerNames = resolutionOrder(formula.layers);
   const layers = {};
   for (const name of [...names].sort(byCodeUnit)) layers[name] = canonicalLayer(formula.layers[name]);
   const projection = formula.projection ?? layerNames.map(name => [name]);
   checkProjection(projection, layers);

   const canonical = sortKeysDeep({
      layers,
      options: withDefaults(formula.options, FORMULA_RULES.options.schema),
      projection: structuredClone(projection),
   });
   return { formula: canonical, layerNames };
}

function validateLayer(name, layer, all) {
   const where = `layer '${name}'`;
   if (!isPlainObject(layer)) fail(`${where} must be an object`);
   if (!hasOwn(LAYER_RULES, layer.type)) {
      fail(`${where} has unknown type ${JSON.stringify(layer.type)} (expected ${Object.keys(LAYER_RULES).join(', ')})`);
   }
   const rule = LAYER_RULES[layer.type];
   checkKeys(layer, rule.keys, `${where} (${layer.type})`, ['type']);
   if (rule.exactlyOne && rule.exactlyOne.filter(key => hasOwn(layer, key)).length !== 1) {
      fail(`${where} needs exactly one of ${list(rule.exactlyOne)}`);
   }

   if (hasOwn(layer, 'from')) {
      if (!hasOwn(all, layer.from)) fail(`${where} chains from unknown layer '${layer.from}'`);
      if (layer.from === name) fail(`${where} chains from itself`);
      if (!CHAIN_SOURCES.includes(all[layer.from]?.type)) {
         fail(`${where} chains from layer '${layer.from}', a ${all[layer.from]?.type} layer — a template comes from a string, so it chains from ${CHAIN_SOURCES.join(', ')}`);
      }
   }

   // shape and domains agree: a shape names only domains, and no domain goes unused
   const domainKeys = Object.keys(layer.domains ?? {});
   const unused = used => domainKeys.filter(key => !used.has(key));
   if (layer.type === 'OBJ' || layer.type === 'NUM' || layer.type === 'ARR') {
      if (hasOwn(layer, 'shape')) {
         const seen = new Set();
         for (const key of layer.shape) {
            if (!domainKeys.includes(key)) fail(`${where} shape names '${key}', which is not one of its domains`);
            if (seen.has(key) && layer.type !== 'ARR') fail(`${where} shape names '${key}' twice`);
            seen.add(key);
         }
         const left = unused(seen);
         if (left.length > 0) fail(`${where} domain '${left[0]}' is not in its shape`);
      }
   }
   if (layer.type === 'STR' && hasOwn(layer, 'shape')) {
      const slots = new Set(STRLayer._tokenizeTemplate(layer.shape, domainKeys).filter(t => t.type === 'var').map(t => t.value));
      const left = unused(slots);
      if (left.length > 0) fail(`${where} domain '${left[0]}' never appears in its template`);
   }
}

function canonicalLayer(layer) {
   const rule = LAYER_RULES[layer.type];
   const out = structuredClone(layer);
   if (rule.keys.shape?.derivedDefault && !hasOwn(out, 'shape')) out.shape = Object.keys(out.domains).sort(byCodeUnit);
   if (rule.keys.options) out.options = withDefaults(out.options, rule.keys.options.schema);
   return out;
}

// Sources before consumers (topological), code-unit ties. Derived from `from`, never
// from key order, so key order stays irrelevant.
function resolutionOrder(layers) {
   const state = {};
   const out = [];
   const visit = name => {
      if (state[name] === 2) return;
      if (state[name] === 1) fail(`chain cycle involving layer '${name}'`);
      state[name] = 1;
      if (layers[name].from != null) visit(layers[name].from);
      state[name] = 2;
      out.push(name);
   };
   for (const name of Object.keys(layers).sort(byCodeUnit)) visit(name);
   return out;
}

// Every reference names a real layer or part; every layer is assigned; a layer is
// whole or parted, never both; every part of a parted layer is assigned exactly once.
function checkProjection(projection, layers) {
   const whole = {}, parts = {};
   projection.forEach((entry, axis) => {
      const here = new Set();
      for (const ref of entry) {
         if (here.has(ref)) fail(`projection axis ${axis} names '${ref}' twice`);
         here.add(ref);
         const dot = ref.indexOf('.');
         const name = dot < 0 ? ref : ref.slice(0, dot);
         if (!hasOwn(layers, name)) fail(`projection axis ${axis} references unknown layer '${name}'`);
         if (dot < 0) { (whole[name] ||= []).push(axis); continue; }
         const part = ref.slice(dot + 1);
         const available = partsOf(name, layers[name]);
         if (!available.includes(part)) {
            fail(`projection axis ${axis}: layer '${name}' has no part '${part}' (its parts: ${available.length ? list(available) : 'none — only OBJ, NUM, ARR and STR layers part'})`);
         }
         const byPart = (parts[name] ||= {});
         if (hasOwn(byPart, part)) fail(`projection: layer '${name}' part '${part}' is assigned to axes ${byPart[part]} and ${axis}`);
         byPart[part] = axis;
      }
   });
   for (const name of Object.keys(layers)) {
      if (whole[name] && parts[name]) fail(`projection references layer '${name}' both whole and by parts — choose one`);
      if (!whole[name] && !parts[name]) fail(`projection assigns layer '${name}' to no axis`);
      if (parts[name]) {
         const missing = partsOf(name, layers[name]).filter(part => !hasOwn(parts[name], part));
         if (missing.length > 0) fail(`projection assigns no axis to layer '${name}' part '${missing[0]}'`);
      }
   }
}

// The names a layer's parts go by: an OBJ/NUM key, an ARR position, an STR variable.
function partsOf(name, layer) {
   switch (LAYER_RULES[layer.type].parting) {
      case 'keys': return layer.shape.slice();
      case 'positions': return layer.shape.map((_, position) => String(position));
      case 'variables': return Object.keys(layer.domains);
      default: return [];
   }
}

export function sortKeysDeep(value) {
   if (Array.isArray(value)) return value.map(sortKeysDeep);
   if (!isPlainObject(value)) return value;
   const out = {};
   for (const key of Object.keys(value).sort(byCodeUnit)) out[key] = sortKeysDeep(value[key]);
   return out;
}

//////////////////////////////////////////////////////////////////////////
// THE JSON SCHEMA — the table, rendered
//////////////////////////////////////////////////////////////////////////

// A table schema as plain JSON Schema (getters resolved, table-only fields dropped).
function render(schema) {
   return JSON.parse(JSON.stringify(schema));
}

export function layerJsonSchema(type) {
   const rule = LAYER_RULES[type];
   const properties = { type: { const: type } };
   const required = ['type'];
   for (const [key, keyRule] of Object.entries(rule.keys)) {
      properties[key] = render(keyRule.schema);
      if (keyRule.derivedDefault) properties[key].description = `${properties[key].description ?? ''}${properties[key].description ? '; ' : ''}default: ${keyRule.derivedDefault}`;
      if (keyRule.required) required.push(key);
   }
   const out = { type: 'object', required, additionalProperties: false, properties, description: rule.role };
   if (rule.exactlyOne) out.oneOf = rule.exactlyOne.map(key => ({ required: [key], not: { required: rule.exactlyOne.filter(k => k !== key) } }));
   return out;
}

export function formulaJsonSchema() {
   const properties = {};
   const required = [];
   for (const [key, rule] of Object.entries(FORMULA_RULES)) {
      properties[key] = render(rule.schema);
      if (rule.derivedDefault) properties[key].description = `${properties[key].description}; default: ${rule.derivedDefault}`;
      if (rule.required) required.push(key);
   }
   properties.layers.additionalProperties = { oneOf: Object.keys(LAYER_RULES).map(layerJsonSchema) };
   return { type: 'object', required, additionalProperties: false, properties };
}
