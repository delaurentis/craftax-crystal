// The crystal's picture in recordings and replays (BotSource.brain, src/replay/brain-rec.ts in craftax-3d): the world it saw, its
// memory in and out, the light on its action head, and which action each of the head's cells reads.
//   Every recording keeps the action map once (which cell reads which action), each time a crystal takes over: a few KB.
//   With Settings → Agent → "Record brain activity" on, each move also keeps the whole memory (4-bit, only the units
//   that changed) and the action head's light (4-bit, the cells that changed), so the replay shows the crystal exactly as it was.
//   Off (Pete): a small picture. The world is drawn from the replay itself (exactly what the crystal saw: the game is the same);
//   the memory is a small 16 × 16 one that changes a little each move (not the crystal's: it isn't kept); the head's light comes
//   from the move's five likeliest actions, so the rays go to those.
// A recording from before any of this has no action map: the actions are then laid out on a plain grid.
import type { BotReply, BrainCodec } from "craftax-3d/plugin";

type Maps = { split: boolean; world: Uint8Array; frame: Uint8Array; memIn: Uint8Array; memOut: Uint8Array; out: Uint8Array; outLo: number; act: Int8Array };
type Kept = { act?: string; split?: 1; mo?: number[]; mabs?: string; o?: number[]; oabs?: string; lo?: number };

const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const D = 64, SMALL = 16;                                               // the world's bins; the small memory's side
// changes from a to b as [index, value, ...]
const diff = (a: Uint8Array, b: Uint8Array) => { const d: number[] = []; for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) d.push(i, b[i]); return d; };
const nib = (out: Uint8Array) => Uint8Array.from(out, (v) => Math.round(v / 17));   // the head's light, 0..255 → 0..15

// the frame binned to 64 × 64, as crystal-worker.js bins it
function bin(fr: ArrayLike<number>, F: number) {
  const out = new Uint8Array(D * D), b = F / D;
  for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (fr[y * F + x]) out[Math.floor(y / b) * D + Math.floor(x / b)]++;
  const k = 255 / Math.ceil(b) ** 2;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(out[i] * k));
  return out;
}
// the actions on a plain grid (a recording without its crystal's action map): 7 × 7 blocks of 9 cells, a 3 × 3 spot in each
function gridAct(n: number) {
  const act = new Int8Array(D * D).fill(-1);
  for (let a = 0; a < n; a++) { const bx = (a % 7) * 9 + 3, by = Math.floor(a / 7) * 9 + 3; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) act[(by + y) * D + bx + x] = a; }
  return act;
}

export function crystalReplay(): BrainCodec {
  // recording: what was last kept
  let eMem: Uint8Array | null = null, eOut: Uint8Array | null = null, eAct: Int8Array | null = null;
  // replaying: the picture as it stands
  let act: Int8Array | null = null, split = false, mem: Uint8Array | null = null, real = false, out: Uint8Array | null = null, lo = 0, rnd = Math.random;

  return {
    record(r, full, first) {
      const m = r.maps as Maps | undefined;
      if (!m) return undefined;
      if (first) eMem = eOut = eAct = null;
      const k: Kept = {};
      if (m.act !== eAct) { k.act = b64(new Uint8Array(m.act.buffer, m.act.byteOffset, m.act.length)); if (m.split) k.split = 1; eAct = m.act; }
      if (full) {
        if (!eMem || eMem.length !== m.memOut.length) k.mabs = b64(m.memOut); else { const d = diff(eMem, m.memOut); if (d.length) k.mo = d; }
        eMem = m.memOut.slice();
        const o = nib(m.out);
        if (!eOut || eOut.length !== o.length) k.oabs = b64(o); else { const d = diff(eOut, o); if (d.length) k.o = d; }
        eOut = o; k.lo = Math.round(m.outLo * 100) / 100;
      }
      return Object.keys(k).length ? k : undefined;
    },

    replay(kept, ctx) {
      const k = (kept.x || {}) as Kept;
      if (ctx.first) {
        act = null; split = false; out = null; lo = 0; real = false;
        let s = (ctx.seed | 0) || 1; rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);   // (the same each time it's played)
        mem = Uint8Array.from({ length: SMALL * SMALL }, () => (rnd() < 0.35 ? 1 + Math.floor(rnd() * 9) : 0));
      }
      if (k.act) { const b = unb64(k.act); act = new Int8Array(b.buffer); split = !!k.split; }
      act ??= gridAct(43);
      const memIn = mem!.slice();
      if (k.mabs) { mem = unb64(k.mabs); real = true; }
      else if (k.mo) { for (let i = 0; i < k.mo.length; i += 2) mem![k.mo[i]] = k.mo[i + 1]; real = true; }
      else if (!real) for (let i = 0; i < mem!.length; i++) if (rnd() < 0.04) mem![i] = Math.max(0, Math.min(15, mem![i] + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3))));
      const memOut = mem!.slice();

      // the action head's light: kept, or from the move's probabilities (all of them, or its five likeliest)
      let probs = kept.probs;
      if (!probs) {
        const p = new Array(43).fill(0), top = kept.top || [], names = ctx.actions;
        let rest = 1; for (const [nm, v] of top) { const i = names.indexOf(nm); if (i >= 0) { p[i] = v; rest -= v; } }
        const left = p.filter((v) => v === 0).length; for (let i = 0; i < p.length; i++) if (p[i] === 0) p[i] = Math.max(0, rest) / Math.max(1, left) * 0.3;
        probs = p;
      }
      if (k.oabs) out = unb64(k.oabs).map((v) => v * 17) as Uint8Array;
      else if (k.o && out) for (let i = 0; i < k.o.length; i += 2) out[k.o[i]] = k.o[i + 1] * 17;
      if (k.lo !== undefined) lo = k.lo;
      if (!k.oabs && !k.o && !real) {
        const mx = Math.max(...probs), l0 = Math.log(mx + 1e-12) - 6;
        out = Uint8Array.from(act, (a) => (a < 0 ? Math.floor(rnd() * 10) : Math.max(0, Math.min(255, Math.round(((Math.log((probs![a] ?? 0) + 1e-12) - l0) / 6) * 255 * (0.85 + rnd() * 0.15))))));
        lo = l0;
      }
      out ??= new Uint8Array(act.length);
      const shownMem = Array.from({ length: 192 }, (_, i) => memOut[Math.floor((i * memOut.length) / 192)] / 15);
      const a = act, o = out, sp = split, l = lo;
      // the world: what the crystal sees, drawn from the replay's own game, a moment later (the frame's atlas loads once)
      return (async (): Promise<Partial<BotReply>> => {
        const obs = await ctx.observe(), F = Math.round(Math.sqrt(obs.length - 101)), fr = Array.prototype.slice.call(obs, 0, F * F) as number[];
        const maps: Maps = { split: sp, world: bin(fr, F), frame: Uint8Array.from(fr, (v) => (v ? 255 : 0)), memIn, memOut, out: o, outLo: l, act: a };
        return { probs, mem: shownMem, memShape: [1, 192, 48], maps };
      })();
    },

    snapshot() {
      if (!act) return undefined;
      const k: Kept = { act: b64(new Uint8Array(act.buffer, act.byteOffset, act.length)), ...(split ? { split: 1 as const } : {}) };
      if (real && mem) { k.mabs = b64(mem); if (out) k.oabs = b64(nib(out)); k.lo = Math.round(lo * 100) / 100; }
      return k;
    },
  };
}
