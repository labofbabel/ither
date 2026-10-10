// Ither — ordinal runs (internal)
//
// A run is [ordinal, length]: consecutive ordinals. The query lists what it omitted as runs
// (manifest.omitted); analysis checks a record set against them. One helper for both tiers.

// Adds [ordinal, length] to a list of runs, merging with the last when adjacent.
export function addRun(runs, ordinal, length) {
   const last = runs.at(-1);
   if (last && last[0] + last[1] === ordinal) last[1] += length;
   else runs.push([ordinal, length]);
}

// Whether a record set is exactly what its manifest says was walked: the records' ordinal
// runs and every omitted run together cover [manifest.offset, manifest.nextOffset), each
// ordinal once. Returns { covered, issues: [{ code, message }] }.
export function checkCoverage(manifest, recordRuns) {
   const issues = [];
   const { offset, nextOffset, omitted } = manifest;
   if (typeof offset !== 'bigint' || typeof nextOffset !== 'bigint' || !omitted || typeof omitted !== 'object') {
      return { covered: false, issues: [{ code: 'invalid-manifest', message: 'a manifest needs offset, nextOffset and omitted' }] };
   }
   const runs = recordRuns.map(([ordinal, length]) => [ordinal, length, 'records']);
   for (const [reason, list] of Object.entries(omitted)) {
      if (!Array.isArray(list)) {
         return { covered: false, issues: [{ code: 'invalid-manifest', message: `omitted.${reason} must be a list of [ordinal, length] runs` }] };
      }
      for (const [ordinal, length] of list) runs.push([ordinal, length, reason]);
   }
   runs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
   let cursor = offset;
   for (const [ordinal, length, what] of runs) {
      if (ordinal < cursor) issues.push({ code: 'coverage-overlap', message: `ordinal ${ordinal} (${what}) is covered twice` });
      else if (ordinal > cursor) issues.push({ code: 'coverage-gap', message: `ordinals [${cursor}, ${ordinal}) are neither records nor omitted` });
      if (ordinal + length > cursor) cursor = ordinal + length;
   }
   if (cursor !== nextOffset) {
      issues.push({
         code: cursor < nextOffset ? 'coverage-gap' : 'coverage-overlap',
         message: `records and omissions end at ${cursor}, the manifest at ${nextOffset}`,
      });
   }
   return { covered: issues.length === 0, issues };
}
