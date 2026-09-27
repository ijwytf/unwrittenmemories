import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { galleryRegions } from '../gallery-data.js';

const expected = { 괴산: 8, 옥천: 8, 보은: 9, 단양: 8 };

test('gallery data matches the real WebP files and keeps metadata fields', () => {
  assert.deepEqual(galleryRegions.map(region => region.name), ['괴산', '옥천', '보은', '단양']);

  for (const region of galleryRegions) {
    assert.equal(region.photos.length, expected[region.name]);
    const directory = fileURLToPath(new URL(`../images/gallery/${region.name}/`, import.meta.url));
    assert.equal(readdirSync(directory).filter(file => file.endsWith('.webp')).length, expected[region.name]);

    region.photos.forEach((photo, index) => {
      assert.equal(photo.src, `images/gallery/${region.name}/${region.name} (${index + 1}).webp`);
      assert.equal(typeof photo.title, 'string');
      assert.equal(typeof photo.description, 'string');
      assert.ok(existsSync(fileURLToPath(new URL(`../${photo.src}`, import.meta.url))));
    });
  }
});
