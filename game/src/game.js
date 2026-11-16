// Night Siding — the match. Rounds, money, the charge, and who won. One match is
// 12 rounds at most, first to 7. YARD attacks (plants the charge); LINE defends.
// The match owns no meshes and no DOM — it reads and writes the shared state S,
// and main.js does the drawing. Economy: a kill pays $300, a round win $3,250,
// a round loss $1,900, planting the charge $300.
import { WEAPONS, GRENADES, GEAR, makeAmmoState } from './weapons.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 5;
export const ARM_SECONDS = 4;
export const DEFUSE_SECONDS = 5;
export const DEFUSE_KIT_SECONDS = 3;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 12;

export function createMatch(S, rng, audio, events) {
  // events: { radio(text), killfeed(text, killerTeam, victimTeam), banner(text, sub) }

  function aliveCount(team) {
    let n = 0;
    for (const p of S.players) if (p.alive && p.team === team) n += 1;
    return n;
  }

  function enemyNear(x, z, radius, team) {
    for (const p of S.players) {
      if (!p.alive || p.team !== team) continue;
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < radius) return true;
    }
    return false;
  }

  function carrierIsArming() {
    const carrier = S.carrier;
    if (!carrier || !carrier.alive || S.planted) return null;
    for (const key of ['A', 'B']) {
      const site = S.map.sites[key];
      const d = Math.hypot(carrier.pos.x - site.x, carrier.pos.z - site.z);
      if (d > 2.5) continue;
      if (enemyNear(site.x, site.z, 9, 'line')) return null;
      if (!carrier.isPlayer) return { site: key, by: carrier };
      if (S.keysHeld && S.keysHeld.has('KeyE')) return { site: key, by: carrier };
      return null;
    }
    return null;
  }

  function defuserWorking() {
    if (!S.planted) return null;
    const site = S.map.sites[S.planted.site];
    for (const p of S.players) {
      if (!p.alive || p.team !== 'line') continue;
      if (Math.hypot(p.pos.x - site.x, p.pos.z - site.z) > 2.5) continue;
      if (enemyNear(site.x, site.z, 9, 'yard')) continue;
      if (!p.isPlayer) return { by: p, seconds: p.hasKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS };
      if (S.keysHeld && S.keysHeld.has('KeyE')) {
        return { by: p, seconds: p.hasKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS };
      }
    }
    return null;
  }

  function pay(team, amount) {
    for (const p of S.players) {
      if (p.team === team) p.cash += amount;
    }
  }

  function endRound(winner, reason) {
    if (S.phase !== 'live') return;
    S.phase = 'end';
    S.timer = END_SECONDS;
    S.roundWinner = winner;
    if (winner === 'yard') S.yardScore += 1;
    else S.lineScore += 1;
    pay(winner, 3250);
    pay(winner === 'yard' ? 'line' : 'yard', 1900);
    events.banner(
      winner === 'yard' ? 'YARD takes the round' : 'LINE takes the round',
      reason,
    );
    events.radio(reason);
    if (winner === 'yard') audio.roundWin();
    else audio.roundLoss();
    const done = S.yardScore >= WIN_ROUNDS || S.lineScore >= WIN_ROUNDS || S.round >= MAX_ROUNDS;
    S.matchOver = done;
  }

  function checkEnd() {
    if (S.phase !== 'live') return;
    if (S.planted && S.planted.fuse <= 0) {
      events.radio('The charge detonated — Freight Yard is gone.');
      endRound('yard', 'Charge detonated');
      return;
    }
    if (aliveCount('line') === 0) {
      endRound('yard', 'LINE eliminated');
      return;
    }
    if (aliveCount('yard') === 0) {
      endRound('line', 'YARD eliminated');
    }
  }

  function tick(dt) {
    if (S.phase === 'buy') {
      S.timer -= dt;
      if (S.timer <= 0) {
        S.phase = 'live';
        S.timer = ROUND_SECONDS;
        events.radio(`Round ${S.round} — go go go.`);
      }
      return;
    }
    if (S.phase === 'live') {
      S.timer -= dt;
      if (S.timer <= 0) {
        S.timer = 0;
        endRound('line', 'Time — LINE holds the yard');
        return;
      }
      // The charge: arm it, then its fuse runs.
      if (!S.planted) {
        const arming = carrierIsArming();
        if (arming) {
          S.armProgress += dt;
          S.armSite = arming.site;
          S.armBy = arming.by;
          if (Math.floor(S.armProgress * 2) !== Math.floor((S.armProgress - dt) * 2)) audio.beep();
          if (S.armProgress >= ARM_SECONDS) {
            S.planted = { site: arming.site, fuse: FUSE_SECONDS, by: arming.by };
            S.armProgress = 0;
            pay('yard', 300);
            events.radio(`Charge planted at ${S.map.sites[arming.site].name} — ${FUSE_SECONDS} seconds.`);
            events.banner('Charge planted', `${S.map.sites[arming.site].name} — hold the site`);
            audio.explosion();
          }
        } else {
          S.armProgress = Math.max(0, S.armProgress - dt * 2);
          S.armSite = null;
        }
      } else {
        S.planted.fuse -= dt;
        const working = defuserWorking();
        if (working) {
          S.defuseProgress += dt;
          S.defuseBy = working.by;
          if (Math.floor(S.defuseProgress * 2) !== Math.floor((S.defuseProgress - dt) * 2)) audio.beep();
          if (S.defuseProgress >= working.seconds) {
            S.planted = null;
            S.defuseProgress = 0;
            endRound('line', 'Charge defused');
            return;
          }
        } else {
          S.defuseProgress = Math.max(0, S.defuseProgress - dt * 2);
        }
      }
      checkEnd();
      return;
    }
    if (S.phase === 'end') {
      S.timer -= dt;
      if (S.timer <= 0) {
        if (S.matchOver) {
          S.phase = 'matchend';
          S.matchWinner = S.yardScore > S.lineScore ? 'yard' : 'line';
          events.banner(
            S.matchWinner === 'yard' ? 'VICTORY' : 'DEFEAT',
            `Night Siding · ${S.yardScore} : ${S.lineScore} · Enter for a new match`,
          );
        } else {
          S.round += 1;
          S.onNextRound();
        }
      }
    }
  }

  function buy(combatant, itemId) {
    if (S.phase !== 'buy') return false;
    const table = { ...WEAPONS, ...GRENADES, ...GEAR };
    const item = table[itemId];
    if (!item) return false;
    if (combatant.cash < item.price) return false;
    if (itemId === 'vest') {
      if (combatant.armour >= 50) return false;
      combatant.armour = 50;
    } else if (itemId === 'helmet') {
      if (combatant.helmet) return false;
      combatant.helmet = true;
    } else if (itemId === 'kit') {
      if (combatant.hasKit) return false;
      combatant.hasKit = true;
    } else if (GRENADES[itemId]) {
      if (combatant.grenades[itemId] >= 2) return false;
      combatant.grenades[itemId] += 1;
    } else {
      // A primary weapon replaces the one in hand; the Spike 9 stays the sidearm.
      combatant.primary = makeAmmoState(WEAPONS[itemId]);
      combatant.def = WEAPONS[itemId];
      combatant.ammo = combatant.primary;
      combatant.active = 'primary';
      if (combatant.isPlayer) combatant.weaponChanged = true;
    }
    combatant.cash -= item.price;
    if (combatant.isPlayer) audio.buy();
    return true;
  }

  return {
    tick,
    checkEnd,
    endRound,
    buy,
    aliveCount,
    startMatch() {
      S.yardScore = 0;
      S.lineScore = 0;
      S.round = 1;
      S.matchOver = false;
      S.matchWinner = null;
      S.planted = null;
      S.armProgress = 0;
      S.defuseProgress = 0;
      S.phase = 'buy';
      S.timer = BUY_SECONDS;
    },
  };
}
