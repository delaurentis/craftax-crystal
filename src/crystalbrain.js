// The crystal's "brain", in pixel art (Pete, notes 7520 + 8628): shown instead of brain.js whenever the bot is a crystal.
// What really goes in and comes out each step (crystal-worker.js view()): on the left the map of
// the world (the frame the crystal sees, binned 64 × 64) and the map of its memory (1,024 units, 4-bit levels); in the middle the glass,
// its 8 wafers, light from the two maps bent at each wafer toward the answer; on the right the action map (the action head's cell
// powers, every cell belonging to an action) and the memory it writes back, which loops round underneath to the memory going in.
// Point at the action map and it says which action that is and its share. Calm on purpose: a faint steady light, one pulse a decision.
//   same interface as brain.js: crystalBrain.setNames(meta.actions); .el; .clear; .body(state); .update(world.bot_reply)
import { iconURL, toolPixels } from "craftax-3d/plugin";
const W = 248, H = 150, LW = 124, LH = 75, S = W / LW;                 // the panel's size; the art's own pixels (2 × 2 on screen)
const BG = "#05060b";
// one scale for the light, the crystal's 617 nm red: near black at rest, through deep and bright red to a warm white at full
const RED = [[0, 14, 4, 8], [0.3, 90, 14, 22], [0.6, 220, 40, 40], [0.85, 255, 120, 90], [1, 255, 225, 200]];
// in the game's phosphor look (body.phosphor) the same scale in its green (brain.js's), and the light inside the glass green, not a
// rainbow, overlapping rays adding up to white (Pete 4d22)
const GREEN = [[0, 4, 18, 8], [0.3, 12, 85, 32], [0.55, 30, 170, 70], [0.8, 80, 255, 120], [1, 225, 255, 225]];
let phos = false, RAMP = RED;
const pc = (red, green) => (phos ? green : red);                        // a colour for the look we're in
const heat = (v) => {
  v = Math.max(0, Math.min(1, v));
  let i = 1; while (i < RAMP.length - 1 && v > RAMP[i][0]) i++;
  const [a, b] = [RAMP[i - 1], RAMP[i]], u = (v - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map((j) => Math.round(a[j] + (b[j] - a[j]) * u));
};
// the four maps, in panel pixels (one map cell a panel pixel): world and memory in on the left, actions and memory out on the right
const MAP = { world: { x: 4, y: 14, s: 64 }, memIn: { x: 20, y: 98, s: 32 }, out: { x: 180, y: 14, s: 64 }, memOut: { x: 196, y: 98, s: 32 } };
// the glass block in art pixels: its front face, how far the top and side lean back (a 3/4 view), its wafers
const X0 = 44, X1 = 80, Y0 = 13, Y1 = 46, DX = 5, DY = -5, WAFERS = 8, YM = Math.round((Y0 + Y1) / 2);
const waferX = (i) => X0 + 3 + Math.round(((X1 - X0 - 6) * i) / (WAFERS - 1));
// a split crystal's stages (tools/nc/craftax_split.py): 1-2 its two input heads side by side (the map above, the memory below, an air slot
// between), 3-4 the shared middle where the map and the memory mix, 5-6 its two output heads (the actions above, the memory below)
const STAGES = 6, stageX = (k) => X0 + ((X1 - X0) * k) / STAGES;          // stage k spans stageX(k)..stageX(k + 1)
const MIX0 = stageX(2), MIX1 = stageX(4);

const SAY = { NOOP: "wait", UP: "walk north", DOWN: "walk south", LEFT: "walk west", RIGHT: "walk east", DESCEND: "ladder down", ASCEND: "ladder up" };
const say = (a) => (a === undefined ? "walk to a target" : SAY[a] || a.toLowerCase().replace(/_/g, " "));   // (index 43 on a B2 crystal: TARGET)

const el = document.createElement("canvas");
let DPR = 2;
el.width = W * DPR; el.height = H * DPR;
el.className = "brain";
Object.assign(el.style, { width: W + "px", height: H + "px", display: "block", margin: "6px 0 2px" });
const box = document.createElement("div");
box.className = "brain-box";
box.append(el);
// SUBTRACT THE USUAL LIGHT (Pete 778e, on by default, only with the brain expanded): much of the action map lights the same every step,
// a steady pattern each action's own gain cancels; ticked, each cell shows its light now against its running average (the last ~20
// decisions, in e-folds), so what lights up is what changed this decision
const BASE_KEY = "crystalBrainBaseline";
let baseOn = true; try { baseOn = localStorage.getItem(BASE_KEY) !== "0"; } catch {}
let base = null;                                                        // per cell: the running mean of its log light
let shown = null;                                                       // per cell: how lit the action map draws it, 0..1 (the rays aim by it, Pete 38d0)
const baseRow = document.createElement("label");
baseRow.className = "brain-opt";
baseRow.innerHTML = `<input type="checkbox"> Show changes`;   // (was "Subtract baseline": Pete, it reads brighter; its look: index.html #botpanel .brain-opt; its place: net.ts, under the expanded brain)
const baseBox = baseRow.querySelector("input"); baseBox.checked = baseOn;
baseBox.onchange = () => { baseOn = baseBox.checked; try { localStorage.setItem(BASE_KEY, baseOn ? "1" : "0"); } catch {} if (maps) { paintMaps(maps); makeRays(); } };
const showOpt = () => { baseRow.style.display = el.closest("#botpanel.big") ? "flex" : "none"; };
const g = el.getContext("2d");
const art = document.createElement("canvas");                           // the glass and the light at their own size, scaled up unsmoothed
art.width = LW; art.height = LH;
const a = art.getContext("2d");
const rgba = (c, k = 1) => `rgba(${c[0]},${c[1]},${c[2]},${k})`;
// EXPANDED (Pete ecab, 5b63): the glass and its light drawn R × finer (art pixels a third the size), the world map at its full 192 × 192,
// and more rays. R: fine pixels to an art pixel; BIG: the panel expanded
let R = 1, BIG = false;
// in fine pixels (whole ones): a rect, a pixel
const fr = (x, y, w, h, c, k = 1) => { a.fillStyle = rgba(c, k); a.fillRect(x, y, w, h); };
const fp = (x, y, c, k = 1) => fr(x, y, 1, 1, c, k);
// in art pixels, scaled to fine ones (a 1-wide line stays at least one fine pixel)
const rect = (x, y, w, h, c, k = 1) => fr(Math.round(x * R), Math.round(y * R), Math.max(1, Math.round(w * R)), Math.max(1, Math.round(h * R)), c, k);
let glowPx = 0;                                                         // a soft halo round each pixel, this much of its light
// a pixel line (Bresenham); c: a colour, or a function of x giving one (the rainbow inside the glass)
function line(x0, y0, x1, y1, c, k) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  const fn = typeof c === "function";
  if (!fn) a.fillStyle = rgba(c, k);
  for (;;) {
    const cc = fn ? c(x0) : null;
    if (cc) a.fillStyle = rgba(cc, k);
    if (!fn || cc) {                                                       // (a function's null: no pixel there)
      a.fillRect(x0, y0, 1, 1);
      if (glowPx) { a.fillStyle = rgba(cc || c, k * glowPx); a.fillRect(x0 - 1, y0, 1, 1); a.fillRect(x0 + 1, y0, 1, 1); a.fillRect(x0, y0 - 1, 1, 1); a.fillRect(x0, y0 + 1, 1, 1); }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

// each map's picture: a small canvas a cell a pixel, drawn into the panel unsmoothed
const mapCv = Object.fromEntries(Object.keys(MAP).map((k) => { const c = document.createElement("canvas"); c.width = c.height = 1; return [k, c]; }));
function paint(k, n, val) {                                              // val(i) → [r, g, b]
  const c = mapCv[k]; if (c.width !== n) { c.width = c.height = n; }
  const x = c.getContext("2d"), im = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const [r, gg, b] = val(i); im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
}

let allowed = null;                                                     // the actions the bot may pick ("only useful actions" on), else null: all
let names = [], probs = [], maps = null, boxes = [], pulseT = -1e9, chosen = -1, lastReply = null, running = false, hover = null;
let rays = [];
// the action map shown cropped to the cells the actions read, a cell of dark round them (Pete eb3d): a square, in map cells
let crop = { x: 0, y: 0, n: 64 };
function cropTo(bx, n) {
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (const b of bx) if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  if (x1 < 0) return { x: 0, y: 0, n };
  const size = Math.min(n, Math.max(x1 - x0, y1 - y0) + 3);
  const at = (lo, hi) => Math.max(0, Math.min(n - size, Math.round((lo + hi + 1 - size) / 2)));
  return { x: at(x0, x1), y: at(y0, y1), n: size };
}
let dead = false;

// where an action sits on the action map (its cells' bounding box, map cells), from the worker's act map
function actionBoxes(act, n) {
  const b = [];
  for (let i = 0; i < act.length; i++) {
    const k = act[i]; if (k < 0) continue;
    const x = i % n, y = Math.floor(i / n), q = (b[k] ??= { x0: x, y0: y, x1: x, y1: y });
    q.x0 = Math.min(q.x0, x); q.y0 = Math.min(q.y0, y); q.x1 = Math.max(q.x1, x); q.y1 = Math.max(q.y1, y);
  }
  return b;
}
// the light's paths for this decision, worked back from what really went in and came out (Pete 42d1): each ray lands on an output cell
// drawn by how bright it came out (24 on the action map, 6 on the memory units that changed most), starts from an input row drawn by how
// much light that row of the world map sends (or, from the memory, how much that row of units changed), and is bent at every layer by
// the input along its row: a different frame bends the light differently. A ray's brightness is its source's light times its target's;
// the stronger ones arrive a beat sooner. In art pixels: [[x, y], ...]
function makeRays() {
  rays = [];
  const n = maps ? Math.round(Math.sqrt(maps.out.length)) : 64, s = MAP.out.s / crop.n, split = !!maps?.split;
  let seed = (lastReply?.probs?.[0] || 0.37) * 1000;
  if (maps) for (let i = 0; i < maps.world.length; i += 97) seed += maps.world[i] * (i % 13);
  const hash = (k) => { const v = Math.sin(seed * 0.013 + k * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const pick = (w, k) => { let sum = 0; for (const x of w) sum += x; let u = hash(k) * sum, j = 0; while (j < w.length - 1 && (u -= w[j]) > 0) j++; return j; };
  // the inputs, row by row: the world map's light (0..1 a cell), the memory's levels going in and how much each unit changed
  const wn = maps ? Math.round(Math.sqrt(maps.world.length)) : 64, mn = maps ? Math.ceil(Math.sqrt(maps.memIn.length)) : 32;
  const wv = (r, c) => (maps ? maps.world[r * wn + c] / 255 : 0.3);
  const mv = (r, c) => { const i = r * mn + c; return maps && i < maps.memIn.length ? maps.memIn[i] / 15 : 0.3; };
  const dv = (i) => (maps && i < maps.memIn.length ? Math.abs(maps.memOut[i] - maps.memIn[i]) / 15 : 0);
  const rowSum = (f, N) => Array.from({ length: N }, (_, r) => { let t = 0; for (let c = 0; c < N; c++) t += f(r, c); return t / N; });
  const wRow = rowSum(wv, wn), mChange = rowSum((r, c) => dv(r * mn + c) + 0.15 * mv(r, c), mn);
  const wMax = Math.max(1e-6, ...wRow), mMax = Math.max(1e-6, ...mChange);
  // the outputs: action cells by brightness (the chosen action's counting extra); memory units by how much they changed
  const aim = [];                                                       // [action, the cell's row, its light 0..1]
  if (maps) {
    const cells = [], w = [], lit = (i) => (shown && shown.length === maps.out.length ? shown[i] : (maps.out[i] / 255) ** 2);   // as the map shows it: baseline subtracted when ticked
    for (let i = 0; i < maps.out.length; i++) { const k = maps.act[i]; if (k < 0 || (allowed && !allowed[k])) continue; cells.push(i); w.push(lit(i) ** 1.5 + (k === chosen ? 0.05 : 0.002)); }
    for (let r = 0; r < (BIG ? 64 : 24) && cells.length; r++) { const i = cells[pick(w, 200 + r)]; aim.push([maps.act[i], Math.floor(i / n), Math.sqrt(lit(i))]); }
  } else for (const [i] of probs.map((p, i) => [i, p]).sort((x, y) => y[1] - x[1]).slice(0, 3)) { const b = boxes[i]; aim.push([i, b ? (b.y0 + b.y1) / 2 : n / 2, 0.5]); }
  const memAim = [];                                                    // [unit row, its change 0..1]
  const unitW = Array.from({ length: mn }, (_, r) => { let t = 0; for (let c = 0; c < mn; c++) t += dv(r * mn + c); return t / mn + 0.01; });
  const uMax = Math.max(...unitW);
  for (let r = 0; r < (BIG ? 16 : 6); r++) { const row = pick(unitW, 1000 + r); memAim.push([row, unitW[row] / uMax]); }
  // a ray's bends: at layer j it is pushed up or down by the input on its row there (a light cell up, a dark one down), less towards the exit
  const bendOf = (fromMem, row) => (j, m) => {
    const N = fromMem ? mn : wn, c = Math.min(N - 1, Math.floor(((j + 0.5) / m) * N)), v = fromMem ? mv(row, c) : wv(row, c);
    return (v - (fromMem ? 0.4 : 0.25)) * 9;
  };
  const clampY = (y, lo = Y0 + 2, hi = Y1 - 2) => Math.max(lo, Math.min(hi, y));
  const half = (top) => (top ? [Y0 + 2, YM - 2] : [YM + 2, Y1 - 2]);
  // split: each ray keeps to its input head's half through stages 1-2, crosses the whole glass in 3-4 (where the map and the memory mix:
  // its path there set by both its source and its target), then keeps to its output head's half in 5-6
  // (f: where on its source map the ray starts, 0 top .. 1 bottom)
  // (ft: a memory ray's place on the memory map, 0 top .. 1 bottom: it leaves the glass from the lower part of its side, never right at
  // the bottom edge, Pete 99b1; action rays leave level with where they land)
  const path = (sx, sy, f, ex, ey, bend, fromTop, toTop, mixK, ft = null) => {
    const pts = [[sx, sy]];
    if (split) {
      const [a0, a1] = half(fromTop), [b0, b1] = half(toTop), yin = a0 + f * (a1 - a0);
      const yo = ft === null ? clampY(ey, b0, b1) : b0 + (0.1 + 0.55 * ft) * (b1 - b0);
      // (every layer moves it, Pete 99c9: at each plate it jumps to a new place in its half, partly where it was, partly fresh, pushed by
      // its row; only the exit is fixed, so the out half re-sorts layer by layer instead of arriving already split)
      const fr = (k) => (Math.sin((mixK + 1) * (k + 3) * 91.7) * 43758.5) % 1, at = (k, prev, lo, hi, keep) => clampY(lo + (keep * (prev - lo) / (hi - lo || 1) + (1 - keep) * Math.abs(fr(k))) * (hi - lo) + bend(k, 6), lo, hi);
      let y = clampY(yin, a0, a1); pts.push([X0, y]);
      y = at(0, y, a0, a1, 0.55); pts.push([stageX(1), y]); y = at(1, y, a0, a1, 0.35); pts.push([stageX(2), y]);
      pts.push([stageX(2.6), clampY(Y0 + 2 + mixK * (Y1 - Y0 - 4) + bend(2, 6))]); pts.push([stageX(3.3), clampY(Y0 + 2 + (1 - mixK) * (Y1 - Y0 - 4) + bend(3, 6))]);
      y = at(4, b0 + Math.abs(fr(9)) * (b1 - b0), b0, b1, 0); pts.push([stageX(4), y]);
      y = at(5, 0.5 * (y + yo), b0, b1, 0.5); pts.push([stageX(5), y]);
      pts.push([X1, yo]);
    } else {
      const yin = clampY(Y0 + f * (Y1 - Y0));
      pts.push([X0, yin]);
      const yo = ft === null ? clampY(ey) : Y0 + (0.55 + 0.25 * ft) * (Y1 - Y0);
      for (let w = 0; w < WAFERS; w++) { const u = (w + 1) / (WAFERS + 1); pts.push([waferX(w), clampY(yin + (yo - yin) * u + bend(w, WAFERS) * (1 - u))]); }
      pts.push([X1, yo]);
    }
    // the light runs through the block as it sits, a plane halfway back: inside, every point set back by half the block's depth (up and
    // right, along its receding edges), so it goes in through the hidden left face, crosses behind the front face and leaves through the
    // slanted right face, the outside legs turning there where they meet the glass (Pete c2c8)
    // (set back but not up as far: the whole bundle 2 lower, so it spans the glass top to bottom instead of grazing its top edge, Pete 3230)
    for (let k = 1; k < pts.length; k++) { pts[k][0] += DX / 2; pts[k][1] += DY / 2 + 2; }
    pts.push([ex, ey]);
    return pts;
  };
  const wl = MAP.world, ml = MAP.memIn, ol = MAP.out, mo = MAP.memOut;
  const fromMap = (wl.x + wl.s) / S + 1, fromMem = (ml.x + ml.s) / S + 1;
  const mapRow = (k, near) => pick(wRow.map((v, r) => (v / wMax) ** 2 + 0.02 + 0.3 * Math.exp(-(((r / wn - near) * 4) ** 2))), k);
  const memRow = (k) => pick(mChange.map((v) => (v / mMax) ** 2 + 0.02), k);
  const add = (r, src, tgt) => { r.k = 0.35 + 0.65 * Math.sqrt(Math.max(0, Math.min(1, src * tgt))); r.delay = 0.18 * (1 - r.k); rays.push(r); };
  // (split: a third of the action rays start from the memory, and half the memory rays from the map: both inputs reach both outputs)
  aim.forEach(([act, row, lit], i) => {
    const mem = split && i % 3 === 2, ty = (ol.y + (row - crop.y + 0.5) * s) / S;
    const sr = mem ? memRow(500 + i) : mapRow(500 + i, row / n), sy = mem ? (ml.y + ((sr + 0.5) * ml.s) / mn) / S : (wl.y + ((sr + 0.5) * wl.s) / wn) / S;
    const srcW = mem ? mChange[sr] / mMax : wRow[sr] / wMax, mixK = (srcW * 0.6 + (row / n) * 0.4 + hash(600 + i) * 0.3) % 1;
    add({ pts: path(mem ? fromMem : fromMap, sy, (sr + 0.5) / (mem ? mn : wn), ol.x / S - 1, ty, bendOf(mem, sr), !mem, true, mixK), act: true, hit: act, phase: (srcW * 300 + row * 23) % 360 }, srcW, lit);
  });
  memAim.forEach(([row, ch], i) => {
    const map = split && i % 2 === 1, ty = (mo.y + ((row + 0.5) * mo.s) / mn) / S;
    const sr = map ? mapRow(700 + i, row / mn) : memRow(700 + i), sy = map ? (wl.y + ((sr + 0.5) * wl.s) / wn) / S : (ml.y + ((sr + 0.5) * ml.s) / mn) / S;
    const srcW = map ? wRow[sr] / wMax : mChange[sr] / mMax, mixK = (srcW * 0.5 + ch * 0.5 + hash(800 + i) * 0.3) % 1;
    add({ pts: path(map ? fromMap : fromMem, sy, (sr + 0.5) / (map ? wn : mn), mo.x / S - 1, ty, bendOf(!map, sr), map, false, mixK, (row + 0.5) / mn), act: false, phase: (srcW * 300 + row * 41) % 360 }, srcW, ch);
  });
  rays.forEach((r) => { let L = 0; r.len = [0]; for (let k = 1; k < r.pts.length; k++) r.len.push(L += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1])); });
}
// a ray drawn up to a fraction of its length
function drawRay(r, from, to, c, k) {
  const L = r.len[r.len.length - 1], A = from * L, B = to * L;
  for (let i = 1; i < r.pts.length; i++) {
    const l0 = r.len[i - 1], l1 = r.len[i]; if (l1 < A || l0 > B) continue;
    const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i], u0 = Math.max(0, (A - l0) / (l1 - l0 || 1)), u1 = Math.min(1, (B - l0) / (l1 - l0 || 1));
    line((x0 + (x1 - x0) * u0) * R, (y0 + (y1 - y0) * u0) * R, (x0 + (x1 - x0) * u1) * R, (y0 + (y1 - y0) * u1) * R, c, k);   // (in fine pixels)
  }
}

// the light: the crystal's red outside the glass; inside it, its phase shifted by the plates, drawn as a rainbow running along each ray
// (each ray its own offset)
const hsl = (h, s, l) => {
  const f = (n) => { const k = (n + h / 30) % 12, q = s * Math.min(l, 1 - l); return Math.round(255 * (l - q * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
};
// (the rainbow is drawn over the glass, bright, not seen through it: Pete 6d85; `inner`: the rainbow alone, nothing outside it)
function tint(r, v, inner = false) {
  // (red up to the glass, the rainbow all through it, red again once it has left the last layer: Pete cc6a, 1f8f)
  // (the colours start where the light crosses the glass's left edge as you see it, the front face, not the plane half the block's depth back: Pete 02c4)
  const red = inner ? null : heat(v), lo = X0, hi = X1 + DX / 2;
  return (xf) => { const x = xf / R; return x < lo || x > hi ? red : inner ? (phos ? [110, 255, 140] : hsl((r.phase + (x - lo) * 22) % 360, 0.9, v)) : null; };
}

// the glass: dark see-through faces, pale edges, a lighter top; the wafers as thin lines through it
function glass(t) {
  // (blue-white glass; in phosphor a white with a tinge of green, Pete 9409)
  const edge = pc([150, 190, 220], [190, 225, 195]), top = pc([40, 60, 84], [36, 66, 44]), side = pc([18, 28, 42], [16, 32, 20]), front = pc([24, 36, 54], [20, 40, 26]);
  // (in fine pixels, so expanded the edges, walls and glint are R × finer; the outline T fine pixels thick)
  const x0 = X0 * R, x1 = X1 * R, y0 = Y0 * R, y1 = Y1 * R, dx = DX * R, dy = DY * R, ym = YM * R, T = R > 1 ? 2 : 1;
  for (let y = y0 + dy; y < y0; y++) fr(x0 + Math.round(((y0 - y) * dx) / -dy), y, x1 - x0, 1, top, 0.85);
  for (let x = 0; x < dx; x++) { const yt = y0 + Math.round((x * dy) / dx), yb = y1 + Math.round((x * dy) / dx); fr(x1 + x, yt, 1, yb - yt, side, 0.9); }
  fr(x0, y0, x1 - x0, y1 - y0, front, 0.55);                             // see-through: the light inside shows
  const xs = (maps?.split ? Array.from({ length: STAGES - 1 }, (_, k) => stageX(k + 1)) : Array.from({ length: WAFERS }, (_, i) => waferX(i))).map((x) => Math.round(x * R));
  for (const x of xs) {
    fr(x, y0 + T, 1, y1 - y0 - 2 * T, pc([60, 86, 120], [70, 115, 80]), 0.45);
    for (let k = 1; k < dx; k++) fp(x + k, y0 + Math.round((k * dy) / dx), pc([90, 120, 160], [110, 160, 120]), 0.6);
  }
  if (maps?.split) {                                                     // the air slots between the two heads, in and out (not through the mix)
    fr(x0 + T, ym, Math.round(MIX0 * R) - x0 - T, T, edge, 0.55);
    fr(Math.round(MIX1 * R) + 1, ym, x1 - Math.round(MIX1 * R) - 1, T, edge, 0.55);
  }
  fr(x0, y0, x1 - x0 + T, T, edge); fr(x0, y1, x1 - x0 + T, T, edge, 0.7);
  fr(x0, y0, T, y1 - y0, edge, 0.8); fr(x1, y0, T, y1 - y0, edge);
  fr(x0 + dx, y0 + dy, x1 - x0 + T, T, edge, 0.8); fr(x1 + dx, y0 + dy, T, y1 - y0, edge, 0.6);
  for (let k = 1; k < dx; k++) { const y = y0 + Math.round((k * dy) / dx); fr(x0 + k, y, T, T, edge, 0.8); fr(x1 + k, y, T, T, edge); fr(x1 + k, y1 + Math.round((k * dy) / dx), T, T, edge, 0.6); }
  const u = (t * 0.05) % 1, k = Math.sin(u * Math.PI) ** 4;               // one glint drifting along the top edge
  if (k > 0.05) { const x = x0 + 2 * R + Math.round(u * (x1 - x0 - 4 * R)), c = pc([235, 245, 255], [235, 255, 238]); fr(x - R, y0, 3 * R, T, c, 0.4 * k); fr(x, y0, R, T, c, 0.9 * k); }
}

function frame(now) {
  if (!el.isConnected) { running = false; return; }
  requestAnimationFrame(frame);
  showOpt();
  const t = now / 1000, since = t - pulseT;
  const big = (el.clientWidth || W) / W > 1.5;
  if (big !== BIG) { BIG = big; R = big ? 3 : 1; art.width = LW * R; art.height = LH * R; if (maps) { paintMaps(maps); makeRays(); } }
  const ph = !!document.body?.classList.contains("phosphor");
  if (ph !== phos) { phos = ph; RAMP = ph ? GREEN : RED; if (maps) paintMaps(maps); }   // the look changed: the maps in its colours
  const want = Math.max(2, Math.min(8, Math.ceil(((el.clientWidth || W) / W) * (devicePixelRatio || 1))));
  if (want !== DPR) { DPR = want; el.width = W * DPR; el.height = H * DPR; }
  // the art: the memory loop underneath, the steady light, the pulse, the glass over it
  a.clearRect(0, 0, art.width, art.height);
  if (!crystalBrain.clear) { a.fillStyle = BG; a.fillRect(0, 0, art.width, art.height); }
  const fade = since < 0.8 ? 1 : Math.max(0, 1 - (since - 0.8) / 0.6), head = Math.min(1, since / 0.8);
  const loopK = 0.12 + 0.3 * Math.max(0, Math.min(1, (since - 0.7) / 0.3)) * fade, lc = heat(0.5);
  const lo = MAP.memOut, li = MAP.memIn, ly = Math.round((li.y + li.s) / S) + 5;
  rect(Math.round((lo.x + lo.s / 2) / S), Math.round((lo.y + lo.s) / S) + 1, 1, ly - Math.round((lo.y + lo.s) / S), lc, loopK);
  rect(Math.round((li.x + li.s / 2) / S), ly, Math.round((lo.x - li.x) / S) + 1, 1, lc, loopK);
  rect(Math.round((li.x + li.s / 2) / S), Math.round((li.y + li.s) / S) + 1, 1, ly - Math.round((li.y + li.s) / S), lc, loopK);
  const hd = (r) => Math.min(1, Math.max(0, (since - r.delay) / 0.8));     // each ray's pulse, the strong ones a beat ahead
  for (const r of rays) drawRay(r, 0, 1, tint(r, r.act && r.hit === chosen ? 0.55 : 0.4), (r.act ? 0.14 : 0.12) * (0.5 + 0.5 * r.k));
  if (since < 1.4) for (const r of rays) drawRay(r, Math.max(0, hd(r) - 0.25), hd(r), tint(r, 0.85), 0.7 * fade * r.k);
  glass(t);
  // the phase-shifted light, bright inside, only while a pulse is going through (Pete 09f2): between pulses the glass is dark
  // added as light, softer, with a little glow, so where rays cross it's brighter (Pete cc6a)
  if (since < 1.4) {
    a.globalCompositeOperation = "lighter"; glowPx = BIG ? 0 : 0.3;   // (expanded: the many fine rays glow by overlapping, no halo: cheaper)
    for (const r of rays) drawRay(r, Math.max(0, hd(r) - 0.3), hd(r), tint(r, 0.5, true), 0.5 * fade * r.k);
    a.globalCompositeOperation = "source-over"; glowPx = 0;
  }
  if (maps?.split) {                                                     // stages 3-4: a soft glow where the two mix, brighter as the pulse goes through
    const k = 0.06 + 0.16 * fade * Math.max(0, 1 - Math.abs(head - 0.5) / 0.25);   // (the glass is about the middle of each ray)
    rect(Math.round(MIX0) + 1, Y0 + 1, Math.round(MIX1 - MIX0) - 1, Y1 - Y0 - 1, pc([200, 90, 170], [90, 220, 130]), k);
  }
  const walls = maps?.split ? Array.from({ length: STAGES - 1 }, (_, k) => Math.round(stageX(k + 1))) : Array.from({ length: WAFERS }, (_, i) => waferX(i));
  for (const x of walls) {                                                // the walls catch the pulse where it bends
    const u = head - (x - X0) / (LW * 0.75);
    if (since < 1 && u > 0 && u < 0.2) rect(x, Y0 + 1, 1, Y1 - Y0 - 2, heat(0.9), (1 - u / 0.2) * 0.5 * fade);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, el.width, el.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(art, 0, 0, el.width, el.height);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  // the maps, in dark frames, each with its name
  g.font = `8px 'Craftax Pixel', 'Courier New', monospace`; g.textBaseline = "alphabetic";   // (the pixel font: Pete 762f)
  const label = { world: "world", memIn: "memory", out: "actions", memOut: "memory" };
  for (const [k, m] of Object.entries(MAP)) {
    g.fillStyle = pc("#464a56", "#3e5444"); g.fillRect(m.x - 2, m.y - 2, m.s + 4, m.s + 4);
    g.fillStyle = "#08080c"; g.fillRect(m.x - 1, m.y - 1, m.s + 2, m.s + 2);
    if (maps) g.drawImage(mapCv[k], m.x, m.y, m.s, m.s);
    g.fillStyle = pc("rgba(200,170,170,.75)", "rgba(150,210,160,.75)"); g.textAlign = k === "out" || k === "memOut" ? "right" : "left";
    g.fillText(label[k], k === "out" || k === "memOut" ? m.x + m.s + 2 : m.x - 2, m.y - 4);
  }
  if (maps?.split) {                                                    // what each part of the glass does
    g.font = `8px 'Craftax Pixel', 'Courier New', monospace`; g.textAlign = "center"; g.fillStyle = pc("rgba(220,170,210,.85)", "rgba(170,240,180,.85)");
    g.fillText("mix", ((MIX0 + MIX1) / 2 + DX / 2) * S, (Y0 + DY) * S - 3);
    g.fillStyle = pc("rgba(200,170,170,.6)", "rgba(150,210,160,.6)");
    g.fillText("in", ((X0 + MIX0) / 2 + DX / 2) * S, (Y0 + DY) * S - 3); g.fillText("out", ((MIX1 + X1) / 2 + DX / 2) * S, (Y0 + DY) * S - 3);
  }
  // the chosen action's cells, ringed once the light lands; the one pointed at, outlined
  const s = MAP.out.s / crop.n;
  const outline = (b, c) => { g.strokeStyle = c; g.lineWidth = 1; g.strokeRect(MAP.out.x + (b.x0 - crop.x) * s - 1.5, MAP.out.y + (b.y0 - crop.y) * s - 1.5, (b.x1 - b.x0 + 1) * s + 3, (b.y1 - b.y0 + 1) * s + 3); };
  if (boxes[chosen] && since > 0.6) outline(boxes[chosen], `rgba(${pc("255,220,200", "200,255,210")},${(0.35 + 0.5 * Math.max(0, 1 - (since - 0.6) / 0.8)).toFixed(3)})`);
  if (hover && hover.act >= 0 && boxes[hover.act]) {
    // expanded: what that action is, as a picture (no white box over it then); else, or with no picture, the white box
    if (!((el.clientWidth || W) / W > 1.5 && drawIcon(names[hover.act], boxes[hover.act], s))) outline(boxes[hover.act], "rgba(255,255,255,.95)");
  }
  // the words, under the glass: what it chose (the top three), or what the cell pointed at means
  const ts = Math.pow(Math.max(1, (el.clientWidth || W) / W), -0.6), cx = (MAP.memIn.x + MAP.memIn.s + MAP.memOut.x) / 2;
  g.textAlign = "center"; g.textBaseline = "middle";
  // [words, bold, an arrow's pixels (a walk: the arrow, then only its share)]
  const line = (i, p, bold) => (/^(UP|DOWN|LEFT|RIGHT)$/.test(names[i]) ? [`${Math.round(p * 100)}%`, bold, BITS[names[i]]] : [`${say(names[i])} ${Math.round(p * 100)}%`, bold]);
  const lines = hover ? (hover.act >= 0 ? [line(hover.act, probs[hover.act] || 0, true), ["(this part of the map)", false]] : [["no action here", true], [hover.what, false]])
    : probs.map((p, i) => [i, p]).filter(([i, p]) => p > 0.02 && (!allowed || allowed[i])).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([i, p], k) => line(i, p, k === 0));
  // in the game's pixel font (Pete c4dc): the first line 16 px, the others 12, a step smaller when a long name wouldn't fit between the maps
  const room = MAP.memOut.x - (MAP.memIn.x + MAP.memIn.s) - 6;
  lines.forEach(([txt, bold, bits], k) => {
    let px = bold ? 16 : 12;
    for (;;) { g.font = `${px * ts}px 'Craftax Pixel', 'Courier New', monospace`; if (px <= 8 || g.measureText(txt).width <= room) break; px -= 4; }
    g.fillStyle = bold ? pc("#ffd8c8", "#c8ffd0") : pc("#e07a6c", "#6fdc8c");
    const y = [106, 122, 135][k] ?? 106 + k * 13;
    if (!bits) { g.fillText(txt, cx, y); return; }
    const as = px * ts * 0.8, gap = px * ts * 0.4, x0 = cx - (as + gap + g.measureText(txt).width) / 2;
    arrow(bits, x0, y - as / 2, as);
    g.textAlign = "left"; g.fillText(txt, x0 + as + gap, y); g.textAlign = "center";
  });
  // the body's state: death greys it out (no red for a hit or for hunger: that's the other brain's, Pete b70f, 2c5d)
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (dead) {
    g.globalCompositeOperation = "saturation"; g.fillStyle = "#808080"; g.fillRect(0, 0, el.width, el.height);
    g.globalCompositeOperation = "multiply"; g.fillStyle = "#5a5a5a"; g.fillRect(0, 0, el.width, el.height);
  }
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
}

// pointing: over the action map, which action that cell belongs to; over the other maps, what they are
const WHAT = { world: "the world, as it sees it", memIn: "its memory, going in", memOut: "its memory, coming out" };
el.addEventListener("pointermove", (e) => {
  const k = W / (el.clientWidth || W), x = e.offsetX * k, y = e.offsetY * k;
  const on = Object.entries(MAP).find(([, m]) => x >= m.x && x < m.x + m.s && y >= m.y && y < m.y + m.s);
  if (!on) { hover = null; return; }
  if (on[0] !== "out" || !maps) { hover = { act: -1, what: WHAT[on[0]] || "" }; return; }
  const n = Math.round(Math.sqrt(maps.act.length)), m = on[1], cxy = (crop.y + Math.floor(((y - m.y) / m.s) * crop.n)) * n + crop.x + Math.floor(((x - m.x) / m.s) * crop.n);
  hover = { act: maps.act[cxy], what: "dark: light here means nothing" };
});
el.addEventListener("pointerleave", () => (hover = null));

const lit = {};                                                         // per map size: the union of lit pixels' bounds so far
function worldCrop(src, n) {
  const b = (lit[n] ??= { x0: n, y0: n, x1: -1, y1: -1 });
  for (let i = 0; i < src.length; i++) if (src[i]) { const x = i % n, y = (i / n) | 0; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  if (b.x1 < 0) return { x: 0, y: 0, n };
  const size = Math.min(n, Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1), at = (lo, hi) => Math.max(0, Math.min(n - size, Math.round((lo + hi + 1 - size) / 2)));
  return { x: at(b.x0, b.x1), y: at(b.y0, b.y1), n: size };
}
function paintMaps(m) {
  const wn = Math.round(Math.sqrt(m.world.length)), mn = Math.ceil(Math.sqrt(m.memIn.length)), on = Math.round(Math.sqrt(m.out.length));
  // the world in the crystal's own red, never the near-white top of the scale, cropped to the part of the frame that ever lights (a
  // square round it, grown as more lights) so the picture fills its box (Pete be2e); expanded, every mirror of the 192 × 192 frame
  const src = BIG && m.frame ? m.frame : m.world, sn = Math.round(Math.sqrt(src.length)), c = worldCrop(src, sn);
  paint("world", c.n, (j) => { const i = (c.y + Math.floor(j / c.n)) * sn + c.x + (j % c.n); return heat(0.04 + 0.58 * (src[i] / 255)); });
  paint("memIn", mn, (i) => heat(i < m.memIn.length ? 0.04 + 0.9 * (m.memIn[i] / 15) : 0));
  paint("memOut", mn, (i) => heat(i < m.memOut.length ? 0.04 + 0.9 * (m.memOut[i] / 15) : 0));
  // (the usual light subtracted: a cell at its average is dark, 2 e-folds over it full bright; under it stays dark)
  const now = (i) => (m.outLo ?? 0) + (m.out[i] / 255) * 6;
  if (!shown || shown.length !== m.out.length) shown = new Float32Array(m.out.length);
  for (let i = 0; i < m.out.length; i++) { const v = m.out[i] / 255; shown[i] = baseOn && base ? Math.max(0, Math.min(1, (now(i) - base[i]) / 2)) : v * v; }
  const shade = (i) => heat(0.03 + 0.92 * shown[i]);
  paint("out", crop.n, (j) => { const i = (crop.y + Math.floor(j / crop.n)) * on + crop.x + (j % crop.n), c = shade(i), k = m.act[i]; return k < 0 ? c.map((x) => Math.round(x * 0.35)) : allowed && !allowed[k] ? heat(0.01) : c; });   // cells no action reads: dimmed; an action it may not pick now: dark
}
// the running average each new decision updates (after it's painted against the one before): a fresh crystal starts it over
function track(m) {
  const n = m.out.length, now = (i) => (m.outLo ?? 0) + (m.out[i] / 255) * 6;
  if (!base || base.length !== n) { base = Float32Array.from({ length: n }, (_, i) => now(i)); return; }
  for (let i = 0; i < n; i++) base[i] += 0.05 * (now(i) - base[i]);
}

// the four walks shown as arrows in the words under the glass, not "walk east" (Pete 762f): a pixel arrow a walk, pointing on the map
// (north up). Over the action map, only the cells pointed at in the expanded panel get their action's picture (Pete 762f, c7f6)
const BITS = { UP: ["    #    ", "   ###   ", "  #####  ", " ####### ", "#########", "   ###   ", "   ###   ", "   ###   ", "   ###   "] };
const turn = (rows) => rows[0].split("").map((_, x) => rows.map((r) => r[r.length - 1 - x]).join(""));   // a quarter turn left
BITS.LEFT = turn(BITS.UP); BITS.DOWN = turn(BITS.LEFT); BITS.RIGHT = turn(BITS.DOWN);
function arrow(rows, x, y, size) {                                    // the arrow's pixels in the current fill, size × size at (x, y)
  const u = size / rows.length;
  rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && g.fillRect(x + i * u, y + j * u, u + 0.02, u + 0.02)));
}

// the picture of an action, pointed at on the action map (expanded): its arrow, DO, the pickaxe or sword it makes, the block or item it
// places, shoots, casts or reads; a white silhouette (null: no picture), tinted to the look's ink when drawn
BITS.DO = ["####   ### ", "#   # #   #", "#   # #   #", "#   # #   #", "####   ### "];   // D and O, 5 × 5 each (Pete ab79)
const ITEM = { PLACE_STONE: "stone", PLACE_TABLE: "table_side", PLACE_FURNACE: "furnace_front", PLACE_PLANT: "i_sapling", PLACE_TORCH: "i_torch",
  MAKE_TORCH: "i_torch", SHOOT_ARROW: "i_bow", MAKE_ARROW: "i_arrow", ENCHANT_BOW: "i_bow", CAST_FIREBALL: "i_fireball", CAST_ICEBALL: "i_iceball", READ_BOOK: "i_book" };
const TIERS = { WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };
const icons = {};
function iconFor(name) {
  if (name in icons) return icons[name];
  const c = document.createElement("canvas"), x = c.getContext("2d");
  const tool = name.match(/^MAKE_(WOOD|STONE|IRON|DIAMOND)_(PICKAXE|SWORD)$/) || (name === "ENCHANT_SWORD" && [0, "DIAMOND", "SWORD"]);
  icons[name] = null;
  if (BITS[name]) {
    const rows = BITS[name]; c.width = Math.max(...rows.map((r) => r.length)); c.height = rows.length; x.fillStyle = "#fff";
    rows.forEach((r, y) => [...r].forEach((ch, i) => ch === "#" && x.fillRect(i, y, 1, 1)));
    icons[name] = c;
  } else if (tool) {                                                     // the game's own pickaxe / sword, its outline left out
    const px = toolPixels(tool[2].toLowerCase(), TIERS[tool[1]]);
    c.width = px[0].length; c.height = px.length; x.fillStyle = "#fff";
    px.forEach((r, y) => r.forEach((q, i) => q && q[0] !== "o" && x.fillRect(i, y, 1, 1)));
    icons[name] = c;
  } else if (ITEM[name]) {                                               // a game tile, its shading kept, in white, once it has loaded
    try {
      const im = new Image();
      im.onload = () => { c.width = im.width; c.height = im.height; x.filter = "grayscale(1) brightness(1.5)"; x.drawImage(im, 0, 0); icons[name] = c; };
      im.src = iconURL(ITEM[name]);
    } catch { /* no texture: no picture */ }
  }
  return icons[name];
}
// the picture over the action's cells: a dark plate first, a margin of dark all round, then the picture in the look's ink (Pete c7f6)
const inkCv = document.createElement("canvas");
function drawIcon(name, b, s) {
  const ic = iconFor(name); if (!ic || !ic.width) return false;
  const cell = (Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1) * s, size = Math.max(10, cell * 1.4), pad = Math.max(2, size * 0.22), sc = size / Math.max(ic.width, ic.height);
  inkCv.width = ic.width; inkCv.height = ic.height;
  const x = inkCv.getContext("2d");
  x.drawImage(ic, 0, 0); x.globalCompositeOperation = "multiply"; x.fillStyle = pc("#ffc8b8", "#c8ffd0"); x.fillRect(0, 0, ic.width, ic.height);
  x.globalCompositeOperation = "destination-in"; x.drawImage(ic, 0, 0); x.globalCompositeOperation = "source-over";
  const cx = MAP.out.x + ((b.x0 + b.x1 + 1) / 2 - crop.x) * s, cy = MAP.out.y + ((b.y0 + b.y1 + 1) / 2 - crop.y) * s;
  const w = ic.width * sc, h = ic.height * sc, half = Math.max(w, h) / 2 + pad;
  const L = Math.max(MAP.out.x, Math.min(MAP.out.x + MAP.out.s - 2 * half, cx - half)), T = Math.max(MAP.out.y, Math.min(MAP.out.y + MAP.out.s - 2 * half, cy - half));   // (kept on the map)
  const snap = (v) => Math.round(v * DPR) / DPR;
  g.save(); g.imageSmoothingEnabled = false;
  g.fillStyle = "rgba(5,6,11,.9)"; g.fillRect(snap(L), snap(T), snap(2 * half), snap(2 * half));
  g.drawImage(inkCv, snap(L + half - w / 2), snap(T + half - h / 2), w, h);
  g.restore();
  return true;
}

export const crystalBrain = {
  el: box, clear: false, opt: baseRow,
  setNames(list) { names = list; probs = list.map(() => 0); base = null; },
  body(s) {
    if (!s) return;
    dead = !!s.done;
  },
  // reply: { action, probs: number[43], maps: { world, memIn, memOut, out, act } } (crystal-worker.js view())
  update(reply) {
    if (!reply) return;
    if (reply.probs && reply.probs.length === names.length) probs = reply.probs.slice();
    const al = reply.allowed && reply.allowed.length === names.length ? reply.allowed : null;
    if (reply.maps && (al ? al.join() : "") !== (allowed ? allowed.join() : "")) { allowed = al; if (maps && reply.maps === maps) paintMaps(maps); }
    const m = reply.maps;
    if (m && m !== maps) {
      if (!maps || maps.act !== m.act) { const an = Math.round(Math.sqrt(m.act.length)); boxes = actionBoxes(m.act, an); crop = cropTo(boxes, an); }
      maps = m;
      paintMaps(m); track(m);
    }
    if (reply !== lastReply && reply.pending !== false) {
      lastReply = reply;
      chosen = names.indexOf(reply.action);
      const t = performance.now() / 1000;
      if (t - pulseT > 1.4) { pulseT = t; makeRays(); }                  // fast play: a pulse finishes before the next starts
    }
    if (!rays.length) makeRays();
    if (!running) { running = true; requestAnimationFrame(frame); }
  },
};
