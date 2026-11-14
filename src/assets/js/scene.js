// Three.js scene: a house wall, a terrace and a parametric pergola rebuilt from the configuration.
// Units are metres. x runs along the width, z from the house wall (back, negative) to the garden (front, positive).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { COLORS } from './config.js';

const POST = 0.12;
const BEAM = 0.2;
const DECK = 0.12;
const LAMELLA_PITCH = 0.21;
// The quote preview is always this size, so it fills the 16:10.5 frame in the dialog and on the printout.
const SNAPSHOT = { width: 1280, height: 840 };

// Camera directions for the view buttons; "start" is the three-quarter view from the garden.
const DIRECTIONS = {
  start: [0.6, 0.4, 0.74],
  front: [0, 0.12, 1],
  side: [1, 0.14, 0.1],
  top: [0, 1, 0.07],
};

// Polycarbonate and glass roofs slope 8° towards the garden; lamellas are flat.
function roofRise({ roof, depth }) {
  return roof === 'lamele' ? 0 : Math.round(depth * Math.tan((8 * Math.PI) / 180) * 100) / 100;
}

// Deterministic pseudo-random numbers, so the wood texture looks the same on every load and in screenshots.
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const next = random(7);
  ctx.fillStyle = '#9a6a42';
  ctx.fillRect(0, 0, 256, 256);
  for (let line = 0; line < 70; line += 1) {
    const y = next() * 256;
    const tone = 70 + next() * 50;
    ctx.strokeStyle = `rgba(${tone}, ${tone * 0.62}, ${tone * 0.38}, ${0.25 + next() * 0.35})`;
    ctx.lineWidth = 1 + next() * 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x / 37 + line) * 2.2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function box(width, height, depth, material, { shadow = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

// A beam between two points in the y–z plane, e.g. a sloped side beam or rafter.
function slopedBeam(width, height, from, to, material, options) {
  const length = Math.hypot(to.z - from.z, to.y - from.y);
  const mesh = box(width, height, length, material, options);
  mesh.position.set(from.x, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.rotation.x = -Math.atan2(to.y - from.y, to.z - from.z);
  return mesh;
}

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  camera.position.set(6.4, 3.7, 8.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.25, 0);
  controls.enableDamping = true;
  controls.minDistance = 3.5;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.autoRotateSpeed = 1.4;

  const hemi = new THREE.HemisphereLight('#ffffff', '#8c8a7c', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff6e8', 2.4);
  sun.position.set(-5, 9, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const materials = {
    frame: new THREE.MeshStandardMaterial({ color: '#383e42', metalness: 0.45, roughness: 0.42 }),
    polycarbonate: new THREE.MeshStandardMaterial({ color: '#f7fafb', transparent: true, opacity: 0.58, roughness: 0.65, side: THREE.DoubleSide, depthWrite: false }),
    glass: new THREE.MeshStandardMaterial({ color: '#cfe6ee', transparent: true, opacity: 0.24, roughness: 0.04, metalness: 0.15, side: THREE.DoubleSide, depthWrite: false }),
    fabric: new THREE.MeshStandardMaterial({ color: '#6e695f', transparent: true, opacity: 0.74, roughness: 0.95, side: THREE.DoubleSide }),
    plinth: new THREE.MeshStandardMaterial({ color: '#a39e93', roughness: 0.9 }),
    eave: new THREE.MeshStandardMaterial({ color: '#3a3d41', roughness: 0.7 }),
    led: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffc777', emissiveIntensity: 0.5 }),
    lawn: new THREE.MeshStandardMaterial({ color: '#a3b48c', roughness: 1 }),
    deck: new THREE.MeshStandardMaterial({ color: '#ddd6c9', roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: 0.95 }),
    window: new THREE.MeshStandardMaterial({ color: '#36434d', roughness: 0.15, metalness: 0.3, emissive: '#ffcf8a', emissiveIntensity: 0 }),
    sill: new THREE.MeshStandardMaterial({ color: '#2f3236', roughness: 0.6 }),
    pot: new THREE.MeshStandardMaterial({ color: '#b9734d', roughness: 0.9 }),
    leaves: new THREE.MeshStandardMaterial({ color: '#4f7a4a', roughness: 0.9 }),
    sofa: new THREE.MeshStandardMaterial({ color: '#8f9488', roughness: 1 }),
    table: new THREE.MeshStandardMaterial({ color: '#7b5a3e', roughness: 0.7 }),
  };
  const wood = woodTexture();

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), materials.lawn);
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  scene.add(lawn);

  const world = new THREE.Group();
  scene.add(world);
  const pergola = new THREE.Group();
  scene.add(pergola);
  const ledLights = [];

  let current = null;
  let night = false;
  let tween = null;

  function disposeGroup(group) {
    group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
    group.clear();
  }

  // House wall with a glazed door, terrace slab, two plants and a small lounge set for scale.
  function buildWorld(config) {
    disposeGroup(world);
    const { width, depth } = config;
    const wall = box(16, 4.4, 0.4, materials.wall);
    wall.position.set(0, 2.2, -depth / 2 - 0.2);
    const plinth = box(16, 0.35, 0.44, materials.plinth, { shadow: false });
    plinth.position.set(0, 0.175, -depth / 2 - 0.2);
    const eave = box(16.4, 0.26, 0.8, materials.eave);
    eave.position.set(0, 4.5, -depth / 2 - 0.05);
    world.add(wall, plinth, eave);
    const door = box(2.6, 2.3, 0.06, materials.window, { shadow: false });
    door.position.set(-0.4, DECK + 1.15, -depth / 2 + 0.03);
    world.add(door);
    for (const x of [-1.7, -0.4, 0.9]) {
      const mullion = box(0.07, 2.3, 0.08, materials.sill, { shadow: false });
      mullion.position.set(x, DECK + 1.15, -depth / 2 + 0.05);
      world.add(mullion);
    }
    const deck = box(width + 1.8, DECK, depth + 1.2, materials.deck, { shadow: false });
    deck.position.set(0, DECK / 2, 0.6);
    world.add(deck);

    for (const side of [-1, 1]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 20), materials.pot);
      pot.position.set(side * (width / 2 + 0.55), DECK + 0.25, -depth / 2 + 0.5);
      pot.castShadow = true;
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), materials.leaves);
      leaves.position.set(pot.position.x, DECK + 0.85, pot.position.z);
      leaves.castShadow = true;
      world.add(pot, leaves);
    }

    const sofaWidth = Math.min(2.2, width - 1);
    const sofa = new THREE.Group();
    const seat = box(sofaWidth, 0.42, 0.85, materials.sofa);
    seat.position.set(0, DECK + 0.21, 0);
    const back = box(sofaWidth, 0.45, 0.2, materials.sofa);
    back.position.set(0, DECK + 0.6, -0.33);
    sofa.add(seat, back);
    for (const side of [-1, 1]) {
      const arm = box(0.18, 0.62, 0.85, materials.sofa);
      arm.position.set(side * (sofaWidth / 2 - 0.09), DECK + 0.31, 0);
      sofa.add(arm);
    }
    sofa.position.set(-width / 2 + sofaWidth / 2 + 0.35, 0, -depth / 2 + 0.75);
    const table = box(0.9, 0.06, 0.55, materials.table);
    table.position.set(sofa.position.x, DECK + 0.38, sofa.position.z + 1.05);
    const tableBase = box(0.5, 0.32, 0.3, materials.table);
    tableBase.position.set(table.position.x, DECK + 0.18, table.position.z);
    world.add(sofa, table, tableBase);
  }

  function buildPergola(config) {
    disposeGroup(pergola);
    for (const light of ledLights.splice(0)) scene.remove(light);
    const { width: w, depth: d, height: h, roof, mount } = config;
    const frame = materials.frame;
    const top = DECK + h;
    const rise = roofRise(config);
    const xEdge = w / 2 - POST / 2;
    const zFront = d / 2 - POST / 2;
    const zBack = -d / 2 + POST / 2;

    // Posts: two at the front, two more at the back for a freestanding pergola.
    const posts = [[-xEdge, zFront, h], [xEdge, zFront, h]];
    if (mount === 'wolnostojaca') posts.push([-xEdge, zBack, h + rise], [xEdge, zBack, h + rise]);
    for (const [x, z, height] of posts) {
      const post = box(POST, height, POST, frame);
      post.position.set(x, DECK + height / 2, z);
      pergola.add(post);
    }

    // Front beam with gutter, back beam (wall ledger or beam on posts) and sloped side beams.
    const front = box(w, BEAM, POST + 0.02, frame);
    front.position.set(0, top - BEAM / 2, zFront);
    const backBeam = box(w, BEAM * 0.8, POST, frame);
    backBeam.position.set(0, top + rise - BEAM * 0.4, zBack);
    pergola.add(front, backBeam);
    for (const x of [-xEdge, xEdge]) {
      pergola.add(slopedBeam(POST, BEAM * 0.8, { x, y: top + rise - BEAM * 0.4, z: zBack }, { x, y: top - BEAM * 0.4, z: zFront }, frame));
    }

    if (roof === 'lamele') {
      const count = Math.max(4, Math.floor((d - 2 * POST) / LAMELLA_PITCH));
      const start = -((count - 1) * LAMELLA_PITCH) / 2;
      const angle = (config.angle * Math.PI) / 180;
      for (let index = 0; index < count; index += 1) {
        const lamella = box(w - 2 * POST, 0.028, 0.2, frame);
        lamella.position.set(0, top - BEAM / 2, start + index * LAMELLA_PITCH);
        lamella.rotation.x = angle;
        pergola.add(lamella);
      }
    } else {
      const panelMaterial = roof === 'szklo' ? materials.glass : materials.polycarbonate;
      const rafters = Math.max(2, Math.round(w / 0.85));
      for (let index = 0; index <= rafters; index += 1) {
        const x = -w / 2 + POST / 2 + ((w - POST) * index) / rafters;
        pergola.add(slopedBeam(0.05, 0.09, { x, y: top + rise + 0.045, z: zBack }, { x, y: top + 0.045, z: zFront }, frame));
      }
      const panel = slopedBeam(w - 0.02, 0.014, { x: 0, y: top + rise + 0.1, z: zBack - 0.04 }, { x: 0, y: top + 0.1, z: zFront + 0.12 }, panelMaterial, { shadow: false });
      pergola.add(panel);
    }

    // ZIP screens hang from the beams; the drop slider says how far they are lowered.
    const clear = h - BEAM;
    const drop = (clear * config.drop) / 100;
    for (const side of config.screens) {
      const isFront = side === 'front';
      const span = isFront ? w - 2 * POST : d - 2 * POST;
      const cassette = box(isFront ? span : 0.1, 0.11, isFront ? 0.1 : span, frame);
      const x = isFront ? 0 : (side === 'lewa' ? -xEdge : xEdge);
      const z = isFront ? zFront + 0.02 : 0;
      cassette.position.set(x, top - BEAM - 0.055, z);
      pergola.add(cassette);
      if (drop > 0.02) {
        const fabric = box(isFront ? span : 0.012, drop, isFront ? 0.012 : span, materials.fabric);
        fabric.position.set(x, top - BEAM - 0.11 - drop / 2, z);
        pergola.add(fabric);
      }
    }

    if (config.led) {
      const strip = box(w - 0.3, 0.014, 0.025, materials.led, { shadow: false });
      strip.position.set(0, top - BEAM - 0.007, zFront - 0.04);
      pergola.add(strip);
      for (const x of [-xEdge + 0.05, xEdge - 0.05]) {
        pergola.add(slopedBeam(0.025, 0.014, { x, y: top + rise - BEAM * 0.8 - 0.007, z: zBack + 0.2 }, { x, y: top - BEAM * 0.8 - 0.007, z: zFront - 0.2 }, materials.led, { shadow: false }));
      }
      for (const x of [-w / 4, w / 4]) {
        const light = new THREE.PointLight('#ffbe6b', 0, 7, 1.6);
        light.position.set(x, top - 0.35, 0.2);
        ledLights.push(light);
        scene.add(light);
      }
    }
    applyLighting();
  }

  function applyColor(colorId) {
    const color = COLORS.find((option) => option.id === colorId) ?? COLORS[0];
    const frame = materials.frame;
    if (colorId === 'drewno') {
      frame.map = wood;
      frame.color.set('#ffffff');
      frame.metalness = 0.05;
      frame.roughness = 0.75;
    } else {
      frame.map = null;
      frame.color.set(color.hex);
      frame.metalness = colorId === '9016' ? 0.2 : 0.45;
      frame.roughness = 0.42;
    }
    frame.needsUpdate = true;
  }

  function applyLighting() {
    scene.background = new THREE.Color(night ? '#141c2b' : '#dce6ec');
    scene.fog = new THREE.Fog(night ? '#141c2b' : '#dce6ec', 24, 70);
    hemi.intensity = night ? 0.16 : 1.15;
    sun.intensity = night ? 0.05 : 2.4;
    materials.window.emissiveIntensity = night ? 0.55 : 0;
    const ledOn = night && current?.led;
    materials.led.emissiveIntensity = ledOn ? 3.2 : 0.5;
    for (const light of ledLights) light.intensity = ledOn ? 4.5 : 0;
  }

  // Points that must stay in the picture: the pergola with its roof and the two plants by the wall.
  function framePoints(config) {
    const { width: w, depth: d, height: h } = config;
    const roofTop = DECK + h + roofRise(config) + 0.12;
    const points = [];
    for (const x of [-w / 2, w / 2]) {
      for (const y of [0, roofTop]) {
        for (const z of [-d / 2, d / 2]) points.push(new THREE.Vector3(x, y, z));
      }
    }
    for (const side of [-1, 1]) points.push(new THREE.Vector3(side * (w / 2 + 0.97), DECK + 1.27, -d / 2 + 0.5));
    return points;
  }

  // Finds the closest camera distance at which every frame point fits on screen, for any size and aspect ratio.
  // The top edge keeps room for the view buttons.
  const probe = new THREE.PerspectiveCamera(camera.fov, 1, 0.1, 120);
  const projected = new THREE.Vector3();

  function fit(name, aspect = camera.aspect) {
    const direction = new THREE.Vector3(...(DIRECTIONS[name] ?? DIRECTIONS.start)).normalize();
    const target = name === 'top' ? new THREE.Vector3(0, 0, 0.3) : new THREE.Vector3(0, (DECK + current.height) / 2, 0.2);
    const points = framePoints(current);
    probe.aspect = aspect;
    probe.updateProjectionMatrix();
    let near = 2;
    let far = 60;
    for (let step = 0; step < 22; step += 1) {
      const distance = (near + far) / 2;
      probe.position.copy(target).addScaledVector(direction, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      const inside = points.every((point) => {
        projected.copy(point).project(probe);
        return Math.abs(projected.x) < 0.92 && projected.y < 0.76 && projected.y > -0.92 && projected.z < 1;
      });
      if (inside) far = distance;
      else near = distance;
    }
    return { position: target.clone().addScaledVector(direction, far), target };
  }

  // Until someone drags the model or picks a view, the camera follows size changes.
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; });

  function view(name, animate = true) {
    if (!current) return;
    const goal = fit(name);
    if (!animate) {
      camera.position.copy(goal.position);
      controls.target.copy(goal.target);
      return;
    }
    tween = { from: camera.position.clone(), fromTarget: controls.target.clone(), to: goal.position, toTarget: goal.target, start: performance.now(), duration: 650 };
  }

  function update(config) {
    const previous = current;
    current = config;
    const geometryChanged = !previous || ['width', 'depth', 'height', 'mount', 'roof', 'angle', 'drop', 'led'].some((key) => previous[key] !== config[key])
      || previous.screens.join() !== config.screens.join();
    const sizeChanged = !previous || previous.width !== config.width || previous.depth !== config.depth;
    if (sizeChanged) buildWorld(config);
    if (geometryChanged) buildPergola(config);
    if (!previous || previous.color !== config.color) applyColor(config.color);
    if (!previous) view('start', false);
    else if (sizeChanged && !userMoved) view('start');
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas.parentElement;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    if (current && !userMoved) {
      tween = null;
      view('start', false);
    }
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  function frame(now) {
    if (tween) {
      const progress = Math.min(1, (now - tween.start) / tween.duration);
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(tween.from, tween.to, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      if (progress === 1) tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    update,
    view(name) {
      userMoved = true;
      view(name);
    },
    setNight(value) {
      night = value;
      applyLighting();
    },
    setAutoRotate(value) {
      controls.autoRotate = value;
    },
    // A fixed-size picture from the three-quarter view, whatever angle the visitor left the model at.
    snapshot() {
      const shot = new THREE.PerspectiveCamera(camera.fov, SNAPSHOT.width / SNAPSHOT.height, 0.1, 120);
      const goal = fit('start', shot.aspect);
      shot.position.copy(goal.position);
      shot.lookAt(goal.target);
      const ratio = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(SNAPSHOT.width, SNAPSHOT.height, false);
      renderer.render(scene, shot);
      const url = renderer.domElement.toDataURL('image/jpeg', 0.86);
      renderer.setPixelRatio(ratio);
      resize();
      renderer.render(scene, camera);
      return url;
    },
  };
}
