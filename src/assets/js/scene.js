// Three.js scene: a house, a garden, a terrace and a parametric pergola rebuilt from the configuration.
// Units are metres. x runs along the width, z from the house wall (back, negative) to the garden (front, positive).
// Textures are drawn in code (textures.js); the sky, clouds and their reflections come from a small shader.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { COLORS } from './config.js';
import * as draw from './textures.js';

const POST = 0.12;
const BEAM = 0.2;
const DECK = 0.12;
const LAMELLA_PITCH = 0.21;
// The quote preview is always this size, so it fills the 16:10.5 frame in the dialog and on the printout.
const SNAPSHOT = { width: 1280, height: 840 };

// The house: 16 m wide, a terrace door and a window set into the wall with real reveals.
const HOUSE = { half: 8, height: 4.4, depth: 9.4, ridge: 7.3 };
const DOOR = { x: 0.9, width: 2.6, height: 2.3 };
const WINDOW = { x: -3.6, width: 1.3, height: 1.4, sill: 0.95 };

// Camera directions for the view buttons; "start" is the three-quarter view from the garden.
const DIRECTIONS = {
  start: [0.6, 0.4, 0.74],
  front: [0, 0.12, 1],
  side: [1, 0.14, 0.1],
  top: [0, 1, 0.07],
};

// Sky, clouds, sunlight and moonlight for day and evening.
const SKY = {
  day: { zenith: '#4a82c4', horizon: '#dae5ec', ground: '#7d8070', sun: '#fff1d6', light: '#fff2df', intensity: 3, ambient: 0.9, clouds: '#f7f9fb', cloudiness: 1 },
  night: { zenith: '#0b1428', horizon: '#2a3756', ground: '#0c1016', sun: '#000000', light: '#a8bcff', intensity: 0.35, ambient: 1, clouds: '#1d2539', cloudiness: 0.6 },
};

// Polycarbonate and glass roofs slope 8° towards the garden; lamellas are flat.
function roofRise({ roof, depth }) {
  return roof === 'lamele' ? 0 : Math.round(depth * Math.tan((8 * Math.PI) / 180) * 100) / 100;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Lets the browser handle clicks and scrolling between the heavier loading steps.
const pause = () => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

// Box projection: UVs in metres taken from vertex positions, so every part shows its texture at the same scale.
// `along` is the axis the texture's u direction (wood grain, deck boards) follows wherever a face allows it.
// `shift` moves the texture so identical parts next to each other differ; `origin` makes UVs continue across pieces.
function worldUV(geometry, along, { shift = 0, origin = null } = {}) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const point = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < position.count; index += 1) {
    point.x = position.getX(index) + (origin?.x ?? 0);
    point.y = position.getY(index) + (origin?.y ?? 0);
    point.z = position.getZ(index) + (origin?.z ?? 0);
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    const plane = nx >= ny && nx >= nz ? ['z', 'y'] : ny >= nz ? ['x', 'z'] : ['x', 'y'];
    const u = plane.includes(along) ? along : plane[0];
    const v = plane[0] === u ? plane[1] : plane[0];
    uv.setXY(index, point[u] + shift, point[v] + shift * 0.37);
  }
  uv.needsUpdate = true;
  return geometry;
}

// A profile or board with slightly rounded edges, which catch the light like real aluminium profiles.
function member(width, height, depth, material, { along = 'x', radius = 0.008, shadow = true, shift = 0, origin = null } = {}) {
  const rounded = Math.min(radius, width / 2, height / 2, depth / 2) - 0.0005;
  const geometry = rounded > 0.002 ? new RoundedBoxGeometry(width, height, depth, 2, rounded) : new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(worldUV(geometry, along, { shift, origin }), material);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

// A member between two points in the y–z plane, e.g. a sloped side beam, rafter or roof slope.
function slopedMember(width, height, from, to, material, options = {}) {
  const length = Math.hypot(to.z - from.z, to.y - from.y);
  const mesh = member(width, height, length, material, { along: 'z', ...options });
  mesh.position.set(from.x, (from.y + to.y) / 2, (from.z + to.z) / 2);
  mesh.rotation.x = -Math.atan2(to.y - from.y, to.z - from.z);
  return mesh;
}

// Lamella with an elliptical profile, 20 × 3.4 cm, running along x.
function lamellaGeometry(length, shift) {
  const geometry = new THREE.CylinderGeometry(1, 1, length, 24, 1);
  geometry.rotateZ(Math.PI / 2);
  geometry.scale(1, 0.017, 0.1);
  return worldUV(geometry, 'x', { shift });
}

// A tapered, slightly bent blade of ornamental grass, 1 m tall before scaling.
function bladeGeometry() {
  const geometry = new THREE.PlaneGeometry(0.02, 1, 1, 5);
  geometry.translate(0, 0.5, 0);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const t = position.getY(index);
    position.setX(index, position.getX(index) * (1 - t * 0.85));
    position.setZ(index, t * t * 0.3);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A sheer curtain with soft pleats.
function curtainGeometry(width, height) {
  const geometry = new THREE.PlaneGeometry(width, height, 28, 1);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) position.setZ(index, Math.sin(position.getX(index) * 26) * 0.035);
  geometry.computeVertexNormals();
  return geometry;
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      cloudColor: { value: new THREE.Color() },
      cloudiness: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 ground;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform vec3 cloudColor;
      uniform float cloudiness;
      varying vec3 vDirection;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int octave = 0; octave < 5; octave++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec2(17.3, 9.1);
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec3 direction = normalize(vDirection);
        vec3 sky = mix(horizon, zenith, pow(clamp(direction.y, 0.0, 1.0), 0.55));
        vec3 below = mix(horizon, ground, smoothstep(0.0, 0.2, -direction.y));
        vec3 color = direction.y >= 0.0 ? sky : below;
        if (direction.y > 0.0) {
          // Clouds projected on a flat layer above, thinning out towards the horizon.
          vec2 layer = direction.xz / (direction.y + 0.1) * 1.4;
          float density = smoothstep(0.5, 0.78, fbm(layer + vec2(3.0, 1.0)));
          float shade = fbm(layer * 1.7 - sunDirection.xz);
          float fade = smoothstep(0.03, 0.3, direction.y);
          color = mix(color, cloudColor * (0.72 + 0.4 * shade), density * fade * cloudiness);
        }
        float sun = max(dot(direction, sunDirection), 0.0);
        color += sunColor * (pow(sun, 900.0) * 30.0 + pow(sun, 24.0) * 0.35);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export async function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping keeps RAL colours close to the colour cards.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.transmissionResolutionScale = 0.8;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 150);
  camera.position.set(6.4, 3.7, 8.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.25, 0);
  controls.enableDamping = true;
  controls.minDistance = 3.5;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI * 0.495;
  // The camera stays in the garden: it cannot swing behind or into the house.
  controls.minAzimuthAngle = -1.6;
  controls.maxAzimuthAngle = 1.6;
  controls.autoRotateSpeed = 1.4;

  // The scene is drawn only when something changes, which saves battery on phones.
  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };
  controls.addEventListener('change', invalidate);

  // Sky dome, and the same sky baked into environment maps for reflections and soft daylight.
  const sky = skyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 24), sky);
  dome.renderOrder = -1;
  scene.add(dome);
  const sun = new THREE.DirectionalLight('#ffffff', 1);
  sun.position.set(-6, 10, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { near: 1, far: 45 });
  scene.add(sun);
  scene.fog = new THREE.Fog('#ffffff', 22, 55);

  function setSky(mode) {
    sky.uniforms.zenith.value.set(mode.zenith);
    sky.uniforms.horizon.value.set(mode.horizon);
    sky.uniforms.ground.value.set(mode.ground);
    sky.uniforms.sunColor.value.set(mode.sun);
    sky.uniforms.sunDirection.value.copy(sun.position).normalize();
    sky.uniforms.cloudColor.value.set(mode.clouds);
    sky.uniforms.cloudiness.value = mode.cloudiness;
    scene.fog.color.set(mode.horizon);
    scene.environmentIntensity = mode.ambient;
    sun.color.set(mode.light);
    sun.intensity = mode.intensity;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyOnly = new THREE.Scene();
  skyOnly.add(new THREE.Mesh(dome.geometry, sky));
  const environments = {};
  for (const name of ['night', 'day']) {
    setSky(SKY[name]);
    environments[name] = pmrem.fromScene(skyOnly, 0.03, 0.1, 100).texture;
  }
  pmrem.dispose();
  scene.environment = environments.day;

  const starPositions = [];
  const nextStar = seeded(3);
  for (let index = 0; index < 500; index += 1) {
    const angle = nextStar() * Math.PI * 2;
    const y = 0.06 + nextStar() * 0.94;
    const ring = Math.sqrt(1 - y * y);
    starPositions.push(Math.cos(angle) * ring * 65, y * 65, Math.sin(angle) * ring * 65);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#ffffff', size: 1.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
  stars.visible = false;
  scene.add(stars);

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const maps = { shadow: draw.contactShadows() };
  for (const name of ['deck', 'plaster', 'grass', 'wood', 'powder', 'fabric', 'rug', 'roof', 'leaves']) {
    await pause();
    maps[name] = draw[name](anisotropy);
  }

  const satin = () => new THREE.Vector2(0.3, 0.3);
  // Inside the house only a little daylight reaches the walls, so they take little of the sky light.
  const indoor = (options) => new THREE.MeshStandardMaterial({ side: THREE.BackSide, envMapIntensity: 0.06, ...options });
  const furnishing = (options) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.06, ...options });
  const materials = {
    frame: new THREE.MeshPhysicalMaterial({ color: '#383e42', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.45, normalMap: maps.powder, normalScale: satin() }),
    // Opal polycarbonate: milky white, lets diffuse light through and has a soft sheen on top.
    polycarbonate: new THREE.MeshPhysicalMaterial({ color: '#f8f7f3', transmission: 0.4, roughness: 0.3, thickness: 0.016, ior: 1.58, clearcoat: 0.6, clearcoatRoughness: 0.12 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#f1f7f8', transmission: 1, roughness: 0.03, thickness: 0.012, ior: 1.5 }),
    fabric: new THREE.MeshStandardMaterial({ color: '#77736b', map: maps.fabric.map, normalMap: maps.fabric.normal, roughness: 0.92, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    led: new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffc777', emissiveIntensity: 0.6 }),
    lawn: new THREE.MeshStandardMaterial({ map: maps.grass.map, normalMap: maps.grass.normal, roughness: 0.95, vertexColors: true }),
    deck: new THREE.MeshStandardMaterial({ map: maps.deck.map, normalMap: maps.deck.normal, roughnessMap: maps.deck.roughness }),
    wall: new THREE.MeshStandardMaterial({ map: maps.plaster.map, normalMap: maps.plaster.normal, roughness: 0.95 }),
    plinth: new THREE.MeshStandardMaterial({ color: '#77736c', normalMap: maps.plaster.normal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ map: maps.roof.map, normalMap: maps.roof.normal, roughness: 0.5, metalness: 0.3 }),
    fascia: new THREE.MeshStandardMaterial({ color: '#3a3d41', roughness: 0.6 }),
    windowFrame: new THREE.MeshPhysicalMaterial({ color: '#33373b', roughness: 0.4, clearcoat: 0.3, normalMap: maps.powder, normalScale: satin() }),
    // Coated window glass with a faint green tint reflects much more of the sky than plain glass.
    windowGlass: new THREE.MeshPhysicalMaterial({ color: '#dfe9e7', transmission: 1, roughness: 0.02, thickness: 0.02, ior: 2.3 }),
    // Brushed aluminium door threshold.
    threshold: new THREE.MeshStandardMaterial({ color: '#9b9fa4', metalness: 0.7, roughness: 0.35 }),
    roomWall: indoor({ color: '#c7c1b8', roughness: 0.95 }),
    roomCeiling: indoor({ color: '#d6d1c9', roughness: 0.95 }),
    roomFloor: indoor({ color: '#8a735f', map: maps.wood.map, normalMap: maps.wood.normal, roughness: 0.6 }),
    sideboard: furnishing({ color: '#3b3936', roughness: 0.55 }),
    pictureFrame: furnishing({ color: '#1f1f1f', roughness: 0.5 }),
    art: furnishing({ color: '#8fa1a6', map: maps.fabric.map, roughness: 0.9 }),
    lamp: furnishing({ color: '#f2efe8', emissive: '#ffd9a0', emissiveIntensity: 0, roughness: 0.6 }),
    curtain: new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.88, envMapIntensity: 0.3 }),
    planter: new THREE.MeshStandardMaterial({ color: '#56575a', normalMap: maps.plaster.normal, roughness: 0.85 }),
    soil: new THREE.MeshStandardMaterial({ color: '#3b2f25', roughness: 1 }),
    blades: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75 }),
    leaves: new THREE.MeshStandardMaterial({ map: maps.leaves, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8 }),
    bark: new THREE.MeshStandardMaterial({ color: '#5e5147', normalMap: maps.plaster.normal, normalScale: new THREE.Vector2(2, 2), roughness: 0.95 }),
    fence: new THREE.MeshStandardMaterial({ color: '#a38a77', map: maps.wood.map, normalMap: maps.wood.normal, roughness: 0.75 }),
    sofaFrame: new THREE.MeshPhysicalMaterial({ color: '#45484c', roughness: 0.45, clearcoat: 0.2, normalMap: maps.powder, normalScale: satin() }),
    cushion: new THREE.MeshStandardMaterial({ color: '#d6d0c4', map: maps.fabric.map, normalMap: maps.fabric.normal, roughness: 1 }),
    pillow: new THREE.MeshStandardMaterial({ color: '#7f8f6c', map: maps.fabric.map, normalMap: maps.fabric.normal, roughness: 1 }),
    table: new THREE.MeshPhysicalMaterial({ color: '#e9d6bf', map: maps.wood.map, normalMap: maps.wood.normal, roughness: 0.5, clearcoat: 0.2 }),
    rug: new THREE.MeshStandardMaterial({ map: maps.rug, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };

  // Soft contact shadows where objects meet the ground, like the shading in real photos.
  const shadowMaterials = new Map();
  function shadowMaterial(kind, opacity) {
    const key = `${kind}:${opacity}`;
    if (!shadowMaterials.has(key)) {
      shadowMaterials.set(key, new THREE.MeshBasicMaterial({
        color: '#000000', alphaMap: maps.shadow[kind], transparent: true, opacity, depthWrite: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
    }
    return shadowMaterials.get(key);
  }

  function contact(sizeX, sizeZ, x, z, opacity, y = DECK) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), shadowMaterial('round', opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.004, z);
    return mesh;
  }

  function wallShadow(length, depth, wallFace, y, opacity) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, depth), shadowMaterial('strip', opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y + 0.004, wallFace + depth / 2);
    return mesh;
  }

  // Lawn with large, gentle colour changes on top of the tiled grass texture.
  const lawnGeometry = worldUV(new THREE.PlaneGeometry(120, 120, 48, 48), 'x');
  const lawnColors = [];
  const lawnPosition = lawnGeometry.attributes.position;
  for (let index = 0; index < lawnPosition.count; index += 1) {
    const x = lawnPosition.getX(index);
    const y = lawnPosition.getY(index);
    const shade = 1 + 0.07 * Math.sin(x * 0.31 + 1.7) * Math.cos(y * 0.23) + 0.05 * Math.sin(x * 0.11 - y * 0.17);
    lawnColors.push(shade * 1.02, shade, shade * 0.94);
  }
  lawnGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lawnColors, 3));
  const lawn = new THREE.Mesh(lawnGeometry, materials.lawn);
  lawn.rotation.x = -Math.PI / 2;
  lawn.receiveShadow = true;
  scene.add(lawn);

  const world = new THREE.Group();
  scene.add(world);
  const pergola = new THREE.Group();
  scene.add(pergola);
  const ledLights = [];
  // A warm lamp inside the house, switched on in the evening.
  const roomLight = new THREE.PointLight('#ffd6a0', 0, 10, 2);
  scene.add(roomLight);
  const shared = [bladeGeometry(), new THREE.PlaneGeometry(0.9, 0.9)];
  const [blades, card] = shared;

  let current = null;
  let night = false;
  let tween = null;

  function disposeGroup(group) {
    group.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry && !shared.includes(object.geometry)) object.geometry.dispose();
    });
    group.clear();
  }

  // A door or window set 16 cm deep into the wall: frame profiles, a middle post and clear glass.
  // A window gets a metal sill, a door an aluminium threshold, so no bare plaster shows under the frame.
  function opening(width, height, x, bottom, wallFace, { sill = false, threshold = false } = {}) {
    const group = new THREE.Group();
    const profile = 0.07;
    const z = wallFace - 0.16;
    const frame = materials.windowFrame;
    for (const y of [bottom + profile / 2, bottom + height - profile / 2]) {
      const rail = member(width, profile, 0.09, frame, { radius: 0.006 });
      rail.position.set(x, y, z);
      group.add(rail);
    }
    for (const offset of [-1, 1]) {
      const stile = member(profile, height - 2 * profile, 0.09, frame, { along: 'y', radius: 0.006 });
      stile.position.set(x + offset * (width / 2 - profile / 2), bottom + height / 2, z);
      group.add(stile);
    }
    const middle = member(0.09, height - 2 * profile, 0.11, frame, { along: 'y', radius: 0.006 });
    middle.position.set(x, bottom + height / 2, z);
    const glass = member(width - 2 * profile, height - 2 * profile, 0.024, materials.windowGlass, { radius: 0, shadow: false });
    glass.position.set(x, bottom + height / 2, z);
    group.add(middle, glass);
    if (sill) {
      // Sheet-metal sill: it lies 1 cm above the bottom reveal (never in the same plane as the plaster),
      // runs from under the frame to 5 cm past the wall and ends in a drip edge.
      const depth = 0.18;
      const board = member(width + 0.04, 0.012, depth, frame, { radius: 0.003 });
      board.position.set(x, bottom + 0.006, wallFace - 0.13 + depth / 2);
      const drip = member(width + 0.04, 0.04, 0.01, frame, { radius: 0.003 });
      // 1 mm lower than the sill top, so the two top faces never share a plane.
      drip.position.set(x, bottom - 0.009, wallFace + 0.05);
      group.add(board, drip);
    }
    if (threshold) {
      const plate = member(width, 0.012, 0.13, materials.threshold, { radius: 0.003, shadow: false });
      plate.position.set(x, bottom + 0.006, wallFace - 0.065);
      group.add(plate);
    }
    return group;
  }

  // Front wall built around the door and window openings, so they have reveals like a real wall.
  function frontWall(wallFace, holes) {
    const edges = [-HOUSE.half, HOUSE.half, ...holes.flatMap((hole) => [hole.x0, hole.x1])].sort((a, b) => a - b);
    for (let index = 0; index < edges.length - 1; index += 1) {
      const x0 = edges[index];
      const x1 = edges[index + 1];
      if (x1 - x0 < 0.001) continue;
      const hole = holes.find((candidate) => candidate.x0 <= x0 + 0.0001 && candidate.x1 >= x1 - 0.0001);
      const spans = hole ? [[0, hole.y0], [hole.y1, HOUSE.height]] : [[0, HOUSE.height]];
      for (const [y0, y1] of spans) {
        if (y1 - y0 < 0.001) continue;
        const centre = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, wallFace - 0.2);
        const piece = member(x1 - x0, y1 - y0, 0.4, materials.wall, { radius: 0, origin: centre });
        piece.position.copy(centre);
        world.add(piece);
      }
    }
  }

  // The room behind the glass: floor, walls, ceiling and sheer curtains, seen from the garden.
  function interior(wallFace, door, pane) {
    const depth = 5;
    const height = 2.85;
    const box = worldUV(new THREE.BoxGeometry(2 * HOUSE.half - 0.4, height, depth), 'x');
    const room = new THREE.Mesh(box, [materials.roomWall, materials.roomWall, materials.roomCeiling, materials.roomFloor, materials.roomWall, materials.roomWall]);
    room.position.set(0, DECK + height / 2, wallFace - 0.4 - depth / 2);
    room.receiveShadow = true;
    world.add(room);
    for (const x of [door.x0 + 0.42, door.x1 - 0.42]) {
      const curtain = new THREE.Mesh(curtainGeometry(0.75, 2.5), materials.curtain);
      curtain.position.set(x, DECK + 1.3, wallFace - 0.5);
      world.add(curtain);
    }
    // A sheer net curtain across the window, as in most Polish houses.
    const net = new THREE.Mesh(curtainGeometry(pane.x1 - pane.x0 + 0.1, pane.y1 - pane.y0 + 0.15), materials.curtain);
    net.position.set((pane.x0 + pane.x1) / 2, (pane.y0 + pane.y1) / 2, wallFace - 0.47);
    world.add(net);
    // A sideboard, a picture and a pendant lamp give the room depth when seen through the glass.
    const backWall = wallFace - 0.4 - depth;
    const sideboard = member(1.8, 0.75, 0.45, materials.sideboard, { radius: 0.01 });
    sideboard.position.set(DOOR.x, DECK + 0.375, backWall + 0.24);
    const frame = member(1.1, 0.75, 0.03, materials.pictureFrame, { radius: 0, shadow: false });
    frame.position.set(DOOR.x, DECK + 1.6, backWall + 0.02);
    const art = member(1, 0.65, 0.01, materials.art, { radius: 0, shadow: false });
    art.position.set(DOOR.x, DECK + 1.6, backWall + 0.04);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), materials.lamp);
    lamp.position.set(DOOR.x, DECK + 2.2, wallFace - 2.4);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, height - 2.3, 6), materials.pictureFrame);
    cord.position.set(DOOR.x, DECK + 2.3 + (height - 2.3) / 2, wallFace - 2.4);
    world.add(sideboard, frame, art, lamp, cord);
    roomLight.position.set(DOOR.x, DECK + 2.2, wallFace - 2.4);
  }

  // Leaf cards scattered through a few overlapping blobs: tree crowns and shrubs.
  function foliage(count, blobs, next, { size = 1, shadow = true } = {}) {
    const mesh = new THREE.InstancedMesh(card, materials.leaves, count);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const tint = new THREE.Color();
    for (let index = 0; index < count; index += 1) {
      const blob = blobs[index % blobs.length];
      const height = next() * 2 - 1;
      const angle = next() * Math.PI * 2;
      const ring = Math.sqrt(1 - height * height);
      const reach = (0.55 + 0.45 * Math.cbrt(next())) * blob.r;
      position.set(blob.x + Math.cos(angle) * ring * reach, blob.y + height * reach * 0.8, blob.z + Math.sin(angle) * ring * reach);
      euler.set(next() * Math.PI, next() * Math.PI * 2, next() * Math.PI);
      rotation.setFromEuler(euler);
      const cardSize = size * (0.8 + next() * 0.6);
      scale.set(cardSize, cardSize, cardSize);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      mesh.setColorAt(index, tint.setHSL(0.18 + next() * 0.12, 0.25 + next() * 0.2, 0.72 + next() * 0.24));
    }
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    return mesh;
  }

  function tree(x, z, { height, crown, seed, shadow = true }) {
    const group = new THREE.Group();
    const next = seeded(seed);
    const trunkHeight = height - crown * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, trunkHeight + 0.6, 10), materials.bark);
    trunk.position.y = (trunkHeight + 0.6) / 2;
    trunk.castShadow = shadow;
    trunk.receiveShadow = true;
    group.add(trunk);
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 + next() * 0.8;
      const tilt = 0.45 + next() * 0.4;
      direction.set(Math.cos(angle) * Math.sin(tilt), Math.cos(tilt), Math.sin(angle) * Math.sin(tilt));
      const length = crown * (0.75 + next() * 0.35);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.07, length, 6), materials.bark);
      branch.quaternion.setFromUnitVectors(up, direction);
      branch.position.set(0, trunkHeight, 0).addScaledVector(direction, length / 2);
      branch.castShadow = shadow;
      group.add(branch);
    }
    const y = trunkHeight + crown * 0.8;
    group.add(foliage(560, [
      { x: 0, y, z: 0, r: crown },
      { x: crown * 0.5, y: y - crown * 0.2, z: crown * 0.2, r: crown * 0.7 },
      { x: -crown * 0.45, y: y - 0.1, z: -crown * 0.3, r: crown * 0.75 },
      { x: 0.1, y: y + crown * 0.45, z: 0.2, r: crown * 0.6 },
    ], next, { shadow }));
    group.position.set(x, 0, z);
    return group;
  }

  function shrub(x, z, radius, seed) {
    const bush = foliage(170, [
      { x: 0, y: radius * 0.75, z: 0, r: radius },
      { x: radius * 0.5, y: radius * 0.6, z: 0.1, r: radius * 0.7 },
      { x: -radius * 0.45, y: radius * 0.6, z: -0.1, r: radius * 0.7 },
    ], seeded(seed), { size: 0.55 });
    bush.position.set(x, 0, z);
    return bush;
  }

  // A horizontal-slat wooden fence on aluminium posts along the side of the plot.
  function fence(x, zStart, zEnd) {
    const group = new THREE.Group();
    const length = zEnd - zStart;
    const posts = Math.ceil(length / 1.8);
    for (let index = 0; index <= posts; index += 1) {
      const post = member(0.08, 1.8, 0.08, materials.sofaFrame, { along: 'y', radius: 0.004 });
      post.position.set(x, 0.9, zStart + (index * length) / posts);
      group.add(post);
    }
    for (let row = 0; row < 12; row += 1) {
      const slat = member(0.025, 0.12, length, materials.fence, { along: 'z', radius: 0.004, shift: row * 0.71 });
      slat.position.set(x + 0.055, 0.16 + row * 0.14, zStart + length / 2);
      group.add(slat);
    }
    return group;
  }

  // Tall fibre-cement planter with ornamental grass.
  function planter(x, z, seed) {
    const group = new THREE.Group();
    const pot = member(0.44, 0.62, 0.44, materials.planter, { along: 'y', radius: 0.02 });
    pot.position.set(0, DECK + 0.31, 0);
    const soil = member(0.39, 0.02, 0.39, materials.soil, { radius: 0, shadow: false });
    soil.position.set(0, DECK + 0.6, 0);
    const count = 90;
    const grass = new THREE.InstancedMesh(blades, materials.blades, count);
    const next = seeded(seed);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const color = new THREE.Color();
    const green = new THREE.Color('#5c7d33');
    const straw = new THREE.Color('#b0a964');
    for (let index = 0; index < count; index += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * 0.15;
      position.set(Math.cos(angle) * radius, DECK + 0.6, Math.sin(angle) * radius);
      euler.set((next() - 0.3) * 0.35, Math.PI / 2 - angle + (next() - 0.5) * 0.6, (next() - 0.5) * 0.2);
      rotation.setFromEuler(euler);
      const height = 0.5 + next() * 0.45;
      scale.set(1, height, height);
      grass.setMatrixAt(index, matrix.compose(position, rotation, scale));
      grass.setColorAt(index, color.copy(green).lerp(straw, next() * 0.55));
    }
    grass.castShadow = true;
    group.add(pot, soil, grass);
    group.position.set(x, 0, z);
    return group;
  }

  // Outdoor lounge sofa with cushions; its front faces +z before it is turned.
  function sofa(length) {
    const group = new THREE.Group();
    const depth = 0.86;
    const arm = 0.14;
    const legs = 0.07;
    const baseHeight = 0.24;
    const seatLevel = DECK + legs + baseHeight;
    const base = member(length, baseHeight, depth, materials.sofaFrame, { radius: 0.02 });
    base.position.set(0, DECK + legs + baseHeight / 2, 0);
    group.add(base);
    for (const side of [-1, 1]) {
      const armrest = member(arm, 0.56, depth, materials.sofaFrame, { along: 'z', radius: 0.03 });
      armrest.position.set(side * (length / 2 - arm / 2), DECK + legs + 0.28, 0);
      group.add(armrest);
      for (const end of [-1, 1]) {
        const leg = member(0.05, legs, 0.05, materials.sofaFrame, { along: 'y', radius: 0 });
        leg.position.set(side * (length / 2 - 0.06), DECK + legs / 2, end * (depth / 2 - 0.06));
        group.add(leg);
      }
    }
    const inner = length - 2 * arm;
    const backrest = member(inner, 0.36, 0.12, materials.sofaFrame, { radius: 0.02 });
    backrest.position.set(0, seatLevel + 0.18, -depth / 2 + 0.06);
    group.add(backrest);
    const count = inner > 1.5 ? 3 : 2;
    const cushionWidth = inner / count - 0.012;
    for (let index = 0; index < count; index += 1) {
      const x = -inner / 2 + (index + 0.5) * (inner / count);
      const seat = member(cushionWidth, 0.13, depth - 0.16, materials.cushion, { radius: 0.05 });
      seat.position.set(x, seatLevel + 0.065, 0.06);
      const back = member(cushionWidth, 0.44, 0.16, materials.cushion, { radius: 0.06 });
      back.position.set(x, seatLevel + 0.33, -depth / 2 + 0.2);
      back.rotation.x = -0.16;
      group.add(seat, back);
    }
    for (const side of [-1, 1]) {
      const pillow = member(0.4, 0.38, 0.13, materials.pillow, { radius: 0.06 });
      pillow.position.set(side * (inner / 2 - 0.24), seatLevel + 0.32, -depth / 2 + 0.33);
      pillow.rotation.set(-0.25, side * 0.25, side * 0.08);
      group.add(pillow);
    }
    return group;
  }

  // House with a gable roof and a furnished room, terrace boards, garden, planters and a lounge set for scale.
  function buildWorld(config) {
    disposeGroup(world);
    const { width: w, depth: d } = config;
    const wallFace = -d / 2;
    const door = { x0: DOOR.x - DOOR.width / 2, x1: DOOR.x + DOOR.width / 2, y0: DECK, y1: DECK + DOOR.height };
    const pane = { x0: WINDOW.x - WINDOW.width / 2, x1: WINDOW.x + WINDOW.width / 2, y0: DECK + WINDOW.sill, y1: DECK + WINDOW.sill + WINDOW.height };

    frontWall(wallFace, [door, pane]);
    // The plinth stops at the door, so nothing sits in the door opening.
    for (const [x0, x1] of [[-HOUSE.half, door.x0], [door.x1, HOUSE.half]]) {
      const centre = new THREE.Vector3((x0 + x1) / 2, 0.16, wallFace - 0.2);
      const plinth = member(x1 - x0, 0.32, 0.43, materials.plinth, { radius: 0, shadow: false, origin: centre });
      plinth.position.copy(centre);
      world.add(plinth);
    }
    world.add(
      opening(DOOR.width, DOOR.height, DOOR.x, door.y0, wallFace, { threshold: true }),
      opening(WINDOW.width, WINDOW.height, WINDOW.x, pane.y0, wallFace, { sill: true }),
    );
    interior(wallFace, door, pane);

    const ridge = { y: HOUSE.ridge, z: wallFace - HOUSE.depth / 2 };
    const pitch = (ridge.y - 4.45) / (HOUSE.depth / 2);
    for (const side of [-1, 1]) {
      const sideWall = member(0.4, HOUSE.height, HOUSE.depth, materials.wall, { along: 'z', radius: 0 });
      sideWall.position.set(side * (HOUSE.half - 0.2), HOUSE.height / 2, wallFace - HOUSE.depth / 2);
      const shape = new THREE.Shape([
        new THREE.Vector2(wallFace, HOUSE.height),
        new THREE.Vector2(wallFace - HOUSE.depth, HOUSE.height),
        new THREE.Vector2(ridge.z, ridge.y - 0.08),
      ]);
      const gableGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
      gableGeometry.rotateY(-Math.PI / 2);
      const gable = new THREE.Mesh(worldUV(gableGeometry, 'z'), materials.wall);
      gable.position.x = side * (HOUSE.half - 0.2) + 0.2;
      gable.castShadow = true;
      gable.receiveShadow = true;
      world.add(sideWall, gable);
    }
    for (const direction of [1, -1]) {
      const eave = { y: 4.45 - 0.55 * pitch, z: direction > 0 ? wallFace + 0.55 : wallFace - HOUSE.depth - 0.55 };
      world.add(slopedMember(2 * HOUSE.half + 0.8, 0.16, { x: 0, y: ridge.y, z: ridge.z }, { x: 0, y: eave.y, z: eave.z }, materials.roof, { along: 'x', radius: 0 }));
      const fascia = member(2 * HOUSE.half + 0.8, 0.22, 0.04, materials.fascia, { radius: 0 });
      fascia.position.set(0, eave.y - 0.06, eave.z + direction * 0.02);
      world.add(fascia);
    }

    const deck = member(w + 1.8, DECK, d + 1.2, materials.deck, { radius: 0.012 });
    deck.position.set(0, DECK / 2, 0.6);
    world.add(deck, wallShadow(w + 1.8, 0.8, wallFace, DECK, 0.5), wallShadow(2 * HOUSE.half, 0.9, wallFace, 0, 0.45));

    for (const side of [-1, 1]) {
      const x = side * (w / 2 + 0.55);
      const z = wallFace + 0.45;
      world.add(planter(x, z, side > 0 ? 5 : 9), contact(0.95, 0.95, x, z, 0.55));
    }

    // Garden: a fence on the left, the neighbour's tree behind it, a tree by the house and two shrubs.
    const fenceX = -(w / 2 + 3.4);
    world.add(fence(fenceX, wallFace + 0.05, wallFace + 10));
    world.add(tree(-(w / 2 + 5.8), wallFace + 3.8, { height: 7.2, crown: 2.5, seed: 11 }));
    world.add(tree(HOUSE.half + 2.6, wallFace + 1.6, { height: 6.4, crown: 2.1, seed: 23, shadow: false }));
    for (const [x, radius, seed] of [[-(w / 2 + 2), 0.65, 31], [w / 2 + 2.3, 0.6, 37]]) {
      world.add(shrub(x, wallFace + 0.8, radius, seed), contact(radius * 3, radius * 3, x, wallFace + 0.8, 0.45, 0));
    }

    const sofaLength = Math.min(2.3, d - 0.7);
    const sofaX = -w / 2 + 0.58;
    const lounge = sofa(sofaLength);
    lounge.rotation.y = Math.PI / 2;
    lounge.position.set(sofaX, 0, 0.05);
    const tableX = sofaX + 1.05;
    const tableTop = member(0.55, 0.035, 0.95, materials.table, { along: 'z', radius: 0.008 });
    tableTop.position.set(tableX, DECK + 0.4, 0.05);
    world.add(lounge, tableTop);
    for (const dx of [-0.22, 0.22]) {
      for (const dz of [-0.4, 0.4]) {
        const leg = member(0.035, 0.38, 0.035, materials.sofaFrame, { along: 'y', radius: 0 });
        leg.position.set(tableX + dx, DECK + 0.19, 0.05 + dz);
        world.add(leg);
      }
    }
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.7, Math.min(2.3, d - 0.3)), materials.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(sofaX + 0.75, DECK + 0.002, 0.05);
    rug.receiveShadow = true;
    world.add(rug, contact(1.3, sofaLength + 0.45, sofaX, 0.05, 0.6), contact(0.95, 1.35, tableX, 0.05, 0.35));

    // The sun's shadow map covers the terrace and the garden around it.
    const extent = Math.max(w, d) / 2 + 8;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
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

    // Posts on base plates: two at the front, two more at the back for a freestanding pergola.
    const posts = [[-xEdge, zFront, h], [xEdge, zFront, h]];
    if (mount === 'wolnostojaca') posts.push([-xEdge, zBack, h + rise], [xEdge, zBack, h + rise]);
    for (const [x, z, height] of posts) {
      const post = member(POST, height, POST, frame, { along: 'y' });
      post.position.set(x, DECK + height / 2, z);
      const plate = member(0.2, 0.012, 0.2, frame, { radius: 0.004 });
      plate.position.set(x, DECK + 0.006, z);
      pergola.add(post, plate, contact(0.55, 0.55, x, z, 0.5));
    }

    // Front beam with the gutter, back beam (wall ledger or beam on posts) and sloped side beams.
    const front = member(w, BEAM, POST + 0.02, frame);
    front.position.set(0, top - BEAM / 2, zFront);
    const back = member(w, BEAM * 0.8, POST, frame);
    back.position.set(0, top + rise - BEAM * 0.4, zBack);
    pergola.add(front, back);
    for (const x of [-xEdge, xEdge]) {
      pergola.add(slopedMember(POST, BEAM * 0.8, { x, y: top + rise - BEAM * 0.4, z: zBack }, { x, y: top - BEAM * 0.4, z: zFront }, frame));
    }

    if (roof === 'lamele') {
      const count = Math.max(4, Math.floor((d - 2 * POST) / LAMELLA_PITCH));
      const start = -((count - 1) * LAMELLA_PITCH) / 2;
      const angle = (config.angle * Math.PI) / 180;
      for (let index = 0; index < count; index += 1) {
        const lamella = new THREE.Mesh(lamellaGeometry(w - 2 * POST, ((index * 0.618) % 1) * 7), frame);
        lamella.castShadow = true;
        lamella.receiveShadow = true;
        lamella.position.set(0, top - BEAM / 2, start + index * LAMELLA_PITCH);
        lamella.rotation.x = angle;
        pergola.add(lamella);
      }
    } else {
      const panelMaterial = roof === 'szklo' ? materials.glass : materials.polycarbonate;
      const rafters = Math.max(2, Math.round(w / 0.85));
      for (let index = 0; index <= rafters; index += 1) {
        const x = -w / 2 + POST / 2 + ((w - POST) * index) / rafters;
        pergola.add(slopedMember(0.05, 0.09, { x, y: top + rise + 0.045, z: zBack }, { x, y: top + 0.045, z: zFront }, frame));
        // Cover strip that holds the panels down from above.
        pergola.add(slopedMember(0.056, 0.022, { x, y: top + rise + 0.12, z: zBack - 0.02 }, { x, y: top + 0.12, z: zFront + 0.1 }, frame, { radius: 0.006 }));
      }
      const panel = slopedMember(w - 0.02, 0.016, { x: 0, y: top + rise + 0.1, z: zBack - 0.04 }, { x: 0, y: top + 0.1, z: zFront + 0.12 }, panelMaterial, { radius: 0, shadow: false });
      pergola.add(panel);
    }

    // ZIP screens: cassette under the beam, guide rails along the posts, fabric and a bottom bar.
    const clear = h - BEAM;
    const drop = (clear * config.drop) / 100;
    for (const side of config.screens) {
      const isFront = side === 'front';
      const span = isFront ? w - 2 * POST : d - 2 * POST;
      const x = isFront ? 0 : (side === 'lewa' ? -xEdge : xEdge);
      const z = isFront ? zFront + 0.02 : 0;
      const along = isFront ? 'x' : 'z';
      const cassette = member(isFront ? span : 0.11, 0.12, isFront ? 0.11 : span, frame, { along, radius: 0.02 });
      cassette.position.set(x, top - BEAM - 0.06, z);
      pergola.add(cassette);
      for (const end of [-1, 1]) {
        const rail = member(isFront ? 0.035 : 0.045, clear - 0.12, isFront ? 0.045 : 0.035, frame, { along: 'y', radius: 0.004 });
        rail.position.set(isFront ? end * (span / 2 + 0.0175) : x, DECK + (clear - 0.12) / 2, isFront ? z : end * (span / 2 + 0.0175));
        pergola.add(rail);
      }
      if (drop > 0.02) {
        const cloth = member(isFront ? span : 0.008, drop, isFront ? 0.008 : span, materials.fabric, { along, radius: 0 });
        cloth.position.set(x, top - BEAM - 0.12 - drop / 2, z);
        const bar = member(isFront ? span : 0.03, 0.045, isFront ? 0.03 : span, frame, { along, radius: 0.008 });
        bar.position.set(x, top - BEAM - 0.12 - drop, z);
        pergola.add(cloth, bar);
      }
    }

    if (config.led) {
      const strip = member(w - 0.3, 0.014, 0.025, materials.led, { radius: 0, shadow: false });
      strip.position.set(0, top - BEAM - 0.007, zFront - 0.075);
      pergola.add(strip);
      for (const x of [-xEdge + 0.05, xEdge - 0.05]) {
        pergola.add(slopedMember(0.025, 0.014, { x, y: top + rise - BEAM * 0.8 - 0.007, z: zBack + 0.2 }, { x, y: top - BEAM * 0.8 - 0.007, z: zFront - 0.2 }, materials.led, { radius: 0, shadow: false }));
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
      frame.map = maps.wood.map;
      frame.normalMap = maps.wood.normal;
      frame.normalScale.set(0.6, 0.6);
      frame.color.set('#ffffff');
      frame.roughness = 0.55;
      frame.clearcoat = 0.15;
    } else {
      frame.map = null;
      frame.normalMap = maps.powder;
      frame.normalScale.set(0.3, 0.3);
      frame.color.set(color.hex);
      frame.roughness = colorId === '9016' ? 0.38 : 0.45;
      frame.clearcoat = 0.3;
    }
    frame.needsUpdate = true;
    invalidate();
  }

  function applyLighting() {
    setSky(night ? SKY.night : SKY.day);
    scene.environment = night ? environments.night : environments.day;
    stars.visible = night;
    roomLight.intensity = night ? 18 : 0;
    materials.lamp.emissiveIntensity = night ? 2.5 : 0;
    const ledOn = night && current?.led;
    materials.led.emissiveIntensity = ledOn ? 6 : 0.6;
    for (const light of ledLights) light.intensity = ledOn ? 5 : 0;
    invalidate();
  }

  // Points that must stay in the picture: the pergola with its roof and the two planters by the wall.
  function framePoints(config) {
    const { width: w, depth: d, height: h } = config;
    const roofTop = DECK + h + roofRise(config) + 0.12;
    const points = [];
    for (const x of [-w / 2, w / 2]) {
      for (const y of [0, roofTop]) {
        for (const z of [-d / 2, d / 2]) points.push(new THREE.Vector3(x, y, z));
      }
    }
    for (const side of [-1, 1]) points.push(new THREE.Vector3(side * (w / 2 + 0.97), DECK + 1.45, -d / 2 + 0.45));
    return points;
  }

  // Finds the closest camera distance at which every frame point fits on screen, for any size and aspect ratio.
  // The top edge keeps room for the view buttons.
  const probe = new THREE.PerspectiveCamera(camera.fov, 1, 0.1, 150);
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
  controls.addEventListener('start', () => {
    userMoved = true;
  });

  function view(name, animate = true) {
    if (!current) return;
    const goal = fit(name);
    if (!animate) {
      camera.position.copy(goal.position);
      controls.target.copy(goal.target);
      invalidate();
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
    invalidate();
  }

  // Rendering: the scene goes into an antialiased buffer, ambient occlusion darkens corners and contact areas
  // (under the sofa, between lamellas, along the wall), then the output pass applies tone mapping.
  const bufferSize = new THREE.Vector2();
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
  const shadedTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const occlusion = new GTAOPass(scene, camera, 1, 1, { depthTexture: sceneTarget.depthTexture });
  occlusion.output = GTAOPass.OUTPUT.Default;
  occlusion.blendIntensity = 1;
  occlusion.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.3, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1 });
  occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  const output = new OutputPass();
  output.renderToScreen = true;

  function sizeTargets() {
    renderer.getDrawingBufferSize(bufferSize);
    sceneTarget.setSize(bufferSize.x, bufferSize.y);
    shadedTarget.setSize(bufferSize.x, bufferSize.y);
    // On high-density phone screens ambient occlusion is computed at half resolution.
    const scale = renderer.getPixelRatio() > 1.25 ? 0.5 : 1;
    occlusion.setSize(Math.round(bufferSize.x * scale), Math.round(bufferSize.y * scale));
  }

  function paint() {
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    occlusion.render(renderer, shadedTarget, sceneTarget);
    output.render(renderer, null, shadedTarget);
  }

  function resize() {
    const { clientWidth, clientHeight } = canvas.parentElement;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    sizeTargets();
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    if (current && !userMoved) {
      tween = null;
      view('start', false);
    }
    invalidate();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  function frame(now) {
    requestAnimationFrame(frame);
    if (tween) {
      const progress = Math.min(1, (now - tween.start) / tween.duration);
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(tween.from, tween.to, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
      if (progress === 1) tween = null;
      dirty = true;
    }
    // Auto-rotation sweeps between the two sides of the garden instead of going round the house.
    if (controls.autoRotate) {
      const azimuth = controls.getAzimuthalAngle();
      if (azimuth > controls.maxAzimuthAngle - 0.03) controls.autoRotateSpeed = Math.abs(controls.autoRotateSpeed);
      if (azimuth < controls.minAzimuthAngle + 0.03) controls.autoRotateSpeed = -Math.abs(controls.autoRotateSpeed);
    }
    if (controls.update()) dirty = true;
    if (!dirty) return;
    dirty = false;
    paint();
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
      invalidate();
    },
    // A fixed-size picture from the three-quarter view, whatever angle the visitor left the model at.
    snapshot() {
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), aspect: camera.aspect };
      const ratio = renderer.getPixelRatio();
      const aspect = SNAPSHOT.width / SNAPSHOT.height;
      const goal = fit('start', aspect);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      camera.position.copy(goal.position);
      camera.lookAt(goal.target);
      camera.updateMatrixWorld();
      renderer.setPixelRatio(1);
      renderer.setSize(SNAPSHOT.width, SNAPSHOT.height, false);
      sizeTargets();
      paint();
      const url = renderer.domElement.toDataURL('image/jpeg', 0.86);
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.aspect = saved.aspect;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(ratio);
      resize();
      paint();
      return url;
    },
  };
}
