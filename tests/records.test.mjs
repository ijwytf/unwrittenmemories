import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RecordLibrary } from '../record-data.js';

const records = JSON.parse(readFileSync(new URL('../data/records.json', import.meta.url)));

test('region selection covers every actual regional record with independent shuffle cycles', () => {
  const library = new RecordLibrary(records, () => .42);
  for (const [region, count] of Object.entries({괴산:38, 옥천:36, 보은:26, 단양:69})) {
    let last;
    for (let cycle = 0; cycle < 2; cycle++) {
      const selected = Array.from({length:count}, () => library.selectRecordForRegion(region));
      assert.equal(new Set(selected).size, count);
      assert.ok(selected.every(record => record.region === region));
      assert.notEqual(selected[0], last);
      last = selected.at(-1);
    }
  }
  assert.equal(library.selectRecordForRegion('없는 지역'), null);
  assert.equal(library.cycles.size, 0);
});

test('actual records use exact individual keywords, with no empty/duplicate candidates', () => {
  const library = new RecordLibrary(records);
  assert.equal(records.length, 169);
  assert.equal(library.index.size, 311);
  assert.equal(library.getRecordsForKeyword('어업').length, 20);
  assert.equal(library.getRecordsForKeyword('어촌계').length, 1);
  for (const word of ['어', 'memory', 'hello', '기억', '어업 어촌계']) {
    assert.equal(library.selectRecordForSearch(word), null);
  }
  for (const [keyword, candidates] of library.index) {
    assert.equal(keyword, keyword.trim());
    assert.ok(keyword && !keyword.includes(','));
    assert.equal(new Set(candidates).size, candidates.length);
    assert.ok(candidates.every(r => r.keywords.includes(keyword)));
  }
});

test('shuffle cycles cover every candidate once, without a repeat at the cycle boundary', () => {
  const library = new RecordLibrary(records, () => 0.42);
  let last;
  for (let cycle = 0; cycle < 4; cycle++) {
    const selected = Array.from({ length: 20 }, () => library.selectRecordForSearch('어업'));
    assert.equal(new Set(selected).size, 20);
    assert.notEqual(selected[0], last);
    assert.ok(selected.every(r => r.keywords.includes('어업')));
    last = selected.at(-1);
  }
  const one = library.selectRecordForSearch('어촌계');
  assert.equal(library.selectRecordForSearch('어촌계'), one);
});

test('English exact comparison is case insensitive and does not change narrative data', () => {
  const record = { title: 'Keep Case', content: ' Original\nparagraph. ', keywords: ['Memory', ' memory '] };
  const library = new RecordLibrary([record]);
  assert.equal(library.getRecordsForKeyword(' MEMORY ').length, 1);
  assert.equal(library.selectRecordForSearch('memory'), record);
  assert.equal(library.selectRecordForSearch('mem'), null);
  assert.equal(record.content, ' Original\nparagraph. ');
});
