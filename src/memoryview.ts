// THE MEMORY STRIP (the game's "memoryView" slot, craftax-3d src/core/plugins.ts): the crystal's own memory on the panels down both
// sides of the classic 2D view, while a crystal plays. Its units' 4-bit levels after the step (crystal-worker.js view(): maps.memOut,
// 0..15 a unit, all of them; the brain view's "memory, coming out" map) laid out as that map is, n × n units (32 × 32 for 1,024),
// split down the middle: the left half of the map on the left panel, the right half on the right, in blocks of 8 × 8 units. A unit's
// cell is as bright as its level; the units the step changed (memOut ≠ memIn) flash. No crystal playing: nothing to show.
import type { MemoryArea, MemoryView } from "craftax-3d/plugin";

type Maps = { memIn: Uint8Array; memOut: Uint8Array };
type World = { control?: string; bot_kind?: string; bot_reply?: { maps?: Maps } | null };

const BLOCK = 8, FLASH_MS = 700;

let maps: Maps | null = null;
let when = new Float64Array(0);                                       // when each unit last changed (performance.now())

// the crystal's maps in this state, when a crystal is the one playing
function mapsOf(state: Record<string, unknown>): Maps | null {
  const w = state.world as World | undefined;
  if (!w || w.control !== "bot" || w.bot_kind !== "crystal") return null;
  const m = w.bot_reply?.maps;
  return m && m.memOut && m.memIn ? m : null;
}

export const memoryView: MemoryView = {
  id: "crystal",
  label: "Memory strip",
  update(state) {
    const m = mapsOf(state);
    if (!m) { maps = null; return; }
    if (m === maps) return;                                            // (the same reply: a state with no new step)
    if (when.length !== m.memOut.length) when = new Float64Array(m.memOut.length).fill(-1e9);
    const now = performance.now();
    for (let i = 0; i < m.memOut.length; i++) if (m.memOut[i] !== m.memIn[i]) when[i] = now;
    maps = m;
  },
  active: () => maps !== null,
  draw(left: HTMLCanvasElement, right: HTMLCanvasElement, area: MemoryArea, now: number) {
    if (!maps) return;
    const out = maps.memOut, n = Math.ceil(Math.sqrt(out.length)), half = Math.ceil(n / 2);
    const gap = 2;                                                      // between blocks, in canvas pixels
    const bx = Math.ceil(half / BLOCK), by = Math.ceil(n / BLOCK);      // blocks across and down a panel
    const cell = Math.max(2, Math.floor(Math.min((area.width - (bx - 1) * gap) / half, (area.height - (by - 1) * gap) / n)));
    const W = half * cell + (bx - 1) * gap, H = n * cell + (by - 1) * gap;
    const on = area.red ? [255, 52, 36] : [235, 235, 235], off = area.red ? [8, 6, 6] : [12, 12, 12];
    const flash = area.red ? [255, 220, 160] : [120, 200, 255], inset = cell > 3 ? 1 : 0;
    ([[left, 0], [right, half]] as [HTMLCanvasElement, number][]).forEach(([cv, c0]) => {
      cv.width = W; cv.height = H;
      const g = cv.getContext("2d")!, img = g.createImageData(W, H), d = img.data;
      for (let r = 0; r < n; r++) for (let cc = 0; cc < half; cc++) {
        const c = c0 + cc, i = r * n + c;
        if (c >= n || i >= out.length) continue;
        const lv = out[i] / 15, age = now - when[i], f = age < FLASH_MS ? 1 - age / FLASH_MS : 0;
        const col = [0, 1, 2].map((j) => { const base = off[j] + (on[j] - off[j]) * lv; return base + (flash[j] - base) * f * 0.85; });
        const x0 = cc * cell + Math.floor(cc / BLOCK) * gap, y0 = r * cell + Math.floor(r / BLOCK) * gap;
        for (let y = y0; y < y0 + cell - inset; y++) for (let x = x0; x < x0 + cell - inset; x++) {
          const p = (y * W + x) * 4; d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
  },
  clear() { maps = null; when.fill(-1e9); },
};
