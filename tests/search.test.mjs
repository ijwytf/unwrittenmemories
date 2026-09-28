import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSearch } from '../search-input.js';

test('Korean/English lengths include spaces and exclude mixed scripts and symbols', () => {
  for (const [input, expected, mode] of [
    ['보은', '보은', 'ko'], ['나의 기억들', '나의 기억', 'ko'],
    ['memory', 'memory', 'en'], ['heritages', 'heritage', 'en'],
    ['My World!', 'My World', 'en'], ['보은 memory', '보은 ', 'ko'],
    ['memory 보은', 'memory ', 'en'], ['123! 기억?', ' 기억', 'ko'],
    ['ㄱㅏ나', '나', 'ko'], ['   ', '   ', null],
  ]) assert.deepEqual(sanitizeSearch(input), {value:expected, mode});
});

test('existing language remains locked when incompatible text is inserted at the start', () => {
  assert.deepEqual(sanitizeSearch('보은memory', 'en'), {value:'memory',mode:'en'});
  assert.deepEqual(sanitizeSearch('memory보은', 'ko'), {value:'보은',mode:'ko'});
  assert.deepEqual(sanitizeSearch('', 'ko'), {value:'',mode:null});
});
