// Night Siding — every sound is synthesized with WebAudio. No audio files, no
// network: oscillators and one shared noise buffer, shaped by filters and gains.
// The context is created on the first user gesture; in screenshot mode it stays
// silent, which is fine — the shots are pictures, not recordings.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (error) {
      ctx = null;
    }
    return ctx;
  }

  function noise(dur, filterType, freq, gainValue, when = 0) {
    if (!ensure() || ctx.state !== 'running') return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + dur + 0.05);
  }

  function tone(freq, dur, type, gainValue, when = 0, slideTo = 0) {
    if (!ensure() || ctx.state !== 'running') return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    ensure,
    // A gunshot: a sharp noise crack plus a low thump. `far` is a bot firing away.
    shot(kind, far = false) {
      if (far) {
        noise(0.14, 'lowpass', 900, 0.16);
        return;
      }
      if (kind === 'shotgun') {
        noise(0.28, 'lowpass', 1400, 0.85);
        tone(90, 0.22, 'sine', 0.5, 0, 45);
      } else if (kind === 'dmr') {
        noise(0.22, 'bandpass', 2200, 0.7);
        tone(120, 0.16, 'sine', 0.4, 0, 55);
      } else if (kind === 'pistol') {
        noise(0.1, 'bandpass', 2600, 0.55);
        tone(150, 0.08, 'sine', 0.3, 0, 70);
      } else {
        noise(0.09, 'bandpass', 2000, 0.5);
        tone(130, 0.07, 'sine', 0.25, 0, 60);
      }
    },
    dryFire() { tone(1800, 0.03, 'square', 0.12); },
    reload() {
      tone(900, 0.04, 'square', 0.1);
      tone(600, 0.05, 'square', 0.12, 0.25);
      tone(1100, 0.04, 'square', 0.12, 0.55);
    },
    hit() { tone(2400, 0.05, 'sine', 0.22); },
    kill() {
      tone(880, 0.09, 'sine', 0.25);
      tone(1318, 0.14, 'sine', 0.25, 0.09);
    },
    hurt() { noise(0.12, 'lowpass', 500, 0.3); },
    beep() { tone(880, 0.07, 'sine', 0.2); },
    plantTick() { tone(660, 0.05, 'square', 0.12); },
    explosion() {
      noise(1.1, 'lowpass', 500, 0.9);
      tone(55, 0.9, 'sine', 0.7, 0, 28);
    },
    roundWin() {
      tone(523, 0.12, 'sine', 0.25);
      tone(659, 0.12, 'sine', 0.25, 0.12);
      tone(784, 0.22, 'sine', 0.28, 0.24);
    },
    roundLoss() {
      tone(392, 0.16, 'sine', 0.22);
      tone(311, 0.26, 'sine', 0.22, 0.16);
    },
    buy() { tone(1200, 0.05, 'sine', 0.18); },
    footstep() { noise(0.05, 'lowpass', 400, 0.07); },
    grenadeThrow() { noise(0.08, 'bandpass', 1200, 0.15); },
  };
}
