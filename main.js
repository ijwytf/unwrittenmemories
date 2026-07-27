import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  antialias: true
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, 1.1)
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

const afterimagePass = new AfterimagePass();

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

async function startMicrophone() {

    console.log('startMicrophone 실행됨');

  try {

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });

    const audioContext =
      new AudioContext();

    const source =
      audioContext.createMediaStreamSource(stream);

    analyser =
      audioContext.createAnalyser();

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    audioData =
      new Uint8Array(
        analyser.frequencyBinCount
      );

    source.connect(analyser);

    console.log('Microphone connected');

  } catch (error) {

    console.error(
      'Microphone error:',
      error
    );

  }
}

window.addEventListener('click', async () => {

  console.log('화면 클릭 감지');

  if (!analyser) {
    console.log('마이크 연결 시도');
    await startMicrophone();
  }

});

loader.load(

  './ptc.glb',

  (gltf) => {

    const model = gltf.scene;

    scene.add(model);
    pointCloudGroup = model;
    pointCloudGroup.position.x += 100;

    console.log('GLB loaded:', gltf);


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

    console.log('Model center:', center);
    console.log('Model size:', size);


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


    meshes.forEach((child) => {

  const originalGeometry = child.geometry;
  const originalMaterial = child.material;

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
  const pointCount = Math.max(
  100,
  Math.floor(originalCount * 0.2)
);


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

  const normal =
    new THREE.Vector3();

  const uv =
    new THREE.Vector2();


  for (let i = 0; i < pointCount; i++) {

    sampler.sample(
      position,
      normal,
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
    )
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

    points.userData.meshSize =
  Math.max(meshMaxSize, 0.01);

    // 각 점의 원래 위치 저장
points.userData.originalPositions =
  positions.slice();

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
}

pointClouds.push(points);

console.log(
  'PointCloud:',
  child.name,
  'original:', originalCount,
  'points:', pointCount,
  'position:', child.position,
  'scale:', child.scale,
  'visible:', child.visible
);

console.log(
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


    console.log(
      'Point Cloud conversion complete'
    );

  },


  // Loading progress
  (progress) => {

    if (progress.total) {

      const percent =
        progress.loaded /
        progress.total *
        100;

      console.log(
        `Loading: ${percent.toFixed(1)}%`
      );

    }

  },


  // Error
  (error) => {

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

function animate() {

  requestAnimationFrame(animate);

  frameCount++;

  const time = performance.now() * 0.001;
  // ==============================================
  // Microphone volume
  // ==============================================

  if (analyser && audioData) {

    analyser.getByteFrequencyData(audioData);

    let sum = 0;

    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i];
    }

    audioLevel =
      sum / audioData.length / 255;

  }

// 천천히 따라오도록 smoothing
// ==============================================
// Audio Lag - 빠르게 반응 / 천천히 복귀
// ==============================================

const attack = 0.35;
const release = 0.02;

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

  if (frameCount % 30 === 0) {
  console.log(
    'audio:',
    audioLevel.toFixed(3),
    'strength:',
    audioStrength.toFixed(3)
  );
}

  // 전체 모델 회전
  if (pointCloudGroup) {
    pointCloudGroup.rotation.y += 0.002;
  }

  // Noise는 2프레임에 한 번만 계산
  if (frameCount % 2 === 0) {

    pointClouds.forEach((points) => {

      if (frameCount % 120 === 0) {
  console.log(
    'ANIMATING:',
    points.name || 'unnamed',
    points.geometry.attributes.position.count,
    points.userData.scatterDirections?.length
  );
}

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

      for (let i = 0; i < randomOffsets.length; i++) {

        const i3 = i * 3;
        const offset = randomOffsets[i];

        const moveX =
          Math.sin(time * speed + offset)
          * amplitude;

        const moveY =
          Math.sin(
            time * speed * 0.73 +
            offset * 1.7
          ) * amplitude;

        const moveZ =
          Math.cos(
            time * speed * 0.91 +
            offset * 2.3
          ) * amplitude;

        // 원점에서 포인트가 향하는 방향
          const scatter =
  points.userData.scatterDirections;

const worldScale =
  points.userData.worldScale || 1;

// 작은 scale을 가진 Mesh의 이동량 보정
const scaleCompensation =
  THREE.MathUtils.clamp(
    1 / worldScale,
    1,
    1000
  );

const scatterAmount =
  audioStrength * scaleCompensation;

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

    });

  }

  composer.render();
}

animate();


// ======================================================
// Window Resize
// ======================================================

window.addEventListener(
  'resize',
  () => {

    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

  }
);