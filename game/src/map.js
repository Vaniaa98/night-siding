// Night Siding — the map. A night railyard, 56 x 40 m: two parallel tracks are the
// lanes, boxcars are the cover, signal gantries are the sightlines. Site A is the
// Engine Shed in the north-west corner; Site B is the Freight Hall in the south-east.
// Everything is plain boxes and cylinders — no models, no textures, no network.
// The same box list is the collision set and the bullet-stop set.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBox } from './physics.js';

// [x, y, z, width, height, depth, material] — y is the centre. Visual-only entries
// (ground, rails, sleepers, roofs) are not colliders; everything else is.
const SOLIDS = [
  // Perimeter, 5 m walls.
  [-28.3, 2.5, 0, 0.6, 5, 40.6, 'surface'],
  [28.3, 2.5, 0, 0.6, 5, 40.6, 'surface'],
  [0, 2.5, -20.3, 57.2, 5, 0.6, 'surface'],
  [0, 2.5, 20.3, 57.2, 5, 0.6, 'surface'],
  // Boxcars, west row (rust) and east row (teal), staggered so the lanes bend.
  [-8, 1.7, -12, 3.0, 3.4, 9.0, 'rust'],
  [-8, 1.7, 0, 3.0, 3.4, 9.0, 'rustDark'],
  [-8, 1.7, 12, 3.0, 3.4, 9.0, 'rust'],
  [8, 1.7, -16, 3.0, 3.4, 9.0, 'teal'],
  [8, 1.7, -4, 3.0, 3.4, 9.0, 'rust'],
  [8, 1.7, 8, 3.0, 3.4, 9.0, 'teal'],
  // Containers in the middle ground.
  [-3, 1.3, 4, 2.6, 2.6, 6.0, 'teal'],
  [3, 1.3, -8, 2.6, 2.6, 6.0, 'rust'],
  // Crates, 1.15 m cubes.
  [-14, 0.58, -4, 1.15, 1.15, 1.15, 'hairline'],
  [-14, 0.58, 6, 1.15, 1.15, 1.15, 'hairline'],
  [14, 0.58, -8, 1.15, 1.15, 1.15, 'hairline'],
  [14, 0.58, 4, 1.15, 1.15, 1.15, 'hairline'],
  [-4, 0.58, -14, 1.15, 1.15, 1.15, 'hairline'],
  [4, 0.58, 14, 1.15, 1.15, 1.15, 'hairline'],
  [-20, 0.58, 2, 1.15, 1.15, 1.15, 'hairline'],
  [20, 0.58, -2, 1.15, 1.15, 1.15, 'hairline'],
  [-11, 0.58, 16, 1.15, 1.15, 1.15, 'hairline'],
  [11, 0.58, -16, 1.15, 1.15, 1.15, 'hairline'],
  // Barrels, stood in pairs (collision is their square footprint).
  [-16, 0.58, 10, 0.9, 1.15, 0.9, 'rustDark'],
  [16, 0.58, -12, 0.9, 1.15, 0.9, 'rustDark'],
  [-6, 0.58, -2, 0.9, 1.15, 0.9, 'rustDark'],
  [6, 0.58, 2, 0.9, 1.15, 0.9, 'rustDark'],
  // Engine Shed (Site A), north-west: east wall with a 4 m door, south wall with a 3 m door.
  [-19, 2.5, -18.5, 0.5, 5, 3, 'surface'],
  [-19, 2.5, -12, 0.5, 5, 2, 'surface'],
  [-26, 2.5, -11, 4, 5, 0.5, 'surface'],
  [-20, 2.5, -11, 2, 5, 0.5, 'surface'],
  [-24, 0.58, -14, 1.15, 1.15, 1.15, 'hairline'],
  [-22, 0.58, -17, 1.15, 1.15, 1.15, 'hairline'],
  // Freight Hall (Site B), south-east: west wall with a 3 m door, north wall with a 3 m door.
  [19, 2.5, 12.5, 0.5, 5, 3, 'surface'],
  [19, 2.5, 18.5, 0.5, 5, 3, 'surface'],
  [20.5, 2.5, 11, 3, 5, 0.5, 'surface'],
  [26.5, 2.5, 11, 3, 5, 0.5, 'surface'],
  [26.5, 0.58, 18.5, 1.15, 1.15, 1.15, 'hairline'],
  [20.5, 0.58, 18.5, 1.15, 1.15, 1.15, 'hairline'],
  // Signal gantry across the middle: two posts and a beam at 5.5 m.
  [-20, 2.8, 0, 0.5, 5.6, 0.5, 'steel'],
  [20, 2.8, 0, 0.5, 5.6, 0.5, 'steel'],
  [0, 5.5, 0, 40.5, 0.6, 0.7, 'steel'],
  // Lamp poles.
  [-12, 2.25, -8, 0.3, 4.5, 0.3, 'steel'],
  [12, 2.25, 8, 0.3, 4.5, 0.3, 'steel'],
  [-20, 2.25, 10, 0.3, 4.5, 0.3, 'steel'],
  [20, 2.25, -10, 0.3, 4.5, 0.3, 'steel'],
];

const SITES = {
  A: { x: -23.5, z: -15.5, name: 'Engine Shed' },
  B: { x: 23.5, z: 15.5, name: 'Freight Hall' },
};

const SPAWNS = {
  yard: [[0, 17], [-6, 17.5], [-3, 18], [3, 18], [6, 17.5]],
  line: [[-6, -17], [-2, -18], [2, -18], [6, -17], [0, -15]],
};

// Waypoints are [x, z] lists. Attackers walk them in order; defenders hold on theirs.
const ROUTES = {
  yardToA: [[0, 16], [-8, 10], [-14, 2], [-18, -6], [-21, -12], [-23.5, -15.5]],
  yardToB: [[0, 16], [8, 14], [14, 14], [19, 15], [23.5, 15.5]],
  yardMid: [[0, 16], [-4, 6], [0, 0], [4, -6], [0, -12]],
  lineHoldA: [[-21, -13], [-16, -8], [-24, -17]],
  lineHoldB: [[21, 14], [16, 12], [24, 18]],
  lineMid: [[0, -14], [-8, -6], [0, 0]],
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.55 : 0.92,
      metalness: name === 'steel' ? 0.5 : 0.04,
    });
  }
  const lampGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const siteGlowA = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.3, depthWrite: false,
  });

  const colliders = [];
  function solidBox(x, y, z, w, h, d, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(makeBox(x, y, z, w, h, d));
    return mesh;
  }
  function visualBox(x, y, z, w, h, d, material, glow = false) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      glow ? lampGlow : materials[material],
    );
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  for (const [x, y, z, w, h, d, material] of SOLIDS) solidBox(x, y, z, w, h, d, material);

  // Ground: ballast gravel, plus darker strips under the two tracks.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(57, 41), materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  visualBox(-16, 0.02, 0, 4.6, 0.05, 40, 'canvas');
  visualBox(16, 0.02, 0, 4.6, 0.05, 40, 'canvas');

  // Rails (steel strips) and sleepers, visual only — trains run flush, so nobody trips.
  for (const trackX of [-16, 16]) {
    for (const off of [-0.75, 0.75]) {
      visualBox(trackX + off, 0.09, 0, 0.12, 0.14, 40, 'steel');
    }
    for (let z = -19.2; z <= 19.2; z += 1.6) {
      visualBox(trackX, 0.04, z, 2.4, 0.08, 0.6, 'hairline');
    }
  }

  // Shed and hall roofs (visual; bullets stop on them through the solids list too).
  visualBox(-23.5, 5.1, -15.5, 9.5, 0.3, 9.5, 'surface');
  visualBox(23.5, 5.1, 15.5, 9.5, 0.3, 9.5, 'surface');

  // Site plates: a glowing floor square and a thin column of light, so a site reads
  // at a glance from across the yard.
  const sitePlates = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.06, 3.4),
      siteGlowA.clone(),
    );
    plate.position.set(site.x, 0.05, site.z);
    group.add(plate);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 6, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.07,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    beam.position.set(site.x, 3, site.z);
    group.add(beam);
    sitePlates[key] = { plate, beam };
  }

  // Signal heads on the gantry: one orange, one blue, blinking in turn.
  const signalOrange = visualBox(-6, 5.0, 0, 0.5, 0.5, 0.3, 'accent', true);
  const signalBlue = visualBox(6, 5.0, 0, 0.5, 0.5, 0.3, 'line', true);

  // Sodium lamps: three real point lights, one emissive head each.
  const lamps = [];
  for (const [x, z] of [[-12, -8], [12, 8], [-20, 10]]) {
    visualBox(x, 4.5, z, 0.9, 0.25, 0.45, 'accent', true);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 20, 2);
    light.position.set(x, 4.3, z);
    scene.add(light);
    lamps.push(light);
  }
  visualBox(20, 4.5, -10, 0.9, 0.25, 0.45, 'accent', true);

  // A warm light inside each site building, so the interiors never go black.
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const inner = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 2);
    inner.position.set(site.x, 4.2, site.z);
    scene.add(inner);
  }

  // Light: a low sodium-orange key from the south-east, a cool blue fill from the
  // north-west, a dim moonlight from the north so the far lane never goes black,
  // and a hemisphere so the shadows never go black.
  const sky = new THREE.HemisphereLight(
    new THREE.Color('#2a3a55'), new THREE.Color('#14100c'), 1.05,
  );
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 2.4);
  key.position.set(18, 20, 14);
  key.target.position.set(-4, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#4a6a9a'), 0.4);
  fill.position.set(-16, 12, -14);
  scene.add(fill);
  const moon = new THREE.DirectionalLight(new THREE.Color('#7a9cc6'), 0.55);
  moon.position.set(-10, 18, -16);
  scene.add(moon);

  return {
    colliders,
    sites: SITES,
    spawns: SPAWNS,
    routes: ROUTES,
    minimap: {
      minX: -28, maxX: 28, minZ: -20, maxZ: 20,
      tracks: [-16, 16],
      sites: { A: [SITES.A.x, SITES.A.z], B: [SITES.B.x, SITES.B.z] },
      // Rectangles the minimap draws as walls: [x, z, w, d].
      walls: [
        [-28, 0, 1, 41], [28, 0, 1, 41], [0, -20, 57, 1], [0, 20, 57, 1],
        [-8, -12, 3, 9], [-8, 0, 3, 9], [-8, 12, 3, 9],
        [8, -16, 3, 9], [8, -4, 3, 9], [8, 8, 3, 9],
        [-23.5, -15.5, 9, 9], [23.5, 15.5, 9, 9],
      ],
    },
    update(dt, time) {
      // The gantry signals take turns: orange, then blue, every 1.6 s.
      const phase = Math.floor(time / 1.6) % 2;
      signalOrange.visible = phase === 0;
      signalBlue.visible = phase === 1;
      // The site plates breathe slowly so a live site is easy to find.
      const pulse = 0.22 + Math.sin(time * 2.2) * 0.08;
      sitePlates.A.plate.material.opacity = pulse;
      sitePlates.B.plate.material.opacity = pulse;
    },
  };
}
