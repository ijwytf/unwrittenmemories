import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { selectQuality, pixelRatioFor, pointCountsFor } from './quality.js';

const quality = selectQuality();
const debug = new URLSearchParams(location.search).has('debug');
const log = (...args) => { if (debug) console.log(...args); };
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

const status = document.createElement('div');
status.setAttribute('role', 'status');
status.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:calc(100% - 32px);color:#ddd;font:13px/1.5 sans-serif;pointer-events:none;z-index:1';
document.body.appendChild(status);
function showStatus(message = '') {
  status.textContent = message;
  status.hidden = !message;
}
showStatus('작품을 불러오는 중입니다…');

// ======================================================
// Scene
// ======================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);


// ======================================================
// Camera
// ======================================================

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
);


// ======================================================
// Renderer
// ======================================================

const renderer = new THREE.WebGLRenderer({
  antialias: quality.antialias
});

renderer.setPixelRatio(
  pixelRatioFor(quality, window.innerWidth, window.innerHeight, window.devicePixelRatio)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

document.body.appendChild(renderer.domElement);

// ======================================================
// Bloom
// ======================================================

const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

let afterimagePass = new AfterimagePass();

afterimagePass.uniforms['damp'].value = 0.90;

composer.addPass(afterimagePass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(
    window.innerWidth,
    window.innerHeight
  ),
  0.5,   // strength
  1.0,   // radius
  0.05    // threshold
);

// Keep the effect parameters; only reduce its internal buffers on mobile.
const setBloomSize = bloomPass.setSize.bind(bloomPass);
bloomPass.setSize = (width, height) => setBloomSize(
  Math.max(1, Math.round(width * quality.bloomResolution)),
  Math.max(1, Math.round(height * quality.bloomResolution))
);
composer.addPass(bloomPass);

// ======================================================
// Saturation
// ======================================================

const saturationShader = {

  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.5 }
  },

  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position =
        projectionMatrix *
        modelViewMatrix *
        vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;

    varying vec2 vUv;

    void main() {

      vec4 color =
        texture2D(tDiffuse, vUv);

      float gray =
        dot(
          color.rgb,
          vec3(0.299, 0.587, 0.114)
        );

      color.rgb =
        mix(
          vec3(gray),
          color.rgb,
          saturation
        );

      gl_FragColor = color;
    }
  `
};

const saturationPass =
  new ShaderPass(saturationShader);

composer.addPass(saturationPass);

// ======================================================
// Afterimage / Trail
// ======================================================

// ======================================================
// GLB Loader
// ======================================================

const loader = new GLTFLoader();

let pointCloudGroup = null;
const pointClouds = [];
let analyser = null;
let audioData = null;
let audioLevel = 0;
let smoothAudioLevel = 0;
let audioContext = null;
let microphoneStream = null;
let microphoneSource = null;
let microphonePending = false;
let microphoneEpoch = 0;

async function startMicrophone() {
  if (microphonePending) return;
  microphonePending = true;
  const epoch = microphoneEpoch;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('마이크는 HTTPS 또는 localhost에서 사용할 수 있습니다.');
    }
    // Create/resume synchronously with the gesture, before the permission prompt.
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext ??= new AudioContextClass();
    const resumed = audioContext.resume();
    if (analyser && microphoneStream?.active) {
      await resumed;
      showStatus();
      return;
    }
    await resumed;
    if (epoch !== microphoneEpoch) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (epoch !== microphoneEpoch) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    microphoneStream = stream;
    microphoneSource?.disconnect();
    microphoneSource = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    audioData = new Uint8Array(analyser.frequencyBinCount);
    microphoneSource.connect(analyser);
    if (document.hidden) await audioContext.suspend();
    showStatus();
    log('Microphone connected');
  } catch (error) {
    if (epoch !== microphoneEpoch) return;
    stopMicrophone();
    showStatus('마이크를 연결하지 못했습니다. 권한을 확인한 뒤 화면을 다시 눌러 주세요.');
    console.error('Microphone error:', error);
  } finally {
    microphonePending = false;
  }
}

function stopMicrophone() {
  microphoneEpoch++;
  microphoneSource?.disconnect();
  microphoneStream?.getTracks().forEach(track => track.stop());
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  microphoneSource = microphoneStream = audioContext = analyser = audioData = null;
  audioLevel = smoothAudioLevel = 0;
}

window.addEventListener('click', startMicrophone);

loader.load(

  quality.modelUrl,

  async (gltf) => {
    try {

    const model = gltf.scene;

    scene.add(model);
    // Publish only once conversion finishes, so async batches cannot rotate the
    // model while world scales and the original framing are being calculated.
    model.visible = false;
    model.position.x += 100;

    log('GLB loaded:', quality.modelUrl);


    // ==================================================
    // 모델 전체 크기 / 중심 계산
    // ==================================================

    const box = new THREE.Box3().setFromObject(model);

    const center = box.getCenter(
      new THREE.Vector3()
    );

    const size = box.getSize(
      new THREE.Vector3()
    );

    log('Model center:', center.toArray());
    log('Model size:', size.toArray());


    // 모델 중심을 월드 원점으로 이동
    model.position.sub(center);


    // ==================================================
    // Mesh → Point Cloud
    // ==================================================

    const meshes = [];

    // traverse 도중 구조를 변경하지 않도록
    // 먼저 Mesh 목록만 수집
    model.traverse((child) => {

      if (child.isMesh) {
        meshes.push(child);
      }

    });


    const pointCounts = pointCountsFor(
      meshes.map(mesh => mesh.geometry.attributes.position.count), quality
    );
    const oldGeometries = new Set();
    const oldMaterials = new Set();
    const oldTextures = new Set();
    const retainedTextures = new Set();
    // Keep hidden transform nodes for existing child hierarchies, but release
    // their large geometry/material references after every sampler has finished.
    const emptyGeometry = new THREE.BufferGeometry();
    const emptyMaterial = new THREE.MeshBasicMaterial();

    for (const [meshIndex, child] of meshes.entries()) {

  const originalGeometry = child.geometry;
  const originalMaterial = child.material;
  oldGeometries.add(originalGeometry);
  for (const material of (Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial])) {
    if (!material) continue;
    oldMaterials.add(material);
    for (const value of Object.values(material)) {
      if (value?.isTexture) oldTextures.add(value);
    }
  }

  // ==================================================
// Mesh 크기 계산
// ==================================================

originalGeometry.computeBoundingBox();

const meshSize = new THREE.Vector3();

originalGeometry.boundingBox.getSize(meshSize);

const meshMaxSize = Math.max(
  meshSize.x,
  meshSize.y,
  meshSize.z
);

  // 원래 Mesh의 vertex 개수
  const originalCount =
    originalGeometry.attributes.position.count;

  // 포인트 밀도
  // 숫자를 높일수록 점이 많아집니다.
  const pointCount = pointCounts[meshIndex];


  // ==================================================
  // Mesh 표면에서 포인트 샘플링
  // ==================================================

  const sampler =
    new MeshSurfaceSampler(child).build();

  const positions =
    new Float32Array(pointCount * 3);

  const uvs =
    new Float32Array(pointCount * 2);

  const position =
    new THREE.Vector3();

  const uv =
    new THREE.Vector2();


  for (let i = 0; i < pointCount; i++) {

    sampler.sample(
      position,
      undefined,
      undefined,
      uv
    );

    positions[i * 3] =
      position.x;

    positions[i * 3 + 1] =
      position.y;

    positions[i * 3 + 2] =
      position.z;

    uvs[i * 2] =
      uv.x;

    uvs[i * 2 + 1] =
      uv.y;

    if ((i + 1) % quality.conversionBatchSize === 0) await yieldToBrowser();

  }


  // ==================================================
  // 새로운 Point Geometry
  // ==================================================

  const pointGeometry =
    new THREE.BufferGeometry();

  pointGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions,
      3
    ).setUsage(THREE.DynamicDrawUsage)
  );

  pointGeometry.setAttribute(
    'uv',
    new THREE.BufferAttribute(
      uvs,
      2
    )
  );


  // ==================================================
  // Blender Texture 가져오기
  // ==================================================

  let texture = null;

  if (originalMaterial) {

    if (Array.isArray(originalMaterial)) {

      if (
        originalMaterial.length > 0 &&
        originalMaterial[0].map
      ) {

        texture =
          originalMaterial[0].map;

      }

    } else {

      texture =
        originalMaterial.map || null;

    }

  }

  if (texture) retainedTextures.add(texture);

  // ==================================================
  // Point Material
  // ==================================================

  const pointMaterial =
    new THREE.PointsMaterial({

      color: 0xffffff,

      // 점 자체의 크기
      size: 0.01,

      sizeAttenuation: true,

      // Blender의 원래 색상 Texture
      map: texture,

      transparent: true,

      alphaTest: 0.01

    });


  // ==================================================
  // Points 생성
  // ==================================================

  const points =

    new THREE.Points(
      pointGeometry,
      pointMaterial
    );

    points.name = child.name;

    const worldScale = new THREE.Vector3();
child.getWorldScale(worldScale);

const averageWorldScale =
  (Math.abs(worldScale.x) +
   Math.abs(worldScale.y) +
   Math.abs(worldScale.z)) / 3;

points.userData.worldScale =
  Math.max(averageWorldScale, 0.000001);
points.userData.scaleCompensation = THREE.MathUtils.clamp(
  1 / points.userData.worldScale, 1, 1000
);

    points.userData.meshSize =
  Math.max(meshMaxSize, 0.01);

    // 각 점의 원래 위치 저장
points.userData.originalPositions =
  positions.slice();
pointGeometry.computeBoundingSphere();
points.userData.baseRadius = pointGeometry.boundingSphere.radius;

// Noise용 랜덤값 저장
points.userData.randomOffsets =
  new Float32Array(pointCount);

// 각 포인트가 흩어질 고유 방향
points.userData.scatterDirections =
  new Float32Array(pointCount * 3);

for (let i = 0; i < pointCount; i++) {

  points.userData.randomOffsets[i] =
    Math.random() * Math.PI * 2;

  // 구면 전체에 랜덤한 방향 생성
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);

  points.userData.scatterDirections[i * 3] =
    radius * Math.cos(angle);

  points.userData.scatterDirections[i * 3 + 1] =
    radius * Math.sin(angle);

  points.userData.scatterDirections[i * 3 + 2] =
    z;
  if ((i + 1) % quality.conversionBatchSize === 0) await yieldToBrowser();
}

pointClouds.push(points);

log(
  'PointCloud:',
  child.name,
  'original:', originalCount,
  'points:', pointCount,
  'position:', child.position,
  'scale:', child.scale,
  'visible:', child.visible
);

log(
  'TRANSFORM:',
  child.name,
  'position:',
  child.position.x,
  child.position.y,
  child.position.z,
  'scale:',
  child.scale.x,
  child.scale.y,
  child.scale.z,
  'parentScale:',
  child.parent?.scale.x,
  child.parent?.scale.y,
  child.parent?.scale.z
);

  // 원래 Mesh의 Transform 유지
  points.position.copy(
    child.position
  );

  points.quaternion.copy(
    child.quaternion
  );

  points.scale.copy(
    child.scale
  );


  // 기존 Mesh와 같은 위치에 Points 추가
  child.parent.add(points);


  // 원래 Mesh 숨기기
  child.visible = false;

    if (Number.isFinite(quality.conversionBatchSize)) await yieldToBrowser();
    }

    for (const child of meshes) {
      child.geometry = emptyGeometry;
      child.material = emptyMaterial;
    }
    oldGeometries.forEach(geometry => geometry.dispose());
    oldMaterials.forEach(material => material.dispose());
    const retainedImages = new Set([...retainedTextures].map(texture => texture.image));
    const closedImages = new Set();
    oldTextures.forEach(texture => {
      if (retainedTextures.has(texture)) return;
      texture.dispose();
      const image = texture.image;
      if (!retainedImages.has(image) && !closedImages.has(image)) {
        image?.close?.();
        closedImages.add(image);
      }
    });


    // ==================================================
    // Camera 자동 배치
    // ==================================================

    const maxDim = Math.max(
      size.x,
      size.y,
      size.z
    );

    camera.position.set(
      0,
      0,
      maxDim * 1.2
    );

    camera.near =
      Math.max(
        maxDim / 1000,
        0.001
      );

    camera.far =
      maxDim * 100;

    camera.updateProjectionMatrix();

    camera.lookAt(
      -2.5,
      0,
      0
    );


    model.visible = true;
    pointCloudGroup = model;
    showStatus();
    log(
      'Point Cloud conversion complete'
    );
    } catch (error) {
      showStatus('작품을 준비하지 못했습니다. 페이지를 새로고침해 주세요.');
      console.error('Point Cloud conversion error:', error);
    }
  },


  // Loading progress
  (progress) => {

    if (progress.total) {

      const percent =
        progress.loaded /
        progress.total *
        100;

      log(
        `Loading: ${percent.toFixed(1)}%`
      );

    }

  },


  // Error
  (error) => {
    showStatus('작품을 불러오지 못했습니다. 네트워크 연결을 확인하고 새로고침해 주세요.');
    console.error(
      'GLB load error:',
      error
    );

  }

);


// ======================================================
// Animation
// ======================================================

let frameCount = 0;
let animationId = null;
let lastFrameTime = null;
let lastPointUpdate = null;
let renderSchedule = null;
let resizePending = true;
let contextLost = false;
let renderedFrames = 0;

function animate(now) {
  animationId = null;
  if (document.hidden || contextLost) return;
  animationId = requestAnimationFrame(animate);
  if (resizePending) resizeViewport();
  // No blank postprocessing work while the large model is still being prepared.
  if (!pointCloudGroup) return;

  const interval = 1000 / quality.maxFps;
  if (renderSchedule !== null && now - renderSchedule < interval - 0.5) return;
  renderSchedule = interval > 0 && renderSchedule !== null
    ? renderSchedule + Math.max(1, Math.floor((now - renderSchedule + 0.5) / interval)) * interval
    : now;
  const delta = lastFrameTime === null ? 1 / 60 : Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  // Desktop preserves the existing per-frame behavior. Mobile's 30 FPS uses
  // elapsed time to retain the feel of the original 60 FPS rotation and lag.
  const frameScale = Number.isFinite(quality.maxFps) ? delta * 60 : 1;

  frameCount++;

  const time = now * 0.001;
  // ==============================================
  // Microphone volume
  // ==============================================

  if (analyser && audioData && audioContext?.state === 'running' && microphoneStream?.active) {
    analyser.smoothingTimeConstant = Math.pow(0.8, frameScale);
    analyser.getByteFrequencyData(audioData);

    let sum = 0;

    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i];
    }

    audioLevel =
      sum / audioData.length / 255;

  } else {
    audioLevel = 0;
  }

// 천천히 따라오도록 smoothing
// ==============================================
// Audio Lag - 빠르게 반응 / 천천히 복귀
// ==============================================

const attack = 1 - Math.pow(1 - 0.35, frameScale);
const release = 1 - Math.pow(1 - 0.02, frameScale);

if (audioLevel > smoothAudioLevel) {

  // 소리가 커질 때 → 빠르게 퍼짐
  smoothAudioLevel +=
    (audioLevel - smoothAudioLevel) * attack;

} else {

  // 소리가 작아질 때 → 천천히 원래대로
  smoothAudioLevel +=
    (audioLevel - smoothAudioLevel) * release;

}

// 작은 주변 소음 제거
const reactiveAudio =
  Math.max(0, smoothAudioLevel - 0.01);

// 반응 강도
const audioStrength =
  reactiveAudio * 20.0;

  if (debug && frameCount % 120 === 0) {
  log(
    'audio:',
    audioLevel.toFixed(3),
    'strength:',
    audioStrength.toFixed(3)
  );
}

  // 전체 모델 회전
  if (pointCloudGroup) {
    pointCloudGroup.rotation.y += 0.002 * frameScale;
  }

  // Desktop keeps its original cadence; mobile updates at most 30 times/second.
  const updatePoints = Number.isFinite(quality.maxFps)
    ? lastPointUpdate === null || now - lastPointUpdate >= 1000 / quality.pointUpdateHz - 0.5
    : frameCount % 2 === 0;
  if (updatePoints) {
    lastPointUpdate = now;

    pointClouds.forEach((points) => {

      const positionAttribute =
        points.geometry.attributes.position;

      const positions =
        positionAttribute.array;

      const originals =
        points.userData.originalPositions;

      const randomOffsets =
        points.userData.randomOffsets;

      const amplitude = 0.08;
      const speed = 1.2;
      const scatter = points.userData.scatterDirections;
      const scatterAmount = audioStrength * points.userData.scaleCompensation;
      const phaseX = time * speed;
      const phaseY = phaseX * 0.73;
      const phaseZ = phaseX * 0.91;

      for (let i = 0; i < randomOffsets.length; i++) {

        const i3 = i * 3;
        const offset = randomOffsets[i];

        const moveX =
          Math.sin(phaseX + offset)
          * amplitude;

        const moveY =
          Math.sin(
            phaseY +
            offset * 1.7
          ) * amplitude;

        const moveZ =
          Math.cos(
            phaseZ +
            offset * 2.3
          ) * amplitude;

positions[i3] =
  originals[i3]
  + moveX
  + scatter[i3] * scatterAmount;

positions[i3 + 1] =
  originals[i3 + 1]
  + moveY
  + scatter[i3 + 1] * scatterAmount;

positions[i3 + 2] =
  originals[i3 + 2]
  + moveZ
  + scatter[i3 + 2] * scatterAmount;
      }

      positionAttribute.needsUpdate = true;
      // A conservative bound follows displacement without rescanning all points.
      points.geometry.boundingSphere.radius = points.userData.baseRadius
        + Math.sqrt(3) * amplitude + Math.abs(scatterAmount);

    });

  }

  afterimagePass.uniforms.damp.value = Math.pow(0.90, frameScale);
  composer.render(delta);
  renderedFrames++;
}

function startAnimation() {
  if (animationId !== null || document.hidden || contextLost) return;
  lastFrameTime = lastPointUpdate = renderSchedule = null;
  animationId = requestAnimationFrame(animate);
}

function pauseAnimation() {
  if (animationId !== null) cancelAnimationFrame(animationId);
  animationId = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseAnimation();
    audioContext?.suspend().catch(() => {});
  } else {
    resizePending = true;
    audioContext?.resume().catch(() => {});
    startAnimation();
  }
});
window.addEventListener('pagehide', () => {
  pauseAnimation();
  stopMicrophone();
});
window.addEventListener('pageshow', () => {
  resizePending = true;
  startAnimation();
});
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  contextLost = true;
  pauseAnimation();
  showStatus('그래픽 연결이 중단되었습니다. 복구를 기다리는 중입니다…');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  // Previous-frame images are invalid after GPU context restoration.
  const passIndex = composer.passes.indexOf(afterimagePass);
  afterimagePass.dispose();
  afterimagePass = new AfterimagePass();
  afterimagePass.uniforms.damp.value = 0.90;
  composer.passes[passIndex] = afterimagePass;
  resizePending = true;
  showStatus(pointCloudGroup ? '' : '작품을 불러오는 중입니다…');
  startAnimation();
});


// ======================================================
// Window Resize
// ======================================================

function resizeViewport() {
  resizePending = false;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const ratio = pixelRatioFor(quality, width, height, window.devicePixelRatio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (renderer.getPixelRatio() !== ratio) {
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
  }
  renderer.setSize(width, height);
  composer.setSize(width, height);
}

const requestResize = () => { resizePending = true; };
window.addEventListener('resize', requestResize);
window.addEventListener('orientationchange', requestResize);
window.visualViewport?.addEventListener('resize', requestResize);
startAnimation();
