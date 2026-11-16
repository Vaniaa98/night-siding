// Night Siding — the DOM HUD. It never touches the simulation: main.js pushes the
// shared state in once a frame and the HUD writes only what changed. That is the
// whole contract — no game logic lives here, only presentation.
import { BUY_ORDER } from './weapons.js';

const COPY = {
  start: {
    title: 'Night Siding',
    copy: 'A night railyard, five against five. Plant the charge at Engine Shed or Freight Hall — or stop LINE from doing the same. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Night Siding',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    health: $('health-value'), armour: $('armour-value'), cash: $('cash-value'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), grenadeLine: $('grenade-line'),
    timer: $('timer-value'), roundLabel: $('round-label'),
    scoreYard: $('score-yard'), scoreLine: $('score-line'),
    location: $('location-name'), killfeed: $('killfeed'), radio: $('radio'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    progress: $('progress'), progressFill: $('progress-fill'), progressLabel: $('progress-label'),
    prompt: $('prompt'), buymenu: $('buymenu'), buyCash: $('buy-cash'),
    buyGrid: $('buy-grid'), buyTimer: $('buy-timer'),
    scoreboard: $('scoreboard'), scoreTitle: $('score-title'),
    scoreSub: $('score-sub'), scoreRows: $('score-rows'),
    flash: $('flash'), minimap: $('minimap'),
  };
  const mapCtx = els.minimap.getContext('2d');
  const last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let buyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function drawMinimap(S, player, bots) {
    const canvas = els.minimap;
    const w = canvas.width;
    const h = canvas.height;
    const mm = S.map.minimap;
    const sx = w / (mm.maxX - mm.minX);
    const sy = h / (mm.maxZ - mm.minZ);
    const X = (x) => (x - mm.minX) * sx;
    const Z = (z) => (z - mm.minZ) * sy;
    mapCtx.clearRect(0, 0, w, h);
    mapCtx.fillStyle = 'rgba(13, 20, 32, 0.92)';
    mapCtx.fillRect(0, 0, w, h);
    // Tracks.
    mapCtx.strokeStyle = '#5a6a7d';
    mapCtx.lineWidth = 2;
    for (const tx of mm.tracks) {
      mapCtx.beginPath();
      mapCtx.moveTo(X(tx), Z(mm.minZ));
      mapCtx.lineTo(X(tx), Z(mm.maxZ));
      mapCtx.stroke();
    }
    // Walls.
    mapCtx.fillStyle = '#2b3547';
    for (const [x, z, rw, rd] of mm.walls) {
      mapCtx.fillRect(X(x - rw / 2), Z(z - rd / 2), rw * sx, rd * sy);
    }
    // Sites.
    for (const key of ['A', 'B']) {
      const [x, z] = mm.sites[key];
      const planted = S.planted && S.planted.site === key;
      mapCtx.fillStyle = planted ? '#e5484d' : '#ff9a2e';
      mapCtx.beginPath();
      mapCtx.arc(X(x), Z(z), planted ? 7 : 5, 0, Math.PI * 2);
      mapCtx.fill();
      mapCtx.fillStyle = '#0d1420';
      mapCtx.font = 'bold 9px system-ui, sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.textBaseline = 'middle';
      mapCtx.fillText(key, X(x), Z(z));
    }
    // Teammates.
    for (const p of S.players) {
      if (!p.alive || p.team !== 'yard' || p.isPlayer) continue;
      mapCtx.fillStyle = '#ff8c1a';
      mapCtx.beginPath();
      mapCtx.arc(X(p.pos.x), Z(p.pos.z), 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Enemies: only when a teammate has seen one lately.
    for (const p of S.players) {
      if (!p.alive || p.team !== 'line') continue;
      const seen = bots.some((b) => b.target === p && S.time - (b.lastSeen ? b.lastSeen.t : -99) < 3)
        || (p.lastSeenBy && S.time - p.lastSeenBy < 3);
      if (!seen) continue;
      mapCtx.fillStyle = '#3f8cff';
      mapCtx.beginPath();
      mapCtx.arc(X(p.pos.x), Z(p.pos.z), 3, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // The player: an arrow that turns with the view.
    const px = X(player.state.position.x);
    const pz = Z(player.state.position.z);
    mapCtx.save();
    mapCtx.translate(px, pz);
    mapCtx.rotate(-player.state.yaw);
    mapCtx.fillStyle = '#e9e4d6';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -7);
    mapCtx.lineTo(5, 5);
    mapCtx.lineTo(-5, 5);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

  return {
    setHealth(health, armour, cash) {
      setText(els.health, 'health', String(Math.max(0, Math.ceil(health))));
      setText(els.armour, 'armour', armour > 0 ? `${Math.ceil(armour)}+H` : '0');
      setText(els.cash, 'cash', `$${cash}`);
      els.health.parentElement.classList.toggle('low', health <= 30);
    },
    setAmmo(weaponName, mag, reserve, grenades, hasKit) {
      setText(els.weaponName, 'weapon', weaponName);
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'reserve', `/ ${reserve}`);
      const line = `3 Frag ${grenades.frag} · 4 Smoke ${grenades.smoke} · 5 Flash ${grenades.flash}${hasKit ? ' · Kit' : ''}`;
      setText(els.grenadeLine, 'grenades', line);
    },
    setTimer(seconds, round, phase) {
      const total = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(total / 60);
      const ss = String(total % 60).padStart(2, '0');
      setText(els.timer, 'timer', `${mm}:${ss}`);
      setText(els.roundLabel, 'round', phase === 'buy' ? `ROUND ${round} OF 12 · BUY` : `ROUND ${round} OF 12`);
    },
    setScores(yard, line) {
      setText(els.scoreYard, 'sy', String(yard));
      setText(els.scoreLine, 'sl', String(line));
    },
    setLocation(name) {
      setText(els.location, 'loc', name);
    },
    killfeedAdd(text, killerTeam) {
      const div = document.createElement('div');
      div.className = `feed-line ${killerTeam}`;
      div.textContent = text;
      els.killfeed.prepend(div);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
    },
    killfeedClear() {
      els.killfeed.replaceChildren();
    },
    radioAdd(text) {
      const div = document.createElement('div');
      div.className = 'radio-line';
      div.textContent = text;
      els.radio.prepend(div);
      while (els.radio.children.length > 3) els.radio.lastChild.remove();
    },
    banner(title, sub, ms = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { els.banner.hidden = true; }, ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      els.banner.hidden = true;
    },
    hitMarker(killed) {
      els.hitmarker.classList.add('on');
      els.hitmarker.style.transform = killed
        ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        els.hitmarker.classList.remove('on');
        els.hitmarker.style.transform = '';
      }, 90);
    },
    flashWhite(strength) {
      els.flash.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { els.flash.style.opacity = '0'; }, 120);
    },
    setProgress(frac, label) {
      els.progress.hidden = false;
      els.progressFill.style.width = `${Math.round(frac * 100)}%`;
      els.progressLabel.textContent = label;
    },
    hideProgress() {
      els.progress.hidden = true;
    },
    setPrompt(text) {
      if (text) {
        els.prompt.hidden = false;
        if (last.prompt !== text) {
          last.prompt = text;
          els.prompt.innerHTML = text;
        }
      } else {
        els.prompt.hidden = true;
      }
    },
    // The buy menu: built once from the armoury, refreshed on open and on each buy.
    buildBuyMenu(onBuy) {
      buyHandler = onBuy;
      els.buyGrid.innerHTML = '';
      BUY_ORDER.forEach((group, gi) => {
        const col = document.createElement('div');
        col.className = 'buy-col';
        const head = document.createElement('div');
        head.className = 'buy-head';
        head.textContent = `${gi + 1} · ${group.group.toUpperCase()}`;
        col.appendChild(head);
        for (const item of group.items) {
          const card = document.createElement('button');
          card.className = 'buy-item';
          card.dataset.item = item.id;
          card.innerHTML = `<b>${item.name}</b><span class="buy-price">$${item.price}</span>`
            + `<span class="buy-hint">${item.hint || ''}</span><span class="buy-state"></span>`;
          card.addEventListener('click', () => buyHandler(item.id));
          col.appendChild(card);
        }
        els.buyGrid.appendChild(col);
      });
    },
    refreshBuy(cash, combatant) {
      setText(els.buyCash, 'buycash', `$${cash}`);
      for (const card of els.buyGrid.querySelectorAll('.buy-item')) {
        const id = card.dataset.item;
        const owned = (id === 'vest' && combatant.armour >= 50)
          || (id === 'helmet' && combatant.helmet)
          || (id === 'kit' && combatant.hasKit)
          || (combatant.def && combatant.def.id === id)
          || (combatant.grenades[id] > 0);
        const afford = combatant.cash >= Number(card.querySelector('.buy-price').textContent.slice(1));
        card.classList.toggle('owned', !!owned);
        card.classList.toggle('cant', !owned && !afford);
        card.querySelector('.buy-state').textContent = owned ? 'Owned' : '';
      }
    },
    showBuyMenu() { els.buymenu.hidden = false; },
    hideBuyMenu() { els.buymenu.hidden = true; },
    isBuyOpen() { return !els.buymenu.hidden; },
    setBuyTimer(seconds) {
      setText(els.buyTimer, 'buytimer', `${Math.max(0, Math.ceil(seconds))} S LEFT`);
    },
    showScoreboard(title, sub, rows) {
      els.scoreTitle.textContent = title;
      els.scoreSub.textContent = sub;
      els.scoreRows.innerHTML = rows;
      els.scoreboard.hidden = false;
    },
    hideScoreboard() { els.scoreboard.hidden = true; },
    showOverlay(mode) {
      const text = COPY[mode];
      els.overlayTitle.textContent = text.title;
      els.overlayCopy.textContent = text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(handler) { els.play.addEventListener('click', handler); },
    drawMinimap,
  };
}
