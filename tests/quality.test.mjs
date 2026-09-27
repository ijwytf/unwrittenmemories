import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { QUALITY_PROFILES, selectQuality, pointCountsFor, pixelRatioFor } from '../quality.js';

const desktop = { userAgent: 'Windows NT', platform: 'Win32', maxTouchPoints: 0 };
test('desktop, touchscreen laptop, phone and iPad classification', () => {
  assert.equal(selectQuality(desktop, () => false).name, 'desktop');
  assert.equal(selectQuality({ ...desktop, maxTouchPoints: 10 }, () => false).name, 'desktop');
  assert.equal(selectQuality({ ...desktop, userAgent: 'Android' }, () => false).name, 'mobile');
  assert.equal(selectQuality({ ...desktop, platform: 'MacIntel', maxTouchPoints: 5 }, () => false).name, 'mobile');
  assert.equal(selectQuality({ ...desktop, maxTouchPoints: 5 }, () => true).name, 'mobile');
});

test('desktop DPR remains unchanged; mobile pixels stay within budget after orientation changes', () => {
  assert.equal(pixelRatioFor(QUALITY_PROFILES.desktop, 1920, 1080, 2), 1.1);
  for (const [w, h] of [[390, 844], [844, 390], [1024, 1366], [1366, 1024]]) {
    const ratio = pixelRatioFor(QUALITY_PROFILES.mobile, w, h, 3);
    assert.ok(ratio <= 1);
    assert.ok(w * h * ratio * ratio <= 800001);
  }
});

function parseGlb(filename) {
  const file = readFileSync(new URL(filename, import.meta.url));
  const jsonLength = file.readUInt32LE(12);
  return { json: JSON.parse(file.subarray(20, 20 + jsonLength)), binary: file.subarray(28 + jsonLength) };
}

test('real desktop count unchanged; mobile point cap also holds for larger future models', () => {
  const { json } = parseGlb('../ptc.glb');
  const vertices = json.meshes.flatMap(mesh => mesh.primitives.map(p => json.accessors[p.attributes.POSITION].count));
  assert.equal(pointCountsFor(vertices, QUALITY_PROFILES.desktop).reduce((a, b) => a + b), 305068);
  const mobileCount = pointCountsFor(vertices, QUALITY_PROFILES.mobile).reduce((a, b) => a + b);
  assert.ok(mobileCount < 100000 && mobileCount > 90000);
  assert.ok(pointCountsFor([1e7, 2e7, 3], QUALITY_PROFILES.mobile).reduce((a, b) => a + b) <= 100000);
  console.log({ desktopPoints: 305068, mobilePoints: mobileCount });
});

test('mobile GLB changes only oversized image data and buffer offsets', () => {
  const before = parseGlb('../ptc.glb');
  const after = parseGlb('../ptc-mobile.glb');
  for (const key of Object.keys(before.json).filter(k => !['buffers', 'bufferViews'].includes(k))) {
    assert.deepEqual(after.json[key], before.json[key], key);
  }
  let changed = 0;
  const imageViews = new Set(before.json.images.map(image => image.bufferView));
  before.json.bufferViews.forEach((view, index) => {
    const next = after.json.bufferViews[index];
    const a = before.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const b = after.binary.subarray(next.byteOffset || 0, (next.byteOffset || 0) + next.byteLength);
    if (!a.equals(b)) {
      assert.ok(imageViews.has(index), `non-image bufferView ${index} changed`);
      assert.ok(b.length < a.length);
      changed++;
    }
  });
  assert.equal(changed, 1);
});
