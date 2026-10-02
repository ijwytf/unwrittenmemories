// Exact lookup. Narrative text and Korean keyword spelling remain untouched.
const keyOf = word => word.trim().replace(/[A-Z]/g, letter => letter.toLowerCase());

export function buildKeywordIndex(records) {
  const index = new Map();
  for (const record of records) {
    for (const keyword of new Set(record.keywords.map(keyOf))) {
      if (!keyword) continue;
      if (!index.has(keyword)) index.set(keyword, []);
      index.get(keyword).push(record);
    }
  }
  return index;
}

export class RecordLibrary {
  constructor(records, random = Math.random) {
    this.index = buildKeywordIndex(records);
    this.cycles = new Map();
    this.random = random;
  }

  getRecordsForKeyword(keyword) {
    return this.index.get(keyOf(keyword)) || [];
  }

  selectRecordForSearch(keyword) {
    const key = keyOf(keyword), candidates = this.getRecordsForKeyword(key);
    if (!candidates.length) return null;
    let cycle = this.cycles.get(key);
    if (!cycle) { cycle = { remaining: [], last: null }; this.cycles.set(key, cycle); }
    if (!cycle.remaining.length) {
      cycle.remaining = [...candidates];
      for (let i = cycle.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [cycle.remaining[i], cycle.remaining[j]] = [cycle.remaining[j], cycle.remaining[i]];
      }
      // Also avoid an immediate repeat across the boundary between cycles.
      const lastIndex = cycle.remaining.length - 1;
      if (lastIndex > 0 && cycle.remaining[lastIndex] === cycle.last) {
        [cycle.remaining[0], cycle.remaining[lastIndex]] = [cycle.remaining[lastIndex], cycle.remaining[0]];
      }
    }
    cycle.last = cycle.remaining.pop();
    return cycle.last;
  }
}

let loading;
export function loadRecordData() {
  // Deferred until the first confirmed nonempty search, then loaded/indexed once.
  return loading ||= fetch(new URL('./data/records.json', import.meta.url))
    .then(response => {
      if (!response.ok) throw new Error(`Records: HTTP ${response.status}`);
      return response.json();
    }).then(records => new RecordLibrary(records));
}
