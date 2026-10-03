import * as THREE from 'three';
import { loadRecordData } from './record-data.js';
import { getRecordNote } from './record-note.js';

// Reuses one existing vertex and its live (audio-reactive) position.
export class RecordEasterEgg {
  constructor(camera, renderer, quality) {
    this.camera = camera;
    this.renderer = renderer;
    this.note = getRecordNote({ mobile: quality.name === 'mobile' });
    this.version = 0;
    this.vector = new THREE.Vector3();
    this.materials = new Map();
    this.hit = document.createElement('button');
    this.hit.id = 'record-point';
    this.hit.type = 'button';
    this.hit.hidden = true;
    this.hit.dataset.mobile = String(quality.name === 'mobile');
    this.hit.setAttribute('aria-label', '숨겨진 기록 열기');
    this.hit.setAttribute('aria-controls', 'record-note');
    this.hit.setAttribute('aria-expanded', 'false');
    document.body.appendChild(this.hit);
    for (const type of ['click', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keyup']) {
      this.hit.addEventListener(type, event => event.stopPropagation());
    }
    this.hit.addEventListener('click', () => {
      if (this.record && this.selected && !this.hit.hidden) {
        this.note.open(this.record, () => this.screenPosition(), this.hit);
      }
    });
    this.creditsObserver = new MutationObserver(() => {
      if (document.body.classList.contains('credits-open')) {
        this.note.dismiss();
        this.hit.hidden = true;
      }
    });
    this.creditsObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  async search(word, morph) {
    const version = ++this.version;
    this.clearPoint();
    this.note.dismiss();
    this.record = null;
    this.morph = morph;
    if (!word) return;
    try {
      const library = await loadRecordData();
      if (version !== this.version) return; // A newer search owns the result.
      this.record = library.selectRecordForSearch(word);
      if (this.record) this.activateInteractivePoint(morph);
    } catch (error) {
      if (!this.reportedError) console.warn('숨겨진 기록을 불러오지 못했습니다.', error);
      this.reportedError = true;
    }
  }

  activateInteractivePoint(morph) {
    // Search normalized target coordinates once, favouring the central area.
    let best = Infinity, selected;
    morph.text.targets.forEach((target, cloud) => {
      for (let i = 0; i < target.length; i += 3) {
        const score = (target[i] - morph.text.aspect * 0.12) ** 2
          + (target[i + 1] - 0.1) ** 2 + Math.abs(target[i + 2]) * 0.01;
        if (score < best) { best = score; selected = { cloud: morph.clouds[cloud], index: i / 3 }; }
      }
    });
    if (!selected) return;
    this.selected = selected;
    const points = selected.cloud;
    let entry = this.materials.get(points);
    if (!entry) {
      const attribute = new THREE.BufferAttribute(new Float32Array(points.geometry.attributes.position.count), 1);
      attribute.setUsage(THREE.DynamicDrawUsage);
      points.geometry.setAttribute('recordGlow', attribute);
      const original = points.material, material = original.clone();
      const uniforms = { recordPulse: { value: 0 }, recordSize: { value: 0 } };
      material.customProgramCacheKey = () => 'hidden-record-point-v1';
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = `attribute float recordGlow; varying float vRecordGlow;
          uniform float recordSize;\n` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `
          #include <fog_vertex>
          vRecordGlow = recordGlow;
          if (recordGlow > 0.5 && recordSize > 0.0) {
            gl_PointSize = recordSize;
            // Dense text vertices can otherwise completely bury this single dot.
            // Bias only its render depth; geometry and projected x/y stay intact.
            gl_Position.z = -0.99 * gl_Position.w;
          }
        `);
        shader.fragmentShader = `varying float vRecordGlow; uniform float recordPulse;\n` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_particle_fragment>', `
          if (vRecordGlow > 0.5 && recordPulse > 0.0) {
            float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
            if (radius > 1.0) discard;
            diffuseColor = vec4(vec3(recordPulse), 1.0 - smoothstep(0.18, 1.0, radius));
          } else {
            #include <map_particle_fragment>
          }
        `);
      };
      entry = { original, material, attribute, uniforms };
      this.materials.set(points, entry);
    }
    entry.attribute.setX(selected.index, 1);
    entry.attribute.needsUpdate = true;
    this.active = entry;
    // Keep the original material throughout the morph, switch only when ready.
  }

  clearPoint() {
    if (this.selected) {
      this.selected.cloud.material = this.active.original;
      this.active.attribute.setX(this.selected.index, 0);
      this.active.attribute.needsUpdate = true;
    }
    this.selected = null;
    this.active = null;
    this.hit.hidden = true;
  }

  screenPosition() {
    if (!this.selected) return null;
    const { cloud, index } = this.selected;
    this.vector.fromBufferAttribute(cloud.geometry.attributes.position, index);
    cloud.localToWorld(this.vector);
    this.vector.project(this.camera);
    if (this.vector.z < -1 || this.vector.z > 1 || Math.abs(this.vector.x) > 1 || Math.abs(this.vector.y) > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (this.vector.x + 1) * rect.width / 2,
      y: rect.top + (1 - this.vector.y) * rect.height / 2 };
  }

  update(time) {
    if (!this.selected) return;
    const ready = this.morph.blend === 1 && !this.morph.source
      && !document.body.classList.contains('credits-open');
    this.selected.cloud.material = ready ? this.active.material : this.active.original;
    const point = ready ? this.screenPosition() : null;
    this.hit.hidden = !point;
    if (!point) return;
    this.active.uniforms.recordSize.value = 8 * this.renderer.getPixelRatio();
    this.active.uniforms.recordPulse.value = 2.4 + Math.sin(time * Math.PI / 3) * 0.35;
    this.hit.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
  }
}
