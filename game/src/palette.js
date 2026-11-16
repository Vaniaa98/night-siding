// Night Siding — the look plan, in one place. One palette for the whole game: a cold
// night-blue world lit by sodium-orange lamps, with the two teams in orange and blue.
// Every colour in the game is one of these names; index.html uses the same names as CSS.
export const PALETTE = {
  canvas: '#0d1420', // night sky / fog
  ground: '#161c26', // ballast gravel
  surface: '#1e2634', // walls, sheds, containers
  hairline: '#2b3547', // crates, beams, rails
  steel: '#5a6a7d', // rails, gantry steel
  rust: '#8a4a28', // boxcars, rusted metal
  rustDark: '#5e3220',
  teal: '#1f4d4a', // painted containers
  ink: '#e9e4d6', // warm off-white (HUD text, lights)
  muted: '#8b96a5', // dim text
  accent: '#ff9a2e', // sodium orange — lamps, YARD team, muzzle flash
  accentSoft: '#c96a1e',
  yard: '#ff8c1a', // YARD team
  line: '#3f8cff', // LINE team
  danger: '#e5484d', // low health, round lost
  money: '#f0c040', // cash
};

export function shade(name) {
  return PALETTE[name];
}
