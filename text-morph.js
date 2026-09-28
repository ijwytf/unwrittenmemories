import * as THREE from 'three';

// Prototype settings: layout is relative to the camera's visible area.
export const TEXT_MORPH_CONFIG = {
  text: '보은', duration: 2, cacheSize: 2,
  easing: t => t * t * (3 - 2 * t),
  font: '700 240px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif',
  spacing: 16, widthFraction: 0.72, heightFraction: 0.38,
  x: 0, y: 0, depth: 0.008, noise: 0.004, audio: 0.025,
};

export class TextMorph {
  constructor(camera, clouds, group, config = TEXT_MORPH_CONFIG) {
    this.camera = camera;
    this.clouds = clouds;
    this.group = group;
    this.config = config;
    this.cache = new Map();
    this.blend = this.destination = 0;
    this.elapsed = 0;
    this.matrix = new THREE.Matrix4();
    this.culling = clouds.map(p => p.frustumCulled);
    this.distance = camera.position.length();
  }

  createTextTargets(text) {
    if (this.cache.has(text)) {
      const cached = this.cache.get(text);
      this.cache.delete(text);
      this.cache.set(text, cached);
      return cached;
    }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.font = this.config.font;
    const glyphs = Array.from(text);
    const widths = glyphs.map(g => context.measureText(g).width);
    canvas.width = Math.ceil(widths.reduce((a, b) => a + b, 0) + glyphs.length * this.config.spacing + 32);
    canvas.height = 384;
    context.font = this.config.font;
    context.fillStyle = 'white';
    context.textBaseline = 'middle';
    let cursor = 16;
    glyphs.forEach((g, i) => {
      context.fillText(g, cursor, canvas.height / 2);
      cursor += widths[i] + this.config.spacing;
    });
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const samples = [];
    let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
      samples.push(y * canvas.width + x);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (!samples.length) throw new Error('텍스트 형태를 생성할 수 없습니다.');
    const height = bottom - top + 1;
    // Independent deterministic RNG: never changes model sampling or original points.
    let seed = 123456789;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const targets = this.clouds.map(points => {
      const result = new Float32Array(points.geometry.attributes.position.array.length);
      for (let i = 0; i < result.length; i += 3) {
        const pixel = samples[Math.floor(random() * samples.length)];
        result[i] = (pixel % canvas.width + random() - 0.5 - (left + right) / 2) / height;
        result[i + 1] = -(Math.floor(pixel / canvas.width) + random() - 0.5 - (top + bottom) / 2) / height;
        result[i + 2] = (random() - 0.5) * this.config.depth;
      }
      return result;
    });
    const entry = { targets, aspect: (right - left + 1) / height };
    this.cache.set(text, entry);
    while (this.cache.size > this.config.cacheSize) this.cache.delete(this.cache.keys().next().value);
    return entry;
  }

  scaleFor(entry) {
    if (entry.referenceAspect) return Math.min(1, this.camera.aspect / entry.referenceAspect);
    return Math.min(this.config.heightFraction, this.camera.aspect * this.config.widthFraction / entry.aspect);
  }

  // Capture the current text interpolation, never the mutable geometry/originals.
  // This keeps rapid submissions continuous without building a chain of targets.
  captureText() {
    if (!this.source) return this.text;
    const a = this.scaleFor(this.source) * (1 - this.textProgress);
    const b = this.scaleFor(this.text) * this.textProgress;
    return {
      referenceAspect: this.camera.aspect,
      targets: this.text.targets.map((target, index) => {
        const result = new Float32Array(target.length), source = this.source.targets[index];
        for (let i = 0; i < result.length; i++) result[i] = source[i] * a + target[i] * b;
        return result;
      }),
      // Noise/audio amplitude also remains continuous on interrupted transitions.
      amplitude: (this.source.amplitude ?? 1) * a + (this.text.amplitude ?? 1) * b,
    };
  }

  search(value) {
    const word = value.trim();
    if (word && word === this.word && this.destination === 1) return;
    const next = word ? this.createTextTargets(word) : null;
    const current = this.text ? this.captureText() : null;
    this.source = word && this.blend > 0 ? current : null;
    this.text = next || current;
    this.textProgress = this.source ? 0 : 1;
    this.textElapsed = 0;
    this.word = word;
    this.from = this.blend;
    this.destination = word ? 1 : 0;
    this.elapsed = 0;
  }

  toggle(text = this.config.text) {
    this.search(this.destination ? '' : text);
  }

  update(delta) {
    const wasActive = this.blend > 0;
    if (this.blend !== this.destination) {
      this.elapsed += delta;
      const t = Math.min(1, this.elapsed / this.config.duration);
      this.blend = t === 1 ? this.destination
        : this.from + (this.destination - this.from) * this.config.easing(t);
    }
    if (!wasActive && this.blend === 0) return false;
    if (this.source) {
      this.textElapsed += delta;
      const t = Math.min(1, this.textElapsed / this.config.duration);
      this.textProgress = this.config.easing(t);
      if (t === 1) { this.source = null; this.textProgress = 1; }
    }
    if (this.blend > 0) {
      this.group.updateWorldMatrix(true, true);
      this.camera.updateWorldMatrix(true, false);
      const visibleHeight = 2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.getEffectiveFOV() / 2));
      this.targetScale = visibleHeight * this.scaleFor(this.text) * (this.source ? this.textProgress : 1);
      this.sourceScale = this.source ? visibleHeight * this.scaleFor(this.source) * (1 - this.textProgress) : 0;
      this.height = this.targetScale * (this.text.amplitude ?? 1) + this.sourceScale * (this.source?.amplitude ?? 1);
      this.x = visibleHeight * this.camera.aspect * this.config.x;
      this.y = visibleHeight * this.config.y;
    }
    this.clouds.forEach((p, i) => { p.frustumCulled = this.blend > 0 ? false : this.culling[i]; });
    return wasActive || this.blend > 0;
  }

  prepare(points, index) {
    if (!this.blend) return;
    this.targets = this.text.targets[index];
    this.sourceTargets = this.source?.targets[index];
    this.matrix.copy(points.matrixWorld).invert().multiply(this.camera.matrixWorld);
  }

  apply(positions, i, moveX, moveY, moveZ, scatter, audioStrength) {
    const h = this.height, config = this.config, target = this.targets;
    const noise = h * config.noise / 0.08, audio = h * config.audio * audioStrength;
    const source = this.sourceTargets, s = this.sourceScale, t = this.targetScale;
    const x = target[i] * t + (source ? source[i] * s : 0) + this.x + moveX * noise + scatter[i] * audio;
    const y = target[i + 1] * t + (source ? source[i + 1] * s : 0) + this.y + moveY * noise + scatter[i + 1] * audio;
    const z = target[i + 2] * t + (source ? source[i + 2] * s : 0) - this.distance + moveZ * noise + scatter[i + 2] * audio;
    const e = this.matrix.elements, blend = this.blend;
    positions[i] += (e[0] * x + e[4] * y + e[8] * z + e[12] - positions[i]) * blend;
    positions[i + 1] += (e[1] * x + e[5] * y + e[9] * z + e[13] - positions[i + 1]) * blend;
    positions[i + 2] += (e[2] * x + e[6] * y + e[10] * z + e[14] - positions[i + 2]) * blend;
  }
}
