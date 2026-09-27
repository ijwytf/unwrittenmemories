// Device detection lives here; resizing never switches the model or point budget.
export const QUALITY_PROFILES = Object.freeze({
  desktop: Object.freeze({
    name: 'desktop', modelUrl: './ptc.glb', pixelRatio: 1.1,
    maxPixels: Infinity, pointDensity: 0.2, maxPoints: Infinity,
    bloomResolution: 1, maxFps: Infinity, pointUpdateHz: 30,
    antialias: true, conversionBatchSize: Infinity, microphoneControl: false
  }),
  mobile: Object.freeze({
    name: 'mobile', modelUrl: './ptc-mobile.glb', pixelRatio: 1,
    maxPixels: 800000, pointDensity: 0.06, maxPoints: 100000,
    bloomResolution: 0.65, maxFps: 30, pointUpdateHz: 30,
    antialias: false, conversionBatchSize: 4096, microphoneControl: true
  })
});

export function selectQuality(nav = navigator, matches = query => matchMedia(query).matches) {
  // Includes iPadOS desktop UA; a small desktop window alone is not mobile.
  const mobile = nav.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
    || (nav.maxTouchPoints > 0 && matches('(pointer: coarse)') && matches('(hover: none)'));
  return QUALITY_PROFILES[mobile ? 'mobile' : 'desktop'];
}

export function pixelRatioFor(quality, width, height, dpr) {
  return Math.min(dpr || 1, quality.pixelRatio,
    Math.sqrt(quality.maxPixels / Math.max(1, width * height)));
}

export function pointCountsFor(vertexCounts, quality) {
  const counts = vertexCounts.map(count => Math.max(100, Math.floor(count * quality.pointDensity)));
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= quality.maxPoints) return counts;
  // Scale the entire budget, including small primitives, so the cap is real.
  return counts.map(count => Math.floor(count * quality.maxPoints / total));
}
