// Ither — the analysis runner (internal; reached through Ither({ space?, query?, analysis }))
//
// Analysis is a container with one contract and a set of capsules. A request supplies inputs;
// each capsule declares the inputs it needs and is handed only those; every capsule gives
// exactly one result. A capsule that cannot run says so in its result — the request is
// rejected only when it is malformed.
//
// Inputs (INPUTS below; new inputs are added there, the contract does not change):
//   space      request.space
//   geometry   analysis.geometry, a live query's decode geometry, or a saved manifest's
//   records    a live query's records, or analysis.records — handed to observe(record, row);
//              a capsule that requires records is also handed `direction` ('decode' |
//              'encode', or null when saved records come without their manifest)
//   manifest   a live query's manifest (at finish: it exists once the walk has ended), or
//              analysis.manifest
//
// A capsule:
//   { type, category, version, requires: [input, …], parameters: [name, …], after: [type, …],
//     create({ parameters, context, inputs }) => { observe?(record, row), adapterError?(row, error),
//                                                  finish({ inputs, results }) => result } }
//   The runner refuses a parameter the capsule does not declare, whether or not it applies;
//   `create` checks the values: a throw there rejects the request (nothing has run yet).
// A suite:
//   { type, category, version, members: [type, …] } — rolls up the members that ran.
//
// A result: { type, category, version, status, reason?, …data }, status one of
//   pass | warn | fail     the capsule ran; its verdict
//   inapplicable           it could not run — a missing input, a capsule in `after` that did
//                          not run, or nothing to judge (the capsule's own call); reason says why
//   error                  it threw in observe or finish, or returned what the contract does not
//                          allow; reason is the message

import { Engine } from '../formula/Engine.js';
import { BUILTIN_CAPSULES } from './AnalysisCapsules.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const INPUTS = Object.freeze(['space', 'geometry', 'records', 'manifest']);
const INPUT_SET = new Set(INPUTS);
const ANALYSIS_KEYS = new Set(['suite', 'capsules', 'context', 'geometry', 'records', 'adapt', 'manifest']);
const CAPSULE_KEYS = new Set(['type', 'category', 'version', 'description', 'requires', 'parameters', 'after', 'create']);
const SUITE_KEYS = new Set(['type', 'category', 'version', 'description', 'members']);
const SUITE_ITEM_KEYS = new Set(['type', 'parameters']);
const VERDICTS = ['pass', 'warn', 'fail'];
const STATUSES = [...VERDICTS, 'inapplicable', 'error'];
const LABEL = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

class ContractError extends Error {}

function assertObject(value, where) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${where} must be an object`);
}

function assertKeys(value, allowed, where) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`${where}: unknown property '${key}'`);
   }
}

function assertLabel(value, where, what) {
   if (typeof value !== 'string' || !LABEL.test(value)) throw new TypeError(`${where}.${what} must be a lowercase hyphenated label`);
}

function assertTypeList(list, where) {
   if (!Array.isArray(list) || list.some(type => typeof type !== 'string')) throw new TypeError(`${where} must be an array of capsule types`);
   if (new Set(list).size !== list.length) throw new TypeError(`${where} must not contain duplicates`);
}

function deepFreeze(value) {
   if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
   for (const child of Object.values(value)) deepFreeze(child);
   return Object.freeze(value);
}

// A capsule or suite definition, checked and frozen.
export function validateDefinition(definition, where) {
   assertObject(definition, where);
   const suite = hasOwn(definition, 'members');
   assertKeys(definition, suite ? SUITE_KEYS : CAPSULE_KEYS, where);
   assertLabel(definition.type, where, 'type');
   assertLabel(definition.category, where, 'category');
   if (!Number.isInteger(definition.version) || definition.version <= 0) throw new TypeError(`${where}.version must be a positive integer`);
   if (hasOwn(definition, 'description') && typeof definition.description !== 'string') throw new TypeError(`${where}.description must be a string`);
   if (suite) {
      assertTypeList(definition.members, `${where}.members`);
      if (definition.members.length === 0) throw new TypeError(`${where}.members must not be empty`);
      return deepFreeze({ ...definition, members: definition.members.slice() });
   }
   if (typeof definition.create !== 'function') throw new TypeError(`${where}.create must be a function`);
   const requires = definition.requires ?? [];
   if (!Array.isArray(requires)) throw new TypeError(`${where}.requires must be an array of input names (${INPUTS.join(', ')})`);
   for (const input of requires) {
      if (!INPUT_SET.has(input)) throw new TypeError(`${where}.requires: unknown input '${input}' (inputs: ${INPUTS.join(', ')})`);
   }
   if (new Set(requires).size !== requires.length) throw new TypeError(`${where}.requires must not contain duplicates`);
   const parameters = definition.parameters ?? [];
   if (!Array.isArray(parameters) || parameters.some(name => typeof name !== 'string')) throw new TypeError(`${where}.parameters must be an array of parameter names`);
   const after = definition.after ?? [];
   assertTypeList(after, `${where}.after`);
   return deepFreeze({ ...definition, requires: requires.slice(), parameters: parameters.slice(), after: after.slice() });
}

// Built-ins pass the same contract as a request's own capsules.
export const BUILTINS = new Map([...BUILTIN_CAPSULES].map(([type, definition]) => [type, validateDefinition(definition, `built-in capsule '${type}'`)]));

function registryWith(custom = []) {
   if (!Array.isArray(custom)) throw new TypeError('Ither analysis.capsules must be an array');
   const registry = new Map(BUILTINS);
   custom.forEach((definition, index) => {
      const where = `Ither analysis.capsules[${index}]`;
      const validated = validateDefinition(definition, where);
      if (registry.has(validated.type)) throw new TypeError(`${where}: capsule '${validated.type}' is already defined`);
      registry.set(validated.type, validated);
   });
   return registry;
}

function requestedSuite(suite, registry) {
   if (suite === undefined) throw new TypeError('Ither analysis.suite is required: name the capsules to run');
   if (!Array.isArray(suite) || suite.length === 0) throw new TypeError('Ither analysis.suite must be a non-empty array');
   const requested = new Map();
   suite.forEach((entry, index) => {
      const where = `Ither analysis.suite[${index}]`;
      const item = typeof entry === 'string' ? { type: entry } : entry;
      assertObject(item, where);
      assertKeys(item, SUITE_ITEM_KEYS, where);
      if (!registry.has(item.type)) throw new TypeError(`${where}: unknown capsule '${item.type}'`);
      if (requested.has(item.type)) throw new TypeError(`${where}: duplicate capsule '${item.type}'`);
      const parameters = item.parameters ?? {};
      assertObject(parameters, `${where}.parameters`);
      const accepted = registry.get(item.type).parameters ?? [];
      for (const key of Object.keys(parameters)) {
         if (!accepted.includes(key)) throw new TypeError(`${where}: capsule '${item.type}' has no parameter '${key}'`);
      }
      requested.set(item.type, deepFreeze({ ...parameters }));
   });
   return requested;
}

// Every capsule to run, dependencies (after, members) first, each once.
function resolvePlan(requested, registry) {
   const visiting = new Set();
   const visited = new Set();
   const plan = [];
   const visit = (type, path) => {
      if (visited.has(type)) return;
      if (visiting.has(type)) throw new TypeError(`Ither analysis capsule dependency cycle: ${[...path, type].join(' -> ')}`);
      const definition = registry.get(type);
      if (!definition) throw new TypeError(`Ither analysis capsule '${path.at(-1)}' depends on unknown capsule '${type}'`);
      visiting.add(type);
      for (const dependency of definition.members ?? definition.after) visit(dependency, [...path, type]);
      visiting.delete(type);
      visited.add(type);
      plan.push({ definition, parameters: requested.get(type) ?? deepFreeze({}) });
   };
   for (const type of requested.keys()) visit(type, []);
   return plan;
}

// A plain-data copy of a capsule's result; anything else breaks the contract.
function copyData(value, where, ancestors = new Set()) {
   if (value == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return value;
   if (typeof value !== 'object') throw new ContractError(`${where} must contain data values, not ${typeof value}s`);
   if (ancestors.has(value)) throw new ContractError(`${where} must not contain cycles`);
   ancestors.add(value);
   let copy;
   if (Array.isArray(value)) copy = value.map((item, index) => copyData(item, `${where}[${index}]`, ancestors));
   else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
      copy = {};
      for (const [key, item] of Object.entries(value)) {
         if (item !== undefined) copy[key] = copyData(item, `${where}.${key}`, ancestors);
      }
   } else throw new ContractError(`${where} must contain only plain objects and arrays`);
   ancestors.delete(value);
   return copy;
}

function resultFrom(definition, value) {
   const head = { type: definition.type, category: definition.category, version: definition.version };
   if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('a result must be an object');
   if (!['pass', 'warn', 'fail', 'inapplicable'].includes(value.status)) {
      throw new ContractError("result.status must be 'pass', 'warn', 'fail' or 'inapplicable' (a capsule that cannot finish throws)");
   }
   if (value.status === 'inapplicable' && (typeof value.reason !== 'string' || value.reason === '')) {
      throw new ContractError('an inapplicable result needs a reason');
   }
   for (const key of Object.keys(head)) {
      if (hasOwn(value, key)) throw new ContractError(`result.${key} is set by the runner`);
   }
   return { ...head, ...copyData(value, 'result') };
}

const notRun = (definition, status, reason) => ({ type: definition.type, category: definition.category, version: definition.version, status, reason });
const messageOf = error => (error instanceof Error ? error.message : String(error));
const quoted = names => names.map(name => `'${name}'`).join(', ');

function counts(results) {
   const tally = Object.fromEntries(STATUSES.map(status => [status, 0n]));
   for (const result of results) tally[result.status]++;
   return tally;
}

// error if any broke; else the worst verdict among those that ran; inapplicable if none ran
function rollUp(results) {
   if (results.some(result => result.status === 'error')) return 'error';
   const ran = results.filter(result => VERDICTS.includes(result.status));
   if (ran.length === 0) return 'inapplicable';
   return VERDICTS[Math.max(...ran.map(result => VERDICTS.indexOf(result.status)))];
}

function summaryOf(requested, results) {
   const categories = {};
   for (const category of new Set(results.map(result => result.category))) {
      const selected = results.filter(result => result.category === category);
      categories[category] = { status: rollUp(selected), counts: counts(selected) };
   }
   return { requested: [...requested.keys()], status: rollUp(results), counts: counts(results), categories };
}

const text = value => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}n` : v));

// Where the analysed data came from, so drift is detectable and never refused.
//   mapping   'live'              records produced by this request's own query
//             'manifest-matches'  saved; the manifest's version and formula are this version and this Space's
//             'manifest-differs'  saved; another version, or another formula, wrote them
//             'unverified'        saved, without a manifest or without a Space to compare it with
//             null                no records and no manifest: there is no data to map
//   manifest  null, or { itherVersion, packedBy, sameVersion, sameFormula } read from a saved manifest
//             (sameFormula null without a Space)
function provenance({ space, manifest, live, hasRecords }) {
   const read = live || manifest == null ? null : {
      itherVersion: manifest.itherVersion ?? null,
      packedBy: manifest.packedBy ?? null,
      sameVersion: manifest.itherVersion === Engine.version,
      sameFormula: space ? text(manifest.formula) === text(space.formula) : null,
   };
   const mapping = live ? 'live'
      : read && space ? (read.sameVersion && read.sameFormula ? 'manifest-matches' : 'manifest-differs')
         : read || hasRecords ? 'unverified' : null;
   return { itherVersion: Engine.version, packedBy: space ? space.packedBy : null, mapping, manifest: read };
}

// Checks an analysis request's own form: keys, suite, and the inputs it supplies itself.
export function checkAnalysisRequest(config) {
   assertObject(config, 'Ither analysis');
   assertKeys(config, ANALYSIS_KEYS, 'Ither analysis');
   if (hasOwn(config, 'manifest')) {
      const manifest = config.manifest;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.kind !== 'query-manifest') {
         throw new TypeError("Ither analysis.manifest must be a query manifest (kind 'query-manifest')");
      }
   }
   if (hasOwn(config, 'records')) {
      const records = config.records;
      if (records == null || typeof records === 'string' || !(records[Symbol.iterator] || records[Symbol.asyncIterator])) {
         throw new TypeError('Ither analysis.records must be an iterable or async iterable of records');
      }
   }
   if (hasOwn(config, 'adapt')) {
      if (!hasOwn(config, 'records')) throw new TypeError('Ither analysis.adapt needs analysis.records: it converts saved rows into records');
      if (typeof config.adapt !== 'function') throw new TypeError('Ither analysis.adapt must be a function');
   }
}

// A session over one set of inputs. `supplied` names what the request provides:
//   { space, geometry, direction, live, records: boolean, manifest: object | null | 'live' }
// A live manifest ('live') is handed over at finish.
export function createSession(config, supplied) {
   const registry = registryWith(config.capsules);
   const requested = requestedSuite(config.suite, registry);
   const plan = resolvePlan(requested, registry);

   const present = new Set();
   if (supplied.space) present.add('space');
   if (supplied.geometry) present.add('geometry');
   if (supplied.records) present.add('records');
   if (supplied.manifest) present.add('manifest');
   const inputsFor = (requires, manifest) => {
      const inputs = {};
      for (const name of requires) {
         if (name === 'records') inputs.direction = supplied.direction;
         else if (name === 'manifest') { if (manifest !== undefined) inputs.manifest = manifest; }
         else inputs[name] = supplied[name];
      }
      return Object.freeze(inputs);
   };
   const startManifest = supplied.manifest === 'live' ? undefined : supplied.manifest;

   // every capsule's state: { definition, instance?, result? } — a result is set once it is known
   const entries = plan.map(({ definition, parameters }) => {
      if (definition.members) return { definition };
      const missing = definition.requires.filter(name => !present.has(name));
      if (missing.length > 0) {
         return { definition, result: notRun(definition, 'inapplicable', `missing input${missing.length > 1 ? 's' : ''} ${quoted(missing)}`) };
      }
      const instance = definition.create({ parameters, context: config.context, inputs: inputsFor(definition.requires, startManifest) });
      const where = `analysis capsule '${definition.type}'`;
      assertObject(instance, `${where} instance`);
      for (const hook of ['observe', 'adapterError']) {
         if (hasOwn(instance, hook) && typeof instance[hook] !== 'function') throw new TypeError(`${where} instance.${hook} must be a function`);
      }
      if (typeof instance.finish !== 'function') throw new TypeError(`${where} instance.finish must be a function`);
      return { definition, instance };
   });
   const observers = entries.filter(entry => entry.instance && entry.definition.requires.includes('records'));

   const call = (entry, hook, ...args) => {
      if (entry.result || !entry.instance[hook]) return;
      try { entry.instance[hook](...args); } catch (error) { entry.result = notRun(entry.definition, 'error', messageOf(error)); }
   };

   let row = 0n;
   let finished = false;
   const open = () => { if (finished) throw new Error('Ither analysis session is already finished'); };
   return Object.freeze({
      needsManifest: entries.some(entry => entry.instance && entry.definition.requires.includes('manifest')),
      observe(record) {
         open();
         for (const entry of observers) call(entry, 'observe', record, row);
         row++;
      },
      adapterError(error) {
         open();
         for (const entry of observers) call(entry, 'adapterError', row, error);
         row++;
      },
      finish(liveManifest = null) {
         open();
         finished = true;
         const manifest = supplied.manifest === 'live' ? liveManifest : supplied.manifest;
         const results = new Map();
         for (const entry of entries) {
            const { definition } = entry;
            if (definition.members) {
               const members = definition.members.map(type => results.get(type));
               const status = rollUp(members);
               entry.result = status === 'inapplicable'
                  ? { ...notRun(definition, status, 'no member ran'), members: members.map(({ type, status: s }) => ({ type, status: s })) }
                  : { type: definition.type, category: definition.category, version: definition.version, status, members: members.map(({ type, status: s }) => ({ type, status: s })) };
            } else if (!entry.result) {
               const skipped = definition.after.find(type => !VERDICTS.includes(results.get(type).status));
               if (skipped) entry.result = notRun(definition, 'inapplicable', `'${skipped}' did not run`);
               else {
                  try {
                     entry.result = resultFrom(definition, entry.instance.finish({ inputs: inputsFor(definition.requires, manifest), results }));
                  } catch (error) {
                     entry.result = notRun(definition, 'error', messageOf(error));
                  }
               }
            }
            if (entry.result.reason === undefined) delete entry.result.reason;
            results.set(definition.type, deepFreeze(entry.result));
         }
         const list = [...results.values()];
         return deepFreeze({
            kind: 'analysis-report',
            version: 1,
            provenance: provenance({ space: supplied.space, manifest, live: supplied.live, hasRecords: supplied.records }),
            summary: summaryOf(requested, list),
            results: list,
         });
      },
   });
}

// A request with no live query: records, if any, are read from analysis.records.
export async function analyzeSaved(config, { space, geometry }) {
   const manifest = config.manifest ?? null;
   const hasRecords = hasOwn(config, 'records');
   const session = createSession(config, {
      space,
      geometry: geometry ?? manifest?.decode ?? null,
      direction: manifest ? (hasOwn(manifest, 'decode') ? 'decode' : 'encode') : null,
      live: false,
      records: hasRecords,
      manifest,
   });
   if (hasRecords) {
      const adapt = config.adapt ?? (record => record);
      let row = 0n;
      for await (const item of config.records) {
         let record;
         try {
            record = await adapt(item, row, config.context);
         } catch (error) {
            session.adapterError(error);
            row++;
            continue;
         }
         session.observe(record);
         row++;
      }
   }
   return session.finish();
}
