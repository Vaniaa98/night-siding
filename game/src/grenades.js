// Night Siding — thrown grenades. A grenade is a small sphere with velocity and a
// fuse: Frag explodes, Smoke leaves a 12 s cloud that blocks sight, Flash blinds
// anyone facing it. Grenades are the only entities with gravity besides the player.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const SMOKE_SECONDS = 12;
const SMOKE_RADIUS = 3.4;

export function createGrenades(scene) {
  const active = [];
  const smokes = [];
  const sphereGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 });
  const smokeGeo = new THREE.SphereGeometry(SMOKE_RADIUS, 18, 12);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#9aa4ae'), transparent: true, opacity: 0.82, depthWrite: false,
  });

  function throwGrenade(kind, origin, dir, owner) {
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    active.push({
      kind, owner, mesh,
      vx: dir.x * 15, vy: dir.y * 15 + 4.5, vz: dir.z * 15,
      fuse: kind === 'frag' ? 1.6 : 1.4,
    });
  }

  // Does the segment from a to b pass through any live smoke cloud?
  function smokeBlocks(ax, ay, az, bx, by, bz, now) {
    for (const smoke of smokes) {
      if (smoke.until < now) continue;
      // Segment-sphere test, squared distances only.
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const apx = smoke.x - ax;
      const apy = smoke.y - ay;
      const apz = smoke.z - az;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 === 0 ? 0 : (apx * abx + apy * aby + apz * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + abx * t - smoke.x;
      const cy = ay + aby * t - smoke.y;
      const cz = az + abz * t - smoke.z;
      if (cx * cx + cy * cy + cz * cz < SMOKE_RADIUS * SMOKE_RADIUS) return true;
    }
    return false;
  }

  return {
    active,
    smokes,
    throwGrenade,
    smokeBlocks,
    // Returns an effect object when a grenade goes off, or null.
    step(dt, now, onEffect) {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const g = active[i];
        g.fuse -= dt;
        g.vy -= GRAVITY * dt;
        g.mesh.position.x += g.vx * dt;
        g.mesh.position.y += g.vy * dt;
        g.mesh.position.z += g.vz * dt;
        if (g.mesh.position.y < 0.12) {
          g.mesh.position.y = 0.12;
          g.vy = -g.vy * 0.35;
          g.vx *= 0.6;
          g.vz *= 0.6;
        }
        if (g.fuse > 0) continue;
        const pos = g.mesh.position;
        scene.remove(g.mesh);
        active.splice(i, 1);
        if (g.kind === 'smoke') {
          const cloud = new THREE.Mesh(smokeGeo, smokeMat.clone());
          cloud.position.set(pos.x, 1.6, pos.z);
          scene.add(cloud);
          smokes.push({ x: pos.x, y: 1.6, z: pos.z, until: now + SMOKE_SECONDS, mesh: cloud });
          onEffect({ kind: 'smoke', x: pos.x, y: pos.y, z: pos.z });
        } else {
          onEffect({ kind: g.kind, x: pos.x, y: pos.y, z: pos.z, owner: g.owner });
        }
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const smoke = smokes[i];
        if (smoke.until >= now) continue;
        scene.remove(smoke.mesh);
        smokes.splice(i, 1);
      }
    },
    reset() {
      for (const g of active) scene.remove(g.mesh);
      active.length = 0;
      for (const smoke of smokes) scene.remove(smoke.mesh);
      smokes.length = 0;
    },
  };
}
