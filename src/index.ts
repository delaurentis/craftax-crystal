// craftax-crystal: crystal players for craftax-3d. A crystal is a trained piece of optical glass, simulated in the browser on
// WebGPU by the NeuralCrystal engine (the neuralcrystal package on npm). This plugin adds three things to the game:
//   bot        the crystals in crystal/models.json, in the bot picker (only with ?crystal unless told otherwise); each plays
//              in crystal/crystal-worker.js and sees the game as the picture it was trained on (crystal/frame.js)
//   lookView   laser's renderer in the classic view: that picture, the lit mirrors red on black, the crystal's memory drawn in while
//              it plays (no look of its own: laser, and phosphor, which borrows laser's, show it there)
//   brainView  the crystal's own picture of each move instead of the neuron brain (crystalbrain.js)
//   memoryView the crystal's memory on the panels beside the classic 2D view while it plays (memoryview.ts)
// Each crystal family brings its own frame art (frame-atlas.json); a new family is a new entry here, never a change to the game.
import type { BotModel, BotSource, BrainView, LookView, Plugin } from "craftax-3d/plugin";
import { crystalReplay } from "./brainrec";
import { crystalBrain } from "./crystalbrain.js";
import { memoryView } from "./memoryview";
import { loadAtlas, renderFrame, viewCoarse } from "./crystal/frame.js";

export interface CrystalOptions {
  /** The URL flag that lists the crystals in the bot picker (default "crystal": only with ?crystal). Empty: always listed. */
  flag?: string;
}

type Atlas = { frame: number };
type State = Record<string, any>;

export default function crystal(options: CrystalOptions = {}): Plugin {
  const flag = options.flag ?? "crystal";
  const listed = () => !flag || new RegExp(`[?&]${flag}\\b`).test(location.search);
  let atlas: Promise<Atlas> | null = null;
  const getAtlas = () => (atlas ??= loadAtlas());

  const bot: BotSource = {
    kind: "crystal",
    async models(root) {
      if (!listed()) return [];
      const r = await fetch(new URL("./crystal/models.json", import.meta.url));
      if (!r.ok) return [];
      const { models } = (await r.json()) as { models: BotModel[] };
      // the weights sit in the game's own folder (public/agent/crystal/): resolved here, so the worker gets an absolute URL
      return models.map((m) => bot.prepare!(m, root));
    },
    prepare: (m, root) => { const at = new URL(String(m.crystal), root).href; return { ...m, crystal: at, file: at }; },
    worker: () => new Worker(new URL("./crystal/crystal-worker.js", import.meta.url), { type: "module" }),
    // the 192 × 192 frame drawn from the engine's own state (its memory cells blank: the crystal draws its memory itself), then
    // the walker's view: 99 coarse tiles and the facing, which a B2 crystal's TARGET plays from (crystal-worker.js), then one byte:
    // 1 while the player sleeps or rests, when the crystal plays no-op and keeps its memory, as it was trained
    async observe(m, game) {
      const A = await getAtlas(), s = game.state() as State;
      const fr = renderFrame(A, s, 0, !!m.stamp), obs = new Uint8Array(fr.length + 101);
      obs.set(fr); obs.set(viewCoarse(A, s), fr.length); obs[fr.length + 99] = s.dir;
      obs[fr.length + 100] = s.sleeping || s.resting ? 1 : 0;
      return obs;
    },
    usefulOnly: true,
    brain: crystalReplay(),                                             // (its picture in recordings and replays: brainrec.ts)
    hint: (m) => `its crystal (${String(m.crystal)}) isn't there: pack it into public/agent/crystal/`,
  };

  // WHAT THE CRYSTAL SEES (Pete, 2026-10-21: V to the classic view, then M): pixel for pixel the training frames, lit mirrors red on
  // black; the memory cells carry the crystal's own memory while one plays (its 4-bit levels drawn as the trainer draws them)
  let ready: Atlas | null = null;
  const canvas = document.createElement("canvas");
  const sees: LookView = {
    look: "laser", views: ["classic"],
    label: "What the crystal sees",
    draw(S, img, refresh) {
      if (!ready) { getAtlas().then((A) => { ready = A; refresh(); }, (e) => console.error("[craftax-crystal] frame atlas", e)); return; }
      const A = ready, F = A.frame, w = S.world as State | undefined, playing = w?.control === "bot";
      const mem: number[] | null = playing && w?.bot_reply?.memPix ? w.bot_reply.memPix : null;
      // a SPLIT crystal playing (crystal-worker.js): its two input frames side by side, head A (the board) and head B (the slow
      // fields and its memory), the lit mirrors of the step it last took
      const sp = playing ? w?.bot_reply?.split : null, GAP = 6, Wd = sp ? 2 * F + GAP : F;
      const fr = new Uint8Array(Wd * F);
      if (sp) {
        for (const px of sp.a) fr[Math.floor(px / F) * Wd + (px % F)] = 1;
        for (const px of sp.b) fr[Math.floor(px / F) * Wd + F + GAP + (px % F)] = 1;
      } else {
        fr.set(renderFrame(A, S.engine_map ? { ...S, map: S.engine_map } : S, 0, !!w?.crystal_stamp));
        if (mem) for (const px of mem) fr[px] = 1;
      }
      canvas.width = Wd; canvas.height = F;
      const g = canvas.getContext("2d")!, im = g.createImageData(Wd, F);
      for (let i = 0; i < Wd * F; i++) {
        const o = 4 * i, gap = sp && i % Wd >= F && i % Wd < F + GAP;
        if (fr[i]) { im.data[o] = 255; im.data[o + 1] = 42; im.data[o + 2] = 24; }
        else if (gap) { im.data[o] = im.data[o + 1] = im.data[o + 2] = 0; }
        else { im.data[o] = 8; im.data[o + 1] = 6; im.data[o + 2] = 6; }
        im.data[o + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      img.src = canvas.toDataURL();
    },
  };

  // the crystal's brain view is crystalBrain itself (the panel sets its `clear`), told which bots it draws
  const brainView: BrainView = Object.assign(crystalBrain, {
    id: "crystal",
    label: "crystal",
    accepts: (world: Record<string, unknown>) => world.bot_kind === "crystal",
  });

  return {
    name: "craftax-crystal",
    provides: ["bot", "lookView", "brainView", "memoryView"],
    setup(host) {
      host.add("bot", bot);
      host.add("lookView", sees);
      host.add("brainView", brainView);
      host.add("memoryView", memoryView);
    },
  };
}
