// THE CRYSTAL PLAYS (Pete, 2026-10-21: "optical image in, actions out"): the end-to-end Craftax crystal (tools/nc/train_craftax_e2e.py)
// as a bot, in a worker, its light on WebGPU (@nc/engine, packages/engine). One game step, as the trainer runs it (no noise):
//   the frame (crystal/frame.js, from the engine's state) with the memory cells cleared and the memory h drawn in (tr.craftax.mem: unit
//   u's 4-bit level on the 4 mirrors of one cell, binary, high bit first) → 6 passes of light → the 64 × 64 grid's cell powers →
//   act: log light + gA (the action logits); z, hc: sigmoid(al · (log light − the mean over z and hc cells) + be) per unit
//   h ← round(15 · clamp(h + z (hc − h), 0, 1)) / 15
// Same messages as agent-worker.js: {type:"load", model} → ready; {type:"act", id, obs: the frame (Uint8Array F²), mask, temp} →
// {action, probs, value, mem, memShape, memPix}; reset (h = 0, a new game); getmem / setmem (h, saved with the world); took (ignored).
// SPLIT CRYSTALS (tools/nc/craftax_split.py, crystal.py run_split; quad.split + tr.craftax.split in the file): two input frames gathered
// from the same 192 × 192 frame by the file's maps (head A the board + key fields, mapA; head B the slow fields, mapB, with the memory drawn
// into B's cells), two output tiles (out[0]: head 1, the actions or B2's actions + TARGET + where map; out[1]: head 2, memory z / hc).
// B2 (tr.craftax.split.test "B2"): 44 action regions (Craftax's 43, then TARGET) and the 107-region where map; TARGET plays the walker's
// press toward the top where region (crystal/walker.js, a pass every step). The obs then carries the walker's view after the frame:
// obs = [the F² frame, 99 coarse tiles (frame.js viewCoarse), the facing 1..4].
import { loadCrystal, requestGpu, gridFits, WebGpuBackend, CrystalEngine, chessKit } from "neuralcrystal";
import { walkerTarget } from "./walker.js";

const N_ACT = 43;
let eng = null, kit = null, F = 192, U = 0, cells = null, mem = null, memAll = null, head = null, h = null, gpuName = "cpu";
let split = null;                                                    // { test, mapA, mapB } on a split crystal
let actMap = null;                                                   // the crystal view: each output cell's action (-1: none), from cells.act

async function load(m) {
  const url = new URL(m.crystal);                                    // (absolute: the plugin resolved it against the game's root)
  const data = await loadCrystal(url.href);
  const cx = data.model.tr?.craftax;
  if (!cx?.cells || !cx.e2eHead) throw new Error(`${m.name}: not an end-to-end Craftax crystal (no tr.craftax.cells / e2eHead)`);
  F = cx.frame; U = cx.units; cells = cx.cells; mem = cx.mem; memAll = cx.memAll; head = cx.e2eHead;
  if (cx.split) {
    if (!data.model.quad?.split) throw new Error(`${m.name}: tr.craftax.split without quad.split`);
    split = { test: cx.split.test, mapA: Int32Array.from(cx.split.mapA), mapB: Int32Array.from(cx.split.mapB) };
  }
  const gpu = await requestGpu().catch(() => null);
  const fits = gpu && gridFits(gpu.limits, data.model.N);
  eng = new CrystalEngine(data, fits ? (g) => new WebGpuBackend(gpu.device, g) : undefined);
  eng.reuseReads = true;                                             // one exit field, rewritten every step
  gpuName = fits ? "webgpu" : "cpu";
  kit = chessKit(data);                                              // only its 64 × 64 cell powers (the readout's bands)
  h = new Float32Array(U);
  actMap = null;
}

// THE CRYSTAL VIEW (js/crystalbrain.js, Pete note 8628): what goes in and what comes out, small enough to send every step. world: the
// frame binned to 64 × 64 (0..255); memIn / memOut: h before and after the step, a unit a byte (0..15); out: the action head's cell
// powers, log-scaled to 0..255 over the brightest 6 e-folds; act: each cell's action (-1 none; 43: TARGET on a B2 crystal)
const D = 64;
function bin(fr) {
  const out = new Uint8Array(D * D), b = F / D;
  for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (fr[y * F + x]) out[Math.floor(y / b) * D + Math.floor(x / b)]++;
  const k = 255 / (Math.ceil(b) ** 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(out[i] * k));
  return out;
}
const levels = (hh) => Uint8Array.from(hh, (v) => Math.round(Math.min(1, Math.max(0, v)) * 15));
function view(obs, memIn, p) {
  const n = p.length;
  if (!actMap || actMap.length !== n) { actMap = new Int8Array(n).fill(-1); cells.act.forEach((c, a) => [].concat(c).forEach((k) => (actMap[k] = a))); }
  let mx = -Infinity; for (let i = 0; i < n; i++) if (p[i] > mx) mx = p[i];
  const lo = Math.log(mx + 1e-12) - 6, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(((Math.log(p[i] + 1e-12) - lo) / 6) * 255)));
  // (outLo: the log light at out's 0, so the brain can put each cell back on one scale step to step: its usual-light baseline)
  const fr = obs.subarray ? obs.subarray(0, F * F) : obs.slice(0, F * F);
  // (frame: the world at its own 192 × 192, for the expanded panel: Pete ecab)
  return { split: !!split, world: bin(fr), frame: Uint8Array.from(fr, (v) => (v ? 255 : 0)), memIn, memOut: levels(h), out, outLo: lo, act: actMap };
}

const sig = (x) => 1 / (1 + Math.exp(-x));

// the memory: unit u's 4-bit level on its 4 bits (high bit first), each bit one mirror or its block of mirrors (memBit > 1)
function drawMem(fr) {
  const memPix = [];
  for (let u = 0; u < U; u++) {
    const q = Math.round(Math.min(1, Math.max(0, h[u])) * 15);
    for (let j = 0; j < 4; j++) if ((q >> (3 - j)) & 1) for (const px of [].concat(mem[u][j])) { fr[px] = 1; memPix.push(px); }
  }
  return memPix;
}

const regionLog = (p, c) => (Array.isArray(c) ? Math.log(c.reduce((s, k) => s + p[k], 0) + 1e-12) : Math.log(p[c] + 1e-12));   // a block of cells: its light summed

// z, hc → h, as the trainer steps it (no noise)
function stepMem(p) {
  const lz = cells.z.map((c) => regionLog(p, c)), lh = cells.hc.map((c) => regionLog(p, c));
  let mean = 0; for (let u = 0; u < U; u++) mean += lz[u] + lh[u]; mean /= 2 * U;
  for (let u = 0; u < U; u++) {
    const z = sig(head.al[0][u] * (lz[u] - mean) + head.be[0][u]), hc = sig(head.al[1][u] * (lh[u] - mean) + head.be[1][u]);
    h[u] = Math.round(Math.min(1, Math.max(0, h[u] + z * (hc - h[u]))) * 15) / 15;
  }
}

// the most likely allowed choice, or one drawn from softmax(logits / temp) over the allowed ones (as agent-worker.js)
function choose(logits, allowed, temp) {
  const n = logits.length; let best = 0, max = -Infinity;
  for (let i = 0; i < n; i++) if (allowed[i] && logits[i] > max) { max = logits[i]; best = i; }
  const probs = new Float32Array(n); let sum = 0;
  const k = temp > 0 ? 1 / temp : 1;
  for (let i = 0; i < n; i++) if (allowed[i]) sum += probs[i] = Math.exp((logits[i] - max) * k);
  for (let i = 0; i < n; i++) probs[i] /= sum;
  if (temp > 0) { let r = Math.random(); for (let i = 0; i < n; i++) if ((r -= probs[i]) <= 0 && allowed[i]) { best = i; break; } }
  return { best, probs };
}

const lit = (fr) => { const out = []; for (let i = 0; i < fr.length; i++) if (fr[i]) out.push(i); return out; };

async function actSplit({ obs, mask, temp }) {
  const n = F * F, fa = new Float32Array(n), fb = new Float32Array(n), { mapA, mapB } = split;
  for (let i = 0; i < n; i++) { if (mapA[i] >= 0) fa[i] = obs[mapA[i]]; if (mapB[i] >= 0) fb[i] = obs[mapB[i]]; }
  const memPix = drawMem(fb), memIn = levels(h);
  const t0 = performance.now();
  const run = await eng.runSplit(fa, fb, F);
  const p1 = kit.powers(eng, run.exits[0]), p2 = kit.powers(eng, run.exits[1]);
  const ms = performance.now() - t0;
  const nA = cells.act.length, la = cells.act.map((c, a) => regionLog(p1, c) + head.gA[a]);
  stepMem(p2);
  let action, probs, target = null;
  if (split.test === "B2") {
    const allowed = [...Array.from({ length: N_ACT }, (_, i) => !!mask[i]), true];   // TARGET is always allowed
    const c = choose(la, allowed, temp);
    let wb = 0, wv = -Infinity;
    cells.where.forEach((cs, w) => { const v = regionLog(p1, cs) + head.gA[nA + w]; if (v > wv) { wv = v; wb = w; } });
    const tiles = obs.length >= n + 99 ? obs.subarray(n, n + 99) : null, fac = obs.length >= n + 100 ? obs[n + 99] : 4;
    const walk = tiles ? walkerTarget(wb, tiles, fac) : 0;
    action = c.best === N_ACT ? walk : c.best;
    probs = Array.from(c.probs.subarray(0, N_ACT)); probs[walk] += c.probs[N_ACT];   // TARGET's share on the press it would make
    target = { chose: c.best === N_ACT, where: wb, press: walk, p: c.probs[N_ACT] };
  } else {
    const c = choose(la, mask, temp); action = c.best; probs = Array.from(c.probs);
  }
  const shown = Array.from({ length: 192 }, (_, i) => Math.floor((i * U) / 192));
  return { action, probs, value: 0, sense: [], mem: shown.map((u) => h[u]), memShape: [1, 192, 48], memPix, ms, gpu: gpuName, target,
           split: { a: lit(fa), b: lit(fb) }, maps: view(obs, memIn, p1) };
}

// while the player sleeps or rests (the flag after the walker's view), the crystal plays no-op and its memory holds, as in training:
// the light isn't run and h is left as it was
let last = null;
async function act({ obs, mask, temp }) {
  if (obs[F * F + 100] && last) return { ...last, action: 0, probs: Array.from({ length: last.probs.length }, (_, i) => (i === 0 ? 1 : 0)), memPix: [], ms: 0, held: true };
  return (last = await actOnce({ obs, mask, temp }));
}

async function actOnce({ obs, mask, temp }) {
  if (split) return actSplit({ obs, mask, temp });
  const fr = new Float32Array(F * F);
  for (let i = 0; i < fr.length; i++) fr[i] = obs[i];
  for (const p of memAll) fr[p] = 0;
  const memPix = [], memIn = levels(h);
  for (let u = 0; u < U; u++) {
    const q = Math.round(Math.min(1, Math.max(0, h[u])) * 15);
    for (let j = 0; j < 4; j++) if ((q >> (3 - j)) & 1) for (const px of [].concat(mem[u][j])) { fr[px] = 1; memPix.push(px); }   // a bit: one mirror, or its block (memBit > 1)
  }
  const t0 = performance.now();
  const run = await eng.run(fr, F);
  const p = kit.powers(eng, run.exit);
  const ms = performance.now() - t0;
  const lq = (c) => Math.log(p[c] + 1e-12);
  const logits = cells.act.map((c, a) => (Array.isArray(c) ? Math.log(c.reduce((s, k) => s + p[k], 0) + 1e-12) : lq(c)) + head.gA[a]);   // a block of cells: its light summed
  const lz = cells.z.map(lq), lh = cells.hc.map(lq);
  let mean = 0; for (let u = 0; u < U; u++) mean += lz[u] + lh[u]; mean /= 2 * U;
  for (let u = 0; u < U; u++) {
    const z = sig(head.al[0][u] * (lz[u] - mean) + head.be[0][u]), hc = sig(head.al[1][u] * (lh[u] - mean) + head.be[1][u]);
    const hn = Math.min(1, Math.max(0, h[u] + z * (hc - h[u])));
    h[u] = Math.round(hn * 15) / 15;
  }
  // as agent-worker.js: the most likely allowed action, or one drawn from softmax(logits / temp) over the allowed ones
  let best = 0, max = -Infinity;
  for (let i = 0; i < N_ACT; i++) if (mask[i] && logits[i] > max) { max = logits[i]; best = i; }
  const probs = new Float32Array(N_ACT); let sum = 0;
  const k = temp > 0 ? 1 / temp : 1;
  for (let i = 0; i < N_ACT; i++) if (mask[i]) sum += probs[i] = Math.exp((logits[i] - max) * k);
  for (let i = 0; i < N_ACT; i++) probs[i] /= sum;
  if (temp > 0) { let r = Math.random(); for (let i = 0; i < N_ACT; i++) if ((r -= probs[i]) <= 0 && mask[i]) { best = i; break; } }
  // the brain view: 192 of the 1,024 units, evenly spaced (its first 48 the panel's tier); memPix: the memory mirrors lit this step
  const shown = Array.from({ length: 192 }, (_, i) => Math.floor((i * U) / 192));
  return { action: best, probs: Array.from(probs), value: 0, sense: [], mem: shown.map((u) => h[u]), memShape: [1, 192, 48], memPix, ms, gpu: gpuName, maps: view(obs, memIn, p) };
}

let queue = Promise.resolve();
onmessage = ({ data: m }) => { queue = queue.then(() => handle(m)); };
async function handle(m) {
  try {
    if (m.type === "load") { if (!eng) await load(m.model); postMessage({ type: "ready" }); }
    else if (m.type === "reset") { h && h.fill(0); last = null; }
    else if (m.type === "getmem") postMessage({ type: "mem", id: m.id, mem: [{ crystalH: Array.from(h) }] });
    else if (m.type === "setmem") { const s = m.mem.find((t) => "crystalH" in t); if (s && h) h.set(s.crystalH); }
    else if (m.type === "act") postMessage({ type: "act", id: m.id, ...(await act(m)) });
  } catch (e) { postMessage({ type: m.type === "act" ? "act" : "ready", id: m.id, error: String(e && e.message || e) }); }
}
