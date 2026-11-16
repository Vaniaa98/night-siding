// Night Siding — the bots. Nine of them: four YARD teammates and five LINE
// defenders, each with a name, a route and a job. A bot thinks ten times a second
// (scan for a visible enemy, pick a state) and moves and shoots every fixed step.
// They follow routes, hold positions, plant and defuse, and they hear gunshots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { capsuleHitsAny, losClear } from './physics.js';
import { makeAmmoState, WEAPONS } from './weapons.js';
import { pick, range, spread2 } from './rng.js';

const BOT_NAMES = {
  yard: ['Ash', 'Coal', 'Rust', 'Switch'],
  line: ['Brake', 'Flare', 'Gage', 'Tie', 'Bolt'],
};
const BOT_SPEED = 4.3;
const BOT_EYE = 1.55;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const SEE_DIST = 34;
const SEE_HALF_ANGLE = 1.0;

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function buildBotMesh(scene, team) {
  const teamColor = team === 'yard' ? PALETTE.yard : PALETTE.line;
  const group = new THREE.Group();
  const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262c'), roughness: 0.5, metalness: 0.4 });

  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  part(0.16, 0.5, 0.2, -0.12, 0.25, 0, darkMat); // legs
  part(0.16, 0.5, 0.2, 0.12, 0.25, 0, darkMat);
  part(0.56, 0.72, 0.34, 0, 0.98, 0, teamMat); // torso
  part(0.6, 0.16, 0.38, 0, 1.28, 0, darkMat); // shoulders
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skinMat);
  head.position.set(0, 1.55, 0);
  head.castShadow = true;
  group.add(head);
  part(0.4, 0.16, 0.4, 0, 1.66, 0, teamMat); // helmet
  part(0.07, 0.09, 0.6, 0.2, 1.15, -0.3, gunMat); // gun
  const marker = part(0.34, 0.05, 0.34, 0, 1.98, 0, teamMat); // team diamond
  marker.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor) });
  scene.add(group);
  return { group, head };
}

export function createBots(scene, map, S, rng, audio, world) {
  // world: { fireShot(shooter, ox, oy, oz, dx, dy, dz, def), smokeBlocks(ax,ay,az,bx,by,bz,now) }
  const bots = [];

  function makeBot(team, name, index) {
    const { group, head } = buildBotMesh(scene, team);
    const bot = {
      id: `bot-${team}-${index}`,
      name,
      team,
      isPlayer: false,
      pos: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      health: 100,
      armour: 0,
      helmet: false,
      alive: true,
      def: WEAPONS.spike,
      ammo: makeAmmoState(WEAPONS.spike),
      sidearm: makeAmmoState(WEAPONS.spike),
      active: 'primary',
      grenades: { frag: 0, smoke: 0, flash: 0 },
      kills: 0, deaths: 0, hs: 0, dmg: 0, cash: 800,
      group, head,
      bodyBox: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
      route: [], routeIdx: 0, role: team === 'yard' ? 'attack' : 'defend',
      state: 'route', target: null, lastSeen: null,
      burstLeft: 0, burstPause: 0, thinkT: rng() * 0.12,
      strafePhase: rng() * Math.PI * 2, strafeDir: 1,
      fallT: 0, plantT: 0, defuseT: 0, investigate: null, investigateUntil: 0,
      blindUntil: 0, isCarrier: false, reloadLeft: 0,
    };
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('yard', BOT_NAMES.yard[i], i);
  for (let i = 0; i < 5; i += 1) makeBot('line', BOT_NAMES.line[i], i);

  function visibleEnemy(bot) {
    const eyeX = bot.pos.x;
    const eyeY = BOT_EYE;
    const eyeZ = bot.pos.z;
    let best = null;
    let bestDist = SEE_DIST;
    for (const other of S.players) {
      if (!other.alive || other.team === bot.team) continue;
      const dx = other.pos.x - eyeX;
      const dz = other.pos.z - eyeZ;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist) continue;
      const angle = Math.atan2(-dx, -dz);
      if (Math.abs(angleDiff(angle, bot.yaw)) > SEE_HALF_ANGLE) continue;
      const chestY = other.pos.y + 1.2;
      if (!losClear(eyeX, eyeY, eyeZ, other.pos.x, chestY, other.pos.z, map.colliders)) continue;
      if (world.smokeBlocks(eyeX, eyeY, eyeZ, other.pos.x, chestY, other.pos.z, S.time)) continue;
      best = other;
      bestDist = dist;
    }
    return best ? { enemy: best, dist: bestDist } : null;
  }

  function think(bot) {
    if (!bot.alive) return;
    const seen = visibleEnemy(bot);
    if (seen) {
      bot.state = 'engage';
      bot.target = seen.enemy;
      bot.lastSeen = { x: seen.enemy.pos.x, y: seen.enemy.pos.y, z: seen.enemy.pos.z, t: S.time };
      return;
    }
    if (bot.target && bot.lastSeen && S.time - bot.lastSeen.t < 2) {
      bot.state = 'hunt';
      return;
    }
    bot.target = null;
    // Objective work first.
    if (bot.team === 'yard' && bot.isCarrier && !S.planted) {
      const site = nearestSite(bot.pos);
      if (site && Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z) < 2.5
        && !enemyNear(site.x, site.z, 9, 'line')) {
        bot.state = 'plant';
        return;
      }
    }
    if (bot.team === 'line' && S.planted) {
      const site = map.sites[S.planted.site];
      const d = Math.hypot(bot.pos.x - site.x, bot.pos.z - site.z);
      if (d < 2.5 && !enemyNear(site.x, site.z, 9, 'yard')) {
        bot.state = 'defuse';
        return;
      }
      bot.state = 'route';
      bot.route = [[site.x, site.z]];
      bot.routeIdx = 0;
      return;
    }
    bot.state = bot.route.length ? 'route' : 'hold';
  }

  function nearestSite(pos) {
    let best = null;
    let bestD = 2.5;
    for (const key of ['A', 'B']) {
      const site = map.sites[key];
      const d = Math.hypot(pos.x - site.x, pos.z - site.z);
      if (d < bestD) { bestD = d; best = site; }
    }
    return best;
  }

  function enemyNear(x, z, radius, team) {
    for (const other of S.players) {
      if (!other.alive || other.team !== team) continue;
      if (Math.hypot(other.pos.x - x, other.pos.z - z) < radius) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    const nextX = bot.pos.x + vx * dt;
    if (!capsuleHitsAny(nextX, 0, bot.pos.z, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.x = nextX;
    const nextZ = bot.pos.z + vz * dt;
    if (!capsuleHitsAny(bot.pos.x, 0, nextZ, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.z = nextZ;
    const targetYaw = Math.atan2(-vx, -vz);
    bot.yaw += angleDiff(targetYaw, bot.yaw) * Math.min(1, dt * 8);
    return dist < 0.9;
  }

  function fireAt(bot, dt) {
    if (bot.state !== 'engage' || !bot.target || !bot.target.alive) return;
    const ammo = bot.ammo;
    if (ammo.reloadLeft > 0) {
      ammo.reloadLeft -= dt;
      if (ammo.reloadLeft <= 0) {
        const take = Math.min(ammo.def.mag - ammo.mag, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
      return;
    }
    if (ammo.mag === 0) {
      if (ammo.reserve > 0) ammo.reloadLeft = ammo.def.reload;
      return;
    }
    ammo.cooldown -= dt;
    if (ammo.cooldown > 0) return;
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause > 0) return;
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstPause = 0.6 + rng() * 0.7;
    }
    const target = bot.target;
    const dist = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    // Aim at the chest with an error that grows with distance and target speed.
    const speed = target.isPlayer ? 5 : BOT_SPEED;
    const err = 0.022 + dist * 0.0016 + (target.isPlayer ? 0.012 : 0);
    const ox = bot.pos.x;
    const oy = BOT_EYE;
    const oz = bot.pos.z;
    const tx = target.pos.x;
    const ty = target.pos.y + 1.15 + spread2(rng, 0.25);
    const tz = target.pos.z;
    let dx = tx - ox;
    let dy = ty - oy;
    let dz = tz - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    // Perpendicular jitter.
    const px = -dz;
    const pz = dx;
    const j1 = spread2(rng, err);
    const j2 = spread2(rng, err * 0.6);
    dx += px * j1;
    dy += j2;
    dz += pz * j1;
    const n = Math.hypot(dx, dy, dz) || 1;
    const pellets = Math.min(ammo.def.pellets, 4);
    for (let i = 0; i < pellets; i += 1) {
      world.fireShot(bot, ox, oy, oz, dx / n, dy / n, dz / n, ammo.def);
    }
    ammo.mag -= 1;
    ammo.cooldown = ammo.def.gap;
    bot.burstLeft -= 1;
    audio.shot(ammo.def.kind, true);
  }

  function step(dt) {
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fallT < 1) {
          bot.fallT = Math.min(1, bot.fallT + dt * 2.5);
          bot.group.rotation.x = -bot.fallT * 1.5;
        }
        continue;
      }
      // During the buy phase everyone holds at spawn; no thinking, no firing.
      if (S.phase !== 'live' && S.phase !== 'end') {
        bot.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
        bot.group.rotation.y = bot.yaw;
        continue;
      }
      bot.thinkT -= dt;
      if (bot.thinkT <= 0) {
        think(bot);
        bot.thinkT = 0.12 + rng() * 0.06;
      }
      const blind = S.time < bot.blindUntil;
      if (bot.state === 'engage' && bot.target && bot.target.alive && !blind) {
        // Face the target and strafe, closing or opening range.
        const dx = bot.target.pos.x - bot.pos.x;
        const dz = bot.target.pos.z - bot.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        const wantYaw = Math.atan2(-dx, -dz);
        bot.yaw += angleDiff(wantYaw, bot.yaw) * Math.min(1, dt * 10);
        bot.strafeDir = Math.sin(S.time * 1.3 + bot.strafePhase) > 0 ? 1 : -1;
        const strafeX = -dz / dist * bot.strafeDir;
        const strafeZ = dx / dist * bot.strafeDir;
        const rangeMove = dist > 20 ? 1 : dist < 6 ? -1 : 0;
        const mx = strafeX * 2.2 + (dx / dist) * rangeMove * 2.0;
        const mz = strafeZ * 2.2 + (dz / dist) * rangeMove * 2.0;
        const nx = bot.pos.x + mx * dt;
        if (!capsuleHitsAny(nx, 0, bot.pos.z, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.x = nx;
        const nz = bot.pos.z + mz * dt;
        if (!capsuleHitsAny(bot.pos.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.z = nz;
      } else if (bot.state === 'hunt' && bot.lastSeen && !blind) {
        moveToward(bot, bot.lastSeen.x, bot.lastSeen.z, dt, BOT_SPEED);
      } else if (bot.state === 'route' && bot.route.length && !blind) {
        const wp = bot.route[bot.routeIdx % bot.route.length];
        const arrived = moveToward(bot, wp[0], wp[1], dt, BOT_SPEED);
        if (arrived) bot.routeIdx += 1;
      } else if (blind) {
        // Blinded: shuffle slowly in a random direction.
        const a = bot.strafePhase + S.time;
        const nx = bot.pos.x + Math.sin(a) * 1.2 * dt;
        const nz = bot.pos.z + Math.cos(a) * 1.2 * dt;
        if (!capsuleHitsAny(nx, 0, bot.pos.z, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.x = nx;
        if (!capsuleHitsAny(bot.pos.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, 0.04, map.colliders)) bot.pos.z = nz;
      }
      // Plant and defuse are standing jobs; the match advances their progress.
      fireAt(bot, dt);
      bot.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.group.rotation.y = bot.yaw;
      bot.group.rotation.x = bot.alive ? 0 : bot.group.rotation.x;
    }
  }

  function reset(round, spawns) {
    const yardRoute = rng() < 0.5 ? 'yardToA' : 'yardToB';
    const lineRoutes = ['lineHoldA', 'lineHoldB', 'lineMid'];
    let lineIdx = 0;
    for (const bot of bots) {
      const spawnList = spawns[bot.team];
      const index = bot.team === 'yard'
        ? bots.filter((b) => b.team === 'yard').indexOf(bot)
        : bots.filter((b) => b.team === 'line').indexOf(bot);
      const [x, z] = spawnList[index % spawnList.length];
      bot.pos.set(x, 0, z);
      bot.yaw = bot.team === 'yard' ? Math.PI : 0;
      bot.health = 100;
      bot.alive = true;
      bot.fallT = 0;
      bot.target = null;
      bot.lastSeen = null;
      bot.state = 'route';
      bot.isCarrier = false;
      bot.plantT = 0;
      bot.defuseT = 0;
      bot.investigate = null;
      bot.blindUntil = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.set(x, 0, z);
      // Bots buy like the round number says: pistol round first, rifles later.
      const cash = bot.cash;
      let def = WEAPONS.spike;
      if (round >= 4 && cash >= WEAPONS.longhaul.price) def = WEAPONS.longhaul;
      else if (round >= 3 && cash >= WEAPONS.hammer.price) def = pick(rng, [WEAPONS.hammer, WEAPONS.coupler]);
      else if (round >= 2 && cash >= WEAPONS.hammer.price) def = WEAPONS.hammer;
      if (def !== WEAPONS.spike) bot.cash -= def.price;
      bot.def = def;
      bot.ammo = makeAmmoState(def);
      bot.sidearm = makeAmmoState(WEAPONS.spike);
      bot.active = 'primary';
      bot.armour = 0;
      bot.helmet = false;
      if (round >= 3 && bot.cash >= 400) { bot.armour = 50; bot.cash -= 400; }
      if (bot.team === 'yard') {
        bot.route = map.routes[yardRoute].slice();
        bot.routeIdx = 0;
      } else {
        bot.route = map.routes[lineRoutes[lineIdx % lineRoutes.length]].slice();
        lineIdx += 1;
        bot.routeIdx = Math.floor(rng() * bot.route.length);
      }
    }
    // One YARD member carries the charge; it rotates between the bots.
    const yard = bots.filter((b) => b.team === 'yard');
    yard[round % yard.length].isCarrier = true;
  }

  function hearShot(x, z, team) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === team) continue;
      const d = Math.hypot(bot.pos.x - x, bot.pos.z - z);
      if (d < 22 && bot.state !== 'engage') {
        bot.investigate = { x, z };
        bot.investigateUntil = S.time + 4;
        if (bot.state === 'route' || bot.state === 'hold') {
          bot.route = [[x, z]];
          bot.routeIdx = 0;
        }
      }
    }
  }

  return {
    list: bots,
    step,
    reset,
    hearShot,
    byName(name) {
      return bots.find((b) => b.name === name) || null;
    },
  };
}
