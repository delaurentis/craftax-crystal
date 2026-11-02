// frame.js against JAX: node craftax3d/web/crystal/frame-check.mjs <frame-cases.json> (tools/nc/craftax_frame_cases.py)
import { readFileSync } from "node:fs";
import { renderFrame } from "./frame.js";
const A = JSON.parse(readFileSync(new URL("./frame-atlas.json", import.meta.url)));
const bits = (b64, n) => { const s = Buffer.from(b64, "base64"), o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = (s[i >> 3] >> (7 - (i & 7))) & 1; return o; };
A.glyphBits = bits(A.glyphs, A.n_glyphs * A.tile * A.tile); A.staticBits = bits(A.static, A.frame * A.frame);
const { mode, cases } = JSON.parse(readFileSync(process.argv[2]));
let bad = 0;
for (const c of cases) {
  const want = bits(c.frame, A.frame * A.frame), got = renderFrame(A, c.state, mode);
  const off = []; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) off.push(i);
  if (off.length) { bad++; if (bad <= 5) console.log(`seed ${c.seed} t ${c.t}: ${off.length} px off, first at row ${Math.floor(off[0] / A.frame)} col ${off[0] % A.frame}`); }
}
console.log(`${cases.length - bad} / ${cases.length} frames identical`); process.exit(bad ? 1 : 0);
