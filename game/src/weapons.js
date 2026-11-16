// Night Siding — the armoury. Five weapons, three grenades, three pieces of gear,
// all with our own names. A weapon definition is data; the view model is built from
// boxes in front of the camera, and the state (magazine, reserve, cooldown, reload)
// is one small object per combatant. Bots reuse the same definitions without a view.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  spike: {
    id: 'spike', name: 'Spike 9', kind: 'pistol', price: 200,
    dmg: 30, headMult: 3, pellets: 1, mag: 12, reserve: 36,
    gap: 0.16, auto: false, reload: 1.4, spreadStill: 0.004, spreadMove: 0.03,
    range: 60, kick: 0.02, barrel: 0.28, body: 0.3,
  },
  hammer: {
    id: 'hammer', name: 'Hammer SMG', kind: 'smg', price: 1200,
    dmg: 22, headMult: 3, pellets: 1, mag: 30, reserve: 120,
    gap: 0.08, auto: true, reload: 1.8, spreadStill: 0.006, spreadMove: 0.035,
    range: 50, kick: 0.012, barrel: 0.34, body: 0.36,
  },
  coupler: {
    id: 'coupler', name: 'Coupler 12', kind: 'shotgun', price: 900,
    dmg: 12, headMult: 2, pellets: 8, mag: 6, reserve: 24,
    gap: 0.85, auto: false, reload: 2.4, spreadStill: 0.05, spreadMove: 0.06,
    range: 25, kick: 0.06, barrel: 0.42, body: 0.4,
  },
  longhaul: {
    id: 'longhaul', name: 'Longhaul AR', kind: 'rifle', price: 2700,
    dmg: 32, headMult: 3, pellets: 1, mag: 30, reserve: 90,
    gap: 0.1, auto: true, reload: 1.9, spreadStill: 0.003, spreadMove: 0.028,
    range: 80, kick: 0.016, barrel: 0.5, body: 0.44,
  },
  signal: {
    id: 'signal', name: 'Signal DMR', kind: 'dmr', price: 4500,
    dmg: 80, headMult: 4, pellets: 1, mag: 5, reserve: 20,
    gap: 0.9, auto: false, reload: 2.2, spreadStill: 0.001, spreadMove: 0.02,
    range: 100, kick: 0.05, barrel: 0.62, body: 0.5,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag', price: 300, hint: 'Blast up to 6 m' },
  smoke: { id: 'smoke', name: 'Smoke', price: 250, hint: '12 s cloud that blocks sight' },
  flash: { id: 'flash', name: 'Flash', price: 200, hint: 'Blinds whoever faces it' },
};

export const GEAR = {
  vest: { id: 'vest', name: 'Kevlar vest', price: 400, hint: 'Body armour 50' },
  helmet: { id: 'helmet', name: 'Helmet', price: 350, hint: 'Headshots hurt less' },
  kit: { id: 'kit', name: 'Defuse kit', price: 400, hint: 'Defuse in 3 s instead of 5 s' },
};

export const BUY_ORDER = [
  { group: 'Sidearms', items: [WEAPONS.spike] },
  { group: 'Close range', items: [WEAPONS.hammer, WEAPONS.coupler] },
  { group: 'Rifles', items: [WEAPONS.longhaul, WEAPONS.signal] },
  { group: 'Gear', items: [GEAR.vest, GEAR.helmet, GEAR.kit] },
  { group: 'Grenades', items: [GRENADES.frag, GRENADES.smoke, GRENADES.flash] },
];

// Fresh ammunition state for one combatant holding `def`.
export function makeAmmoState(def) {
  return {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
  };
}

// The player's first-person view model: boxes in front of the camera, a muzzle
// flash plane and a flash light. Swapping weapons rebuilds the model from the new
// definition; the state object is kept by the caller.
export function createPlayerWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rustDark), roughness: 0.8, metalness: 0.1 });

  const model = new THREE.Group();
  model.position.set(0.28, -0.26, -0.55);
  model.scale.setScalar(0.75);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0.28, -0.17, -1.1);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.28, -0.16, -1.0);
  camera.add(flashLight);

  let current = null;

  function build(def) {
    while (model.children.length) model.remove(model.children[0]);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, def.body), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, def.barrel), grip);
    barrel.position.set(0, 0.025, -def.body / 2 - def.barrel / 2 + 0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
    stock.position.set(0, -0.02, def.body / 2 - 0.05);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), grip);
    sight.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, stock, sight);
    current = def;
  }

  return {
    build,
    current() { return current; },
    step(state, dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      model.position.z = -0.55 + state.kick;
      model.rotation.x = state.kick * 2.2;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 10;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        model.rotation.x = -0.55 * Math.min(1, (state.def.reload - state.reloadLeft) * 2);
        if (state.reloadLeft === 0) {
          const need = state.def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
    ready(state) {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger(state) {
      state.cooldown = state.def.gap;
      state.flash = 0.06;
      state.kick = state.def.kick;
    },
    takeRound(state) {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload(state) {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return;
      state.reloadLeft = state.def.reload;
    },
    // Spread grows with speed and with being airborne: stopping to aim pays.
    spread(state, speed, airborne, crouched) {
      const move = Math.min(1, speed / 5.2);
      let value = state.def.spreadStill + move * state.def.spreadMove;
      if (airborne) value *= 2.2;
      if (crouched) value *= 0.6;
      return value;
    },
  };
}
