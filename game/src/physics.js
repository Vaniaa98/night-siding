// Night Siding — the physics every body shares: axis-aligned boxes for the map, a
// vertical capsule (a circle in XZ plus a height) for a person, and ray tests for
// bullets and line of sight. No allocations in the hot paths: the callers pass in
// scratch objects they own. Boxes are plain objects {minX,maxX,minY,maxY,minZ,maxZ}.

// A box centred at (x, y, z) with width w (x), height h (y) and depth d (z).
export function makeBox(x, y, z, w, h, d) {
  return {
    minX: x - w / 2, maxX: x + w / 2,
    minY: y - h / 2, maxY: y + h / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
  };
}

// Does a vertical capsule at (x, y, z) with the given radius and height overlap a box?
// lift keeps the feet and crown out of the horizontal tests, so standing on the floor
// is never read as walking into a wall.
export function capsuleHitsBox(x, y, z, radius, height, lift, box) {
  if (x + radius <= box.minX || x - radius >= box.maxX) return false;
  if (z + radius <= box.minZ || z - radius >= box.maxZ) return false;
  if (y + height - lift <= box.minY || y + lift >= box.maxY) return false;
  return true;
}

export function capsuleHitsAny(x, y, z, radius, height, lift, boxes) {
  for (let i = 0; i < boxes.length; i += 1) {
    if (capsuleHitsBox(x, y, z, radius, height, lift, boxes[i])) return boxes[i];
  }
  return null;
}

// Slab-method ray vs box. Returns the distance along the ray, or Infinity on a miss.
// origin and dir are {x, y, z}; dir must be normalised.
export function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let tMin = 0;
  let tMax = Infinity;
  // X slab
  if (dx === 0) {
    if (ox < box.minX || ox > box.maxX) return Infinity;
  } else {
    let t1 = (box.minX - ox) / dx;
    let t2 = (box.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  // Y slab
  if (dy === 0) {
    if (oy < box.minY || oy > box.maxY) return Infinity;
  } else {
    let t1 = (box.minY - oy) / dy;
    let t2 = (box.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  // Z slab
  if (dz === 0) {
    if (oz < box.minZ || oz > box.maxZ) return Infinity;
  } else {
    let t1 = (box.minZ - oz) / dz;
    let t2 = (box.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

// Nearest box hit along a ray, or Infinity.
export function rayBoxes(ox, oy, oz, dx, dy, dz, boxes, maxT) {
  let best = maxT;
  for (let i = 0; i < boxes.length; i += 1) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (t < best) best = t;
  }
  return best;
}

// Ray vs sphere (a head). Returns the distance, or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Is the straight line from a to b clear of every box? Used for bot sight and for
// deciding whether a radio callout is honest.
export function losClear(ax, ay, az, bx, by, bz, boxes) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const t = rayBoxes(ax, ay, az, dx / dist, dy / dist, dz / dist, boxes, dist);
  return t >= dist;
}
