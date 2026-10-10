// Ither — geometry values (internal)
//
// A geometry is a plain, typed value, validated and made canonical like a formula (every
// default written in, a frozen copy detached from the caller):
//
//   decode (coordinates in):
//     { type: 'grid', axes: [{ start, end, step }, …] }          inclusive box, last axis fastest
//     { type: 'ray',  start: [...], direction: [...], count }    point k = start + direction · k
//     { type: 'list', coordinates: [[...], …] }                  explicit coordinates
//   encode (structures in):
//     { type: 'list', structures: [{…}, …] }                     explicit structures
//
// The query walks it; the manifest echoes it; analysis may inspect it without decoding
// (describeGeometry — private to the tiers, not exported from src/index.js).

import { CoordinateGrid } from './CoordinateGrid.js';
import { CoordinateRay } from './CoordinateRay.js';
import { CoordinateList } from './CoordinateList.js';
import { StructureList } from './StructureList.js';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const KEYS = {
   decode: {
      grid: new Set(['type', 'axes']),
      ray: new Set(['type', 'start', 'direction', 'count']),
      list: new Set(['type', 'coordinates']),
   },
   encode: {
      list: new Set(['type', 'structures']),
   },
};
const GRID_AXIS_KEYS = new Set(['start', 'end', 'step']);

function deepFreeze(value) {
   if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
   for (const item of Object.values(value)) deepFreeze(item);
   return Object.freeze(value);
}

function checkKeys(value, allowed, what) {
   for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`Ither query: unknown ${what} key '${key}'`);
   }
}

function requireArray(value, where) {
   if (!Array.isArray(value)) throw new TypeError(`Ither query: ${where} must be an array`);
   return value;
}

// The canonical copy of a geometry for a direction ('decode' | 'encode'). Shape and keys are
// checked here; values (ranges, signs, arity) by the walker built from it.
export function canonicalGeometry(space, direction, geometry) {
   const where = `query.${direction}`;
   if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
      throw new TypeError(`Ither query: ${where} must be a geometry object { type, … }`);
   }
   const types = KEYS[direction];
   if (!hasOwn(types, geometry.type)) {
      throw new TypeError(`Ither query: ${where}.type must be ${Object.keys(types).map(type => `'${type}'`).join(' or ')}`);
   }
   checkKeys(geometry, types[geometry.type], geometry.type);
   for (const key of types[geometry.type]) {
      if (!hasOwn(geometry, key)) throw new TypeError(`Ither query: ${where} (${geometry.type}) requires '${key}'`);
   }

   let canonical;
   switch (`${direction}:${geometry.type}`) {
      case 'decode:grid': {
         const axes = requireArray(geometry.axes, `${where}.axes`);
         if (axes.length !== space.axisCount) {
            throw new RangeError(`Ither query: a grid needs ${space.axisCount} axes (one per axis), received ${axes.length}`);
         }
         canonical = {
            type: 'grid',
            axes: axes.map((axis, i) => {
               if (!axis || typeof axis !== 'object' || Array.isArray(axis)) throw new TypeError(`Ither query: ${where}.axes[${i}] must be an object`);
               checkKeys(axis, GRID_AXIS_KEYS, 'grid axis');
               return { start: axis.start, end: axis.end, step: hasOwn(axis, 'step') ? axis.step : 1n };
            }),
         };
         break;
      }
      case 'decode:ray':
         canonical = {
            type: 'ray',
            start: requireArray(geometry.start, `${where}.start`).slice(),
            direction: requireArray(geometry.direction, `${where}.direction`).slice(),
            count: geometry.count,
         };
         break;
      case 'decode:list':
         canonical = {
            type: 'list',
            coordinates: requireArray(geometry.coordinates, `${where}.coordinates`).map(coordinate => (Array.isArray(coordinate) ? coordinate.slice() : coordinate)),
         };
         break;
      default: // encode:list
         canonical = { type: 'list', structures: requireArray(geometry.structures, `${where}.structures`).map(structure => structuredClone(structure)) };
   }
   // building the walker validates every value before the copy is frozen and returned
   const walker = makeWalker(space, direction, canonical);
   return { geometry: deepFreeze(canonical), walker };
}

export function makeWalker(space, direction, geometry) {
   if (direction === 'encode') return new StructureList({ layerNames: space.layerNames, structures: geometry.structures });
   const bounds = space.axisBounds();
   const unwrap = error => { throw new error.constructor(`Ither query: ${error.message}`); };
   try {
      switch (geometry.type) {
         case 'grid':
            // The grid walks the ranges the Space has at each coordinate — a chained layer's
            // axes resolved from the axes they depend on, caps included — and skips the rest.
            return new CoordinateGrid({
               bounds,
               axes: geometry.axes,
               dependencies: space.axisDependencies(),
               ranges: coordinate => space._axisRanges(coordinate),
            });
         case 'ray':
            return new CoordinateRay({ bounds, ranges: constantRanges(space), start: geometry.start, direction: geometry.direction, count: geometry.count });
         default:
            return new CoordinateList({ bounds, ranges: constantRanges(space), coordinates: geometry.coordinates });
      }
   } catch (error) {
      return unwrap(error);
   }
}

// Every axis's range (caps included; null where there is none), when no axis's range depends
// on another — then it is the same at every coordinate. Otherwise null: ranges are resolved
// per point, on decode.
function constantRanges(space) {
   if (space.axisDependencies().some(list => list.length > 0)) return null;
   return space._axisRanges(new Array(space.axisCount).fill(0n));
}

// What a decode geometry covers, without decoding anything:
//   count  the ordinals it spans
//   total  its in-range points, where known up front (else null)
//   box    per axis, the { min, max } of its coordinates, in range or not (null when empty)
export function describeGeometry(space, geometry) {
   const { walker } = canonicalGeometry(space, 'decode', geometry);
   return { count: walker.count, total: walker.total(), box: walker.count === 0n ? null : walker.box() };
}
