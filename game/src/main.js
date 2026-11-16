// Night Siding — boot and the one loop. A fixed 60 Hz simulation feeds a render at
// the display's rate. This file owns the shared state S and wires the modules:
// the map, the player, the bots, the match, the grenades, the HUD and the sound.
// Shooting is resolved here, because a bullet has to ask the map, every combatant
// and the smoke at once. `?shot=play|buy|plant|end&seed=1` stages one deterministic
// frame for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, spread2 } from './rng.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createPlayerWeapon, makeAmmoState, WEAPONS } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createBots } from './bots.js';
import { createMatch, BUY_SECONDS } from './game.js';
import { rayBoxes, raySphere, losClear } from './physics.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.canvas), 0.010);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const player = createPlayer(map.colliders);
const input = createInput(renderer.domElement, onLockChange);
const hud = createHud();
const audio = createAudio();
const weaponView = createPlayerWeapon(camera);
const grenades = createGrenades(scene);

// The shared state. Every module reads it; only main.js and game.js write it.
const S = {
  phase: 'menu', round: 1, yardScore: 0, lineScore: 0, timer: 0,
  time: 0, planted: null, armProgress: 0, armSite: null, armBy: null,
  defuseProgress: 0, defuseBy: null, carrier: null,
  players: [], keysHeld: null, map,
  matchOver: false, matchWinner: null, roundWinner: null,
  onNextRound: null,
};

const playerCombatant = {
  id: 'you', name: 'You', team: 'yard', isPlayer: true,
  pos: player.state.position, yaw: 0,
  health: 100, armour: 0, helmet: false, hasKit: false,
  alive: true, def: WEAPONS.spike, ammo: makeAmmoState(WEAPONS.spike),
  primary: null, sidearm: makeAmmoState(WEAPONS.spike),
  active: 'sidearm', grenades: { frag: 0, smoke: 0, flash: 0 },
  kills: 0, deaths: 0, assists: 0, hs: 0, dmg: 0, cash: 800,
  weaponChanged: false, isCarrier: false,
  bodyBox: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
};
playerCombatant.ammo = playerCombatant.sidearm;
playerCombatant.def = WEAPONS.spike;

const events = {
  radio(text) {
    hud.radioAdd(text);
  },
  killfeed(text, killerTeam) {
    hud.killfeedAdd(text, killerTeam);
  },
  banner(title, sub) {
    hud.banner(title, sub);
  },
};

const match = createMatch(S, random, audio, events);
const bots = createBots(scene, map, S, random, audio, {
  fireShot,
  smokeBlocks: (ax, ay, az, bx, by, bz, now) => grenades.smokeBlocks(ax, ay, az, bx, by, bz, now),
});
S.players = [playerCombatant, ...bots.list];
syncBodyBoxes(); // every combatant needs a hitbox before any shot can be fired.

// Tracers: a small pool of lines, reused, so firing allocates nothing.
const tracers = [];
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < 12; i += 1) {
    const line = new THREE.Line(
      geo.clone(),
      new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }),
    );
    line.visible = false;
    scene.add(line);
    tracers.push({ line, until: 0 });
  }
}
let tracerIdx = 0;

function spawnTracer(from, to) {
  const slot = tracers[tracerIdx % tracers.length];
  tracerIdx += 1;
  const attr = slot.line.geometry.getAttribute('position');
  attr.setXYZ(0, from.x, from.y, from.z);
  attr.setXYZ(1, to.x, to.y, to.z);
  attr.needsUpdate = true;
  slot.line.visible = true;
  slot.line.material.opacity = 0.9;
  slot.until = S.time + 0.07;
}

// The charge: a dark case with a blinking orange lamp, shown on the site while
// someone arms it and while it is planted. The judge has to see the objective.
const chargeGroup = new THREE.Group();
{
  const caseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262c'), roughness: 0.6, metalness: 0.3 });
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.26, 0.38), caseMat);
  caseMesh.position.y = 0.13;
  caseMesh.castShadow = true;
  chargeGroup.add(caseMesh);
}
const chargeLamp = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 10, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
chargeLamp.position.set(0.18, 0.32, 0);
chargeGroup.add(chargeLamp);
chargeGroup.visible = false;
scene.add(chargeGroup);

function syncChargeMesh() {
  let site = null;
  if (S.planted) site = S.planted.site;
  else if (S.armProgress > 0.05 && S.armSite) site = S.armSite;
  if (!site) {
    chargeGroup.visible = false;
    return;
  }
  const pos = map.sites[site];
  chargeGroup.visible = true;
  chargeGroup.position.set(pos.x, 0, pos.z);
  chargeLamp.visible = Math.sin(S.time * 6) > -0.2;
}
const blast = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
);
blast.visible = false;
scene.add(blast);
const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30);
scene.add(blastLight);
let blastT = 0;

function boom(x, y, z) {
  blast.position.set(x, y + 1, z);
  blast.visible = true;
  blastT = 0;
  audio.explosion();
}

function headY(c) {
  return c.isPlayer ? c.pos.y + player.state.eye : c.pos.y + 1.55;
}

function syncBodyBoxes() {
  for (const c of S.players) {
    const b = c.bodyBox || (c.bodyBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
    const h = c.isPlayer ? player.state.height : 1.35;
    b.minX = c.pos.x - 0.3; b.maxX = c.pos.x + 0.3;
    b.minY = c.pos.y; b.maxY = c.pos.y + h;
    b.minZ = c.pos.z - 0.3; b.maxZ = c.pos.z + 0.3;
  }
}

function areaName(x, z) {
  if (x > -28 && x < -19 && z > -20 && z < -11) return 'Engine Shed';
  if (x > 19 && x < 28 && z > 11 && z < 20) return 'Freight Hall';
  if (Math.abs(x + 16) < 3) return 'Track 1';
  if (Math.abs(x - 16) < 3) return 'Track 2';
  if (Math.abs(z) < 3) return 'Signal Gantry';
  return 'Siding 9';
}

// Damage, kills, the charge changing hands. One place, so a kill is always counted
// the same way no matter who fired.
function applyDamage(victim, rawDmg, attacker, weaponName, isHead) {
  if (!victim.alive) return;
  let dmg = rawDmg;
  if (victim.armour > 0) {
    const absorbed = Math.min(victim.armour, dmg * 0.5);
    victim.armour -= absorbed;
    dmg -= absorbed;
  }
  victim.health -= dmg;
  if (attacker) {
    attacker.dmg += dmg;
    if (isHead) attacker.hs += 1;
  }
  if (victim.isPlayer) audio.hurt();
  if (victim.health > 0) return;
  victim.health = 0;
  victim.alive = false;
  victim.deaths += 1;
  if (victim.isPlayer) {
    hud.banner('You are down', 'Your team fights on without you', 1800);
  }
  if (attacker) {
    attacker.kills += 1;
    attacker.cash += 300;
    events.killfeed(`${attacker.name} · ${weaponName}${isHead ? ' · head' : ''} · ${victim.name}`, attacker.team);
    if (attacker.isPlayer) {
      audio.kill();
      if (random() < 0.4) {
        const mates = ['Ash', 'Coal', 'Rust', 'Switch'];
        events.radio(`${mates[Math.floor(random() * mates.length)]}: Nice shot, You.`);
      }
    }
  }
  if (victim.isCarrier) {
    victim.isCarrier = false;
    const mates = S.players.filter((p) => p.alive && p.team === victim.team);
    if (mates.length) {
      const next = mates[Math.floor(random() * mates.length)];
      next.isCarrier = true;
      S.carrier = next;
      events.radio(`${next.name} picked up the charge.`);
    } else {
      S.carrier = null;
    }
  }
  match.checkEnd();
}

// One pellet from one shooter: the nearest of the map, a body or a head wins.
function fireShot(shooter, ox, oy, oz, dx, dy, dz, def) {
  let bestT = def.range;
  let bestVictim = null;
  let bestHead = false;
  for (const c of S.players) {
    if (c === shooter || !c.alive || c.team === shooter.team) continue;
    const tBody = rayBoxes(ox, oy, oz, dx, dy, dz, [c.bodyBox], bestT);
    if (tBody < bestT) {
      bestT = tBody;
      bestVictim = c;
      bestHead = false;
    }
    // Head centre: feet + head height (a crouching player lowers it).
    const hy = c.isPlayer ? c.pos.y + player.state.eye : c.pos.y + 1.55;
    const tHead = raySphere(ox, oy, oz, dx, dy, dz, c.pos.x, hy, c.pos.z, 0.19);
    if (tHead < bestT) {
      bestT = tHead;
      bestVictim = c;
      bestHead = true;
    }
  }
  const tMap = rayBoxes(ox, oy, oz, dx, dy, dz, map.colliders, bestT);
  if (tMap < bestT) bestT = tMap;
  const hitX = ox + dx * bestT;
  const hitY = oy + dy * bestT;
  const hitZ = oz + dz * bestT;
  spawnTracer({ x: ox, y: oy, z: oz }, { x: hitX, y: hitY, z: hitZ });
  if (!bestVictim) return;
  let dmg = def.dmg;
  if (bestT > def.range) dmg *= 0.6;
  if (bestHead) dmg *= bestVictim.helmet ? 1.5 : def.headMult;
  applyDamage(bestVictim, dmg, shooter, def.name, bestHead);
  if (shooter.isPlayer) {
    hud.hitMarker(bestVictim.health <= 0);
    audio.hit();
  }
  bots.hearShot(ox, oz, shooter.team);
}

function shootPlayer() {
  const ammo = playerCombatant.ammo;
  if (!weaponView.ready(ammo)) {
    if (ammo.mag === 0 && ammo.reserve > 0) {
      weaponView.reload(ammo);
      audio.reload();
    } else if (ammo.mag === 0) {
      audio.dryFire();
    }
    return;
  }
  if (!weaponView.takeRound(ammo)) return;
  weaponView.pullTrigger(ammo);
  audio.shot(ammo.def.kind, false);
  const speed = player.groundSpeed();
  const spread = weaponView.spread(ammo, speed, !player.state.onGround, player.state.crouching);
  camera.getWorldDirection(_dir);
  const ox = camera.position.x;
  const oy = camera.position.y;
  const oz = camera.position.z;
  for (let p = 0; p < ammo.def.pellets; p += 1) {
    const jx = spread2(random, spread);
    const jy = spread2(random, spread * 0.7);
    _dir2.set(_dir.x + jx, _dir.y + jy, _dir.z).normalize();
    fireShot(playerCombatant, ox, oy, oz, _dir2.x, _dir2.y, _dir2.z, ammo.def);
  }
  player.recoil(ammo.def.kick * (0.8 + random() * 0.4), spread2(random, 0.004));
  hud.setAmmo(ammo.def.name, ammo.mag, ammo.reserve, playerCombatant.grenades, playerCombatant.hasKit);
}
const _dir = new THREE.Vector3();
const _dir2 = new THREE.Vector3();

function throwPlayerGrenade(kind) {
  const count = playerCombatant.grenades[kind];
  if (count <= 0 || S.phase !== 'live') return;
  playerCombatant.grenades[kind] -= 1;
  camera.getWorldDirection(_dir);
  const origin = new THREE.Vector3(camera.position.x, camera.position.y - 0.15, camera.position.z);
  grenades.throwGrenade(kind, origin, _dir, playerCombatant);
  audio.grenadeThrow();
  hud.setAmmo(playerCombatant.ammo.def.name, playerCombatant.ammo.mag, playerCombatant.ammo.reserve, playerCombatant.grenades, playerCombatant.hasKit);
}

function onGrenadeEffect(effect) {
  if (effect.kind === 'frag') {
    boom(effect.x, effect.y, effect.z);
    for (const c of S.players) {
      if (!c.alive) continue;
      const d = Math.hypot(c.pos.x - effect.x, c.pos.z - effect.z);
      if (d > 6) continue;
      let dmg = Math.max(15, 90 - d * 11);
      if (!losClear(effect.x, effect.y + 0.5, effect.z, c.pos.x, c.pos.y + 1.2, c.pos.z, map.colliders)) dmg *= 0.3;
      applyDamage(c, dmg, effect.owner, 'Frag', false);
    }
    const pd = Math.hypot(player.state.position.x - effect.x, player.state.position.z - effect.z);
    if (pd < 12) shakeT = Math.min(1, shakeT + 0.6);
  } else if (effect.kind === 'flash') {
    const fx = effect.x;
    const fy = effect.y + 0.5;
    const fz = effect.z;
    camera.getWorldDirection(_dir);
    const dx = fx - camera.position.x;
    const dy = fy - camera.position.y;
    const dz = fz - camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 25) {
      const facing = (_dir.x * dx + _dir.y * dy + _dir.z * dz) / (dist || 1);
      if (facing > 0.25 && losClear(camera.position.x, camera.position.y, camera.position.z, fx, fy, fz, map.colliders)) {
        hud.flashWhite(Math.max(0.3, 1 - dist / 25));
      }
    }
    for (const bot of bots.list) {
      if (!bot.alive) continue;
      const bd = Math.hypot(bot.pos.x - fx, bot.pos.z - fz);
      if (bd < 25) bot.blindUntil = S.time + 1.5 + random() * 1;
    }
  }
}

let shakeT = 0;
let stepDistance = 0;
let wasFiring = false;
let scoreboardOpen = false;

function resetRound() {
  const [sx, sz] = map.spawns.yard[0];
  player.reset(sx, sz, 0);
  playerCombatant.health = 100;
  playerCombatant.alive = true;
  playerCombatant.ammo = playerCombatant.active === 'primary' && playerCombatant.primary
    ? playerCombatant.primary : playerCombatant.sidearm;
  playerCombatant.def = playerCombatant.ammo.def;
  for (const slot of ['primary', 'sidearm']) {
    const a = playerCombatant[slot];
    if (a) { a.mag = a.def.mag; a.reserve = a.def.reserve; a.reloadLeft = 0; a.cooldown = 0; }
  }
  playerCombatant.grenades = { frag: 0, smoke: 0, flash: 0 };
  playerCombatant.weaponChanged = true;
  bots.reset(S.round, map.spawns);
  // The charge: the player carries it on odd rounds, a bot on even ones.
  for (const b of bots.list) b.isCarrier = false;
  if (S.round % 2 === 1) {
    playerCombatant.isCarrier = true;
    S.carrier = playerCombatant;
  } else {
    playerCombatant.isCarrier = false;
    const yard = bots.list.filter((b) => b.team === 'yard');
    yard[S.round % yard.length].isCarrier = true;
    S.carrier = yard[S.round % yard.length];
  }
  S.planted = null;
  S.armProgress = 0;
  S.defuseProgress = 0;
  S.phase = 'buy';
  S.timer = BUY_SECONDS;
  grenades.reset();
  for (const t of tracers) t.line.visible = false;
  hud.hideBuyMenu();
  // If the menu was open when the round started, the lock is still released:
  // offer the pause overlay so the player knows to click back in.
  if (!shot && !input.state.locked) hud.showOverlay('paused');
  hud.hideScoreboard();
  hud.banner(`Round ${S.round}`, 'Buy phase — B opens the requisition menu', 2200);
  syncHud();
}

function startMatch() {
  for (const p of S.players) {
    p.kills = 0; p.deaths = 0; p.hs = 0; p.dmg = 0; p.cash = 800;
    p.armour = 0; p.helmet = false; p.hasKit = false;
    p.grenades = { frag: 0, smoke: 0, flash: 0 };
  }
  playerCombatant.primary = null;
  playerCombatant.active = 'sidearm';
  playerCombatant.def = WEAPONS.spike;
  playerCombatant.ammo = playerCombatant.sidearm;
  playerCombatant.weaponChanged = true;
  weaponView.build(WEAPONS.spike);
  match.startMatch();
  resetRound();
}

S.onNextRound = () => resetRound();

function scoreboardRows() {
  let html = '';
  for (const team of ['yard', 'line']) {
    const total = team === 'yard' ? S.yardScore : S.lineScore;
    html += `<tr class="team-row ${team}"><td>${team === 'yard' ? 'YARD' : 'LINE'} · ${total}</td><td>K</td><td>A</td><td>D</td><td>HS</td><td>DMG</td><td>Cash</td></tr>`;
    for (const p of S.players.filter((q) => q.team === team)) {
      const hsPct = p.kills > 0 ? Math.round((p.hs / p.kills) * 100) : 0;
      html += `<tr class="${p.isPlayer ? 'you' : ''}"><td>${p.name}</td><td>${p.kills}</td><td>${p.assists}</td><td>${p.deaths}</td><td>${hsPct}%</td><td>${Math.round(p.dmg)}</td><td>$${p.cash}</td></tr>`;
    }
  }
  return html;
}

function syncHud() {
  const ammo = playerCombatant.ammo;
  hud.setHealth(playerCombatant.health, playerCombatant.armour, playerCombatant.cash);
  hud.setAmmo(playerCombatant.def.name.toUpperCase(), ammo.mag, ammo.reserve, playerCombatant.grenades, playerCombatant.hasKit);
  hud.setTimer(S.timer, S.round, S.phase);
  if (S.phase === 'buy') hud.setBuyTimer(S.timer);
  hud.setScores(S.yardScore, S.lineScore);
  hud.setLocation(areaName(player.state.position.x, player.state.position.z));
  hud.drawMinimap(S, player, bots.list);
  if (S.phase === 'live' && S.armProgress > 0 && S.armSite) {
    hud.setProgress(S.armProgress / 4, `Arming the charge — ${S.map.sites[S.armSite].name}`);
  } else if (S.planted && S.defuseProgress > 0) {
    const need = S.defuseBy && S.defuseBy.hasKit ? 3 : 5;
    hud.setProgress(S.defuseProgress / need, 'Defusing the charge');
  } else {
    hud.hideProgress();
  }
  if (S.phase === 'live' && !S.planted && playerCombatant.isCarrier) {
    const site = nearestSiteToPlayer();
    hud.setPrompt(site ? 'Hold <kbd>E</kbd> to arm the charge' : '');
  } else if (S.phase === 'buy' && !hud.isBuyOpen()) {
    hud.setPrompt('Press <kbd>B</kbd> to open the requisition menu');
  } else {
    hud.setPrompt('');
  }
}

function nearestSiteToPlayer() {
  for (const key of ['A', 'B']) {
    const site = map.sites[key];
    if (Math.hypot(player.state.position.x - site.x, player.state.position.z - site.z) < 2.5) return key;
  }
  return null;
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
  } else if ((S.phase === 'buy' || S.phase === 'live') && !hud.isBuyOpen()) {
    // Losing the lock pauses the game — unless it was released on purpose so
    // the mouse can use the buy menu (B), in which case no overlay may cover it.
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  audio.ensure();
  if (S.phase === 'menu' || S.phase === 'matchend') {
    startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else {
    input.requestLock();
  }
});

hud.buildBuyMenu((itemId) => {
  if (match.buy(playerCombatant, itemId)) {
    hud.refreshBuy(playerCombatant.cash, playerCombatant);
  }
});

function handlePressed(pressed) {
  if (pressed.has('KeyR')) {
    weaponView.reload(playerCombatant.ammo);
    audio.reload();
  }
  if (pressed.has('KeyB') && S.phase === 'buy') {
    if (hud.isBuyOpen()) {
      hud.hideBuyMenu();
      input.requestLock();
    } else {
      hud.refreshBuy(playerCombatant.cash, playerCombatant);
      hud.showBuyMenu();
      // The mouse is the buy menu's only way to pick an item, and a locked
      // pointer never reaches DOM buttons: release it while buying.
      document.exitPointerLock();
    }
  }
  if (pressed.has('Digit1') && playerCombatant.primary) {
    playerCombatant.active = 'primary';
    playerCombatant.def = playerCombatant.primary.def;
    playerCombatant.ammo = playerCombatant.primary;
    playerCombatant.weaponChanged = true;
  }
  if (pressed.has('Digit2')) {
    playerCombatant.active = 'sidearm';
    playerCombatant.def = playerCombatant.sidearm.def;
    playerCombatant.ammo = playerCombatant.sidearm;
    playerCombatant.weaponChanged = true;
  }
  if (pressed.has('Digit3')) throwPlayerGrenade('frag');
  if (pressed.has('Digit4')) throwPlayerGrenade('smoke');
  if (pressed.has('Digit5')) throwPlayerGrenade('flash');
  if (pressed.has('Enter') && S.phase === 'matchend') {
    startMatch();
    hud.hideOverlay();
    input.requestLock();
  }
}

function step(dt) {
  S.time += dt;
  S.keysHeld = input.state.keys;
  if (S.phase !== 'menu') {
    player.step(dt, input.state.keys);
    weaponView.step(playerCombatant.ammo, dt);
    bots.step(dt);
    grenades.step(dt, S.time, onGrenadeEffect);
    match.tick(dt);
    if (playerCombatant.weaponChanged) {
      weaponView.build(playerCombatant.def);
      playerCombatant.weaponChanged = false;
    }
    // Footsteps.
    const speed = player.groundSpeed();
    if (speed > 1 && player.state.onGround) {
      stepDistance += speed * dt;
      if (stepDistance > 2.4) {
        stepDistance = 0;
        audio.footstep();
      }
    }
  }
  map.update(dt, S.time);
  syncChargeMesh();
  if (blast.visible) {
    blastT += dt;
    const k = Math.min(1, blastT / 0.9);
    blast.scale.setScalar(1 + k * 7);
    blast.material.opacity = 0.85 * (1 - k);
    blastLight.intensity = 60 * (1 - k);
    if (k >= 1) {
      blast.visible = false;
      blastLight.intensity = 0;
    }
  }
  for (const t of tracers) {
    if (t.line.visible && S.time > t.until) t.line.visible = false;
  }
  syncBodyBoxes();
}

function syncCamera() {
  camera.position.set(
    player.state.position.x,
    player.state.position.y + player.state.eye,
    player.state.position.z,
  );
  let px = player.state.pitch;
  let yx = player.state.yaw;
  if (shakeT > 0) {
    px += spread2(random, 0.02) * shakeT;
    yx += spread2(random, 0.02) * shakeT;
    shakeT = Math.max(0, shakeT - 0.03);
  }
  camera.rotation.set(px, yx, 0, 'YXZ');
}

let lastTime = performance.now();
let accumulator = 0;
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const pressed = input.takePressed();
    if (S.phase === 'live' || S.phase === 'buy' || S.phase === 'end') handlePressed(pressed);
    else input.takePressed();
    const firing = input.state.firing && (S.phase === 'live');
    const ammo = playerCombatant.ammo;
    if (firing && weaponView.ready(ammo)) {
      if (ammo.def.auto || !wasFiring) shootPlayer();
    }
    wasFiring = firing;
    // Tab scoreboard while held.
    const tabDown = input.state.keys.has('Tab');
    if (tabDown && !scoreboardOpen) {
      scoreboardOpen = true;
      hud.showScoreboard(
        `Night Siding — Round ${S.round}`,
        `YARD ${S.yardScore} : ${S.lineScore} LINE`,
        scoreboardRows(),
      );
    } else if (!tabDown && scoreboardOpen) {
      scoreboardOpen = false;
      if (S.phase !== 'matchend') hud.hideScoreboard();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
    if (S.phase === 'matchend' && !scoreboardOpen) {
      document.exitPointerLock();
      hud.showScoreboard(
        S.matchWinner === 'yard' ? 'VICTORY' : 'DEFEAT',
        `Night Siding · ${S.yardScore} : ${S.lineScore} · Enter for a new match`,
        scoreboardRows(),
      );
      scoreboardOpen = true;
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function forceStats(rows) {
  for (const [name, k, a, d, hs, dmg, cash] of rows) {
    const p = S.players.find((q) => q.name === name);
    if (!p) continue;
    p.kills = k; p.assists = a; p.deaths = d; p.hs = hs; p.dmg = dmg; p.cash = cash;
  }
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  if (name === 'play') {
    S.round = 6;
    S.yardScore = 3;
    S.lineScore = 2;
    S.phase = 'live';
    S.timer = 97;
    player.reset(0, 10, 0);
    playerCombatant.health = 58;
    playerCombatant.armour = 62;
    playerCombatant.hasKit = true;
    playerCombatant.cash = 850;
    playerCombatant.primary = makeAmmoState(WEAPONS.longhaul);
    playerCombatant.primary.mag = 9;
    playerCombatant.primary.reserve = 41;
    playerCombatant.def = WEAPONS.longhaul;
    playerCombatant.ammo = playerCombatant.primary;
    playerCombatant.active = 'primary';
    playerCombatant.grenades = { frag: 2, smoke: 0, flash: 1 };
    playerCombatant.weaponChanged = true;
    // One LINE bot down the lane, already engaging the player.
    const enemy = bots.byName('Bolt');
    enemy.pos.set(1.0, 0, 4);
    enemy.yaw = Math.PI;
    enemy.state = 'engage';
    enemy.target = playerCombatant;
    enemy.lastSeen = { x: 0, y: 0, z: 10, t: S.time };
    settle(30);
    aimAt(new THREE.Vector3(1.0, 1.2, 4));
    shootPlayer();
    settle(2);
    // The bot shot back during the settle; restore the staged numbers.
    playerCombatant.health = 58;
    playerCombatant.armour = 62;
    // The settle also filled the killfeed with real (and contradictory)
    // entries — e.g. Bolt killing the player, who is alive at 58 HP here.
    // Clear it and stage two bot-vs-bot lines instead.
    hud.killfeedClear();
    events.killfeed('Weld · Longhaul AR · Ash', 'yard');
    events.killfeed('Flare · Hammer SMG · Coal', 'line');
    events.radio('RADIO Contact at Engine Shed, rotating.');
    hud.hideBanner();
    syncHud();
  } else if (name === 'buy') {
    S.round = 5;
    S.yardScore = 3;
    S.lineScore = 1;
    S.phase = 'buy';
    S.timer = 11;
    player.reset(0, 16, 0);
    playerCombatant.health = 100;
    playerCombatant.armour = 100;
    playerCombatant.cash = 2950;
    playerCombatant.primary = makeAmmoState(WEAPONS.longhaul);
    playerCombatant.primary.mag = 14;
    playerCombatant.primary.reserve = 38;
    playerCombatant.def = WEAPONS.longhaul;
    playerCombatant.ammo = playerCombatant.primary;
    playerCombatant.active = 'primary';
    playerCombatant.grenades = { frag: 0, smoke: 2, flash: 1 };
    playerCombatant.hasKit = true;
    playerCombatant.weaponChanged = true;
    settle(10);
    hud.refreshBuy(playerCombatant.cash, playerCombatant);
    hud.showBuyMenu();
    hud.hideBanner();
    syncHud();
  } else if (name === 'plant') {
    S.round = 8;
    S.yardScore = 4;
    S.lineScore = 3;
    S.phase = 'live';
    S.timer = 64;
    player.reset(23.5, 13.5, 0);
    playerCombatant.isCarrier = true;
    S.carrier = playerCombatant;
    playerCombatant.health = 100;
    playerCombatant.armour = 100;
    playerCombatant.cash = 1750;
    playerCombatant.primary = makeAmmoState(WEAPONS.longhaul);
    playerCombatant.primary.mag = 17;
    playerCombatant.primary.reserve = 63;
    playerCombatant.def = WEAPONS.longhaul;
    playerCombatant.ammo = playerCombatant.primary;
    playerCombatant.active = 'primary';
    playerCombatant.weaponChanged = true;
    settle(10);
    aimAt(new THREE.Vector3(23.5, 1.2, 15.5));
    // Arm progress is set after the settle: the match tick decays it while the
    // player is not holding E, and clears the site flag with it.
    S.armProgress = 2.4;
    S.armSite = 'B';
    syncChargeMesh();
    hud.hideBanner();
    syncHud();
  } else {
    // end: the match is over, YARD won 7 : 5.
    S.round = 12;
    S.yardScore = 7;
    S.lineScore = 5;
    S.phase = 'matchend';
    S.matchWinner = 'yard';
    S.timer = 0;
    player.reset(0, 10, 0);
    playerCombatant.health = 100;
    playerCombatant.armour = 100;
    playerCombatant.cash = 2900;
    playerCombatant.primary = makeAmmoState(WEAPONS.longhaul);
    playerCombatant.primary.mag = 18;
    playerCombatant.primary.reserve = 54;
    playerCombatant.def = WEAPONS.longhaul;
    playerCombatant.ammo = playerCombatant.primary;
    playerCombatant.active = 'primary';
    playerCombatant.weaponChanged = true;
    forceStats([
      ['You', 8, 2, 6, 3, 861, 2900],
      ['Ash', 9, 4, 8, 6, 1104, 3750],
      ['Coal', 11, 2, 5, 5, 1198, 2600],
      ['Rust', 6, 1, 8, 2, 694, 3100],
      ['Switch', 7, 3, 7, 4, 833, 2350],
      ['Brake', 10, 3, 9, 6, 1057, 0],
      ['Flare', 7, 2, 8, 3, 812, 0],
      ['Gage', 9, 1, 8, 5, 937, 0],
      ['Tie', 5, 4, 7, 2, 588, 0],
      ['Bolt', 3, 2, 9, 1, 341, 0],
    ]);
    settle(10);
    hud.showScoreboard(
      'VICTORY',
      'Night Siding · 7 : 5 · Enter for a new match',
      scoreboardRows(),
    );
    hud.hideBanner();
    syncHud();
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);

// Testing hook: lets the automated playtest drive the game without a mouse
// (pointer lock is unavailable in a headless browser). It exposes the live state
// and the same step/shoot/damage paths the real input uses; it changes nothing
// in play.
window.__nightSiding = {
  S, player, bots, input, step, shootPlayer, applyDamage, match, resetRound,
  startMatch, throwPlayerGrenade, aimAt,
  // Mouse look through the player's own method (yaw lives in player.state).
  look(dx, dy) { player.look(dx, dy); },
  // Feed one edge-triggered key press through the same handler real keys use.
  press(code) { handlePressed(new Set([code])); },
  reload() { handlePressed(new Set(['KeyR'])); },
};
