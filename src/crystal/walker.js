// THE WALKER for test B2's TARGET action (tools/nc/craftax_movemap.py walker_target, one view at a time): the first press toward the
// target tile. A shortest path over (position, facing) on the open tiles of the 9 × 11 view: a press toward d turns you to d and steps if
// that tile is open; the goal is any open neighbor of the target, facing it; there, DO (5). Toward an explore region (where 99..106: N,
// NE, E, SE, S, SW, W, NW) the goal is any open tile on that edge of the view, and once there it keeps pressing that way.
//   where: 0..106 (the view row-major, then the 8 regions); tiles: Uint8Array(99) coarse classes (frame.js viewCoarse, 1 = open);
//   fac: the facing now, 1..4 (Craftax LEFT, RIGHT, UP, DOWN). -> a Craftax action (1..5).
// Checked against the Python walker press for press (walker-check.mjs).

const H = 9, W = 11, OPEN = 1, INF = 1e6, N_ITER = 48, DO = 5;
const DY = [0, 0, -1, 1], DX = [-1, 1, 0, 0];                                  // f / d index 0..3 = LEFT, RIGHT, UP, DOWN
const NY = [-1, -1, 0, 1, 1, 1, 0, -1], NX = [0, 1, 1, 1, 0, -1, -1, -1];      // the explore regions' sides
const WAY = [3, 2, 2, 4, 4, 1, 1, 3];                                          // N, NE, E, SE, S, SW, W, NW -> UP / RIGHT / DOWN / LEFT

export function walkerTarget(where, tiles, fac) {
  const open = new Uint8Array(H * W);
  for (let k = 0; k < H * W; k++) open[k] = tiles[k] === OPEN ? 1 : 0;
  open[4 * W + 5] = 1;                                                         // the player's own tile is always standable
  const goal = new Uint8Array(4 * H * W), ex = where >= 99;
  if (!ex) {
    const ty = Math.floor(where / W), tx = where % W;
    for (let f = 0; f < 4; f++)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          goal[(f * H + y) * W + x] = y + DY[f] === ty && x + DX[f] === tx && open[y * W + x] && !(y === ty && x === tx) ? 1 : 0;
  } else {
    const k = where - 99;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let e = (NY[k] < 0 && y === 0) || (NY[k] > 0 && y === H - 1) || (NX[k] < 0 && x === 0) || (NX[k] > 0 && x === W - 1);
        if (NY[k] === 0 && (y === 0 || y === H - 1)) e = false;
        if (NX[k] === 0 && (x === 0 || x === W - 1)) e = false;
        if (e && open[y * W + x]) for (let f = 0; f < 4; f++) goal[(f * H + y) * W + x] = 1;
      }
  }
  // value iteration, as the batched Python does it (N_ITER rounds; a press costs 1, a blocked press turns you in place)
  let dist = new Float64Array(4 * H * W);
  for (let i = 0; i < dist.length; i++) dist[i] = goal[i] ? 0 : INF;
  for (let it = 0; it < N_ITER; it++) {
    const best = new Float64Array(H * W).fill(INF);
    for (let d = 0; d < 4; d++)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const y1 = y + DY[d], x1 = x + DX[d], inb = y1 >= 0 && y1 < H && x1 >= 0 && x1 < W;
          const can = inb && open[y1 * W + x1];
          const nxt = can ? dist[(d * H + y1) * W + x1] : dist[(d * H + y) * W + x];
          if (nxt + 1 < best[y * W + x]) best[y * W + x] = nxt + 1;
        }
    const nd = new Float64Array(dist.length);
    for (let f = 0; f < 4; f++) for (let k = 0; k < H * W; k++) nd[f * H * W + k] = Math.min(dist[f * H * W + k], best[k]);
    dist = nd;
  }
  const f0 = Math.min(3, Math.max(0, fac - 1));
  let a;
  if (dist[(f0 * H + 4) * W + 5] === 0) a = DO;
  else {
    let bi = 0, bv = Infinity;
    for (let d = 0; d < 4; d++) {
      const y1 = 4 + DY[d], x1 = 5 + DX[d];
      const v = open[y1 * W + x1] ? dist[(d * H + y1) * W + x1] : dist[(d * H + 4) * W + 5];
      if (v < bv) { bv = v; bi = d; }
    }
    a = bv >= INF / 2 ? DO : bi + 1;
  }
  return ex && a === DO ? WAY[where - 99] : a;
}
