// Night Siding — one seeded RNG for everything the game decides. The same seed plays
// the same match, which is what makes the screenshot shots deterministic.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// A bell-ish spread for aim error: average of two uniforms, centred on zero.
export function spread2(random, amount) {
  return (random() + random() - 1) * amount;
}
