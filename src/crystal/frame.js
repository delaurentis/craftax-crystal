// The crystal's picture of the game: the 192 × 192 mirror frame the end-to-end crystal was trained on (tools/nc/craftax_frame.py
// render() with the simplified symbols), drawn from the engine's cx_state_json. The 9 × 11 view as 16 × 16 glyphs (the creature, else
// the item, else the block; unlit tiles dark; the player turned to its facing; fighters with a health bar), the HUD's pads under it,
// and the memory cells left blank (the crystal player draws its memory there). Glyphs and placements come from frame-atlas.json
// (tools/nc/craftax_frame_atlas.py). Checked pixel for pixel against JAX: frame-check.mjs on tools/nc/craftax_frame_cases.py's cases.

const VISIBLE = 12;                       // craftax3d/engine constants.h VISIBLE_LIGHT_THRESHOLD: light (0-255) above it is lit (JAX: > 0.05)
const CLASS_FIELD = { passive: "passive", melee: "melee", ranged: "ranged", "mob projectile": "mob_projectiles", "your projectile": "player_projectiles" };

const bits = (b64, n) => {
  const s = atob(b64), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (s.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return out;
};
// jnp.round: halves to even
const roundEven = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f; };

export async function loadAtlas(url = new URL("./frame-atlas.json", import.meta.url)) {
  const A = await (await fetch(url)).json();
  const TL = A.tile;
  A.glyphBits = bits(A.glyphs, A.n_glyphs * TL * TL);
  A.staticBits = bits(A.static, A.frame * A.frame);
  A.hudIndex = Object.fromEntries(A.hud.map((n, i) => [n, i]));
  return A;
}

// [44][9] pads lit, in A.hud order (craftax_frame.hud_on)
function hudOn(A, s, mode) {
  const inv = s.inventory, lv = s.level;
  const thermo = (n) => Array.from({ length: 9 }, (_, k) => k < Math.min(9, n));
  const root = (v) => thermo(roundEven(Math.sqrt(v)));
  const hot = (i) => Array.from({ length: 9 }, (_, k) => k === i);
  const v = {
    health: thermo(roundEven(s.health)), food: thermo(s.food), drink: thermo(s.drink), energy: thermo(s.energy), mana: thermo(s.mana),
    xp: thermo(s.xp), dexterity: thermo(s.dexterity), strength: thermo(s.strength), intelligence: thermo(s.intelligence),
    floor: hot(lv), light: thermo(lv === 0 ? roundEven(9 * s.daylight) : 4),
    "pickaxe tier": thermo(inv.pickaxe), "sword tier": thermo(inv.sword), bow: thermo(inv.bow), books: thermo(inv.books),
    "sword ench.": thermo(s.sword_enchant), "bow ench.": thermo(s.bow_enchant),
    facing: hot([3, 5, 1, 7][Math.min(3, Math.max(0, s.dir - 1))]), mode: hot([0, 2, 6, 8][mode]),
  };
  for (const n of ["wood", "stone", "coal", "iron", "diamond", "sapling", "ruby", "sapphire", "arrows", "torches"]) v[n] = root(inv[n]);
  ["red", "green", "blue", "pink", "cyan", "yellow"].forEach((c, i) => (v[`potion ${c}`] = root(inv.potions[i])));
  ["helmet", "chestplate", "pants", "boots"].forEach((n, i) => (v[n] = thermo(inv.armour[i])));
  ["helmet ench.", "chest ench.", "pants ench.", "boots ench."].forEach((n, i) => (v[n] = thermo(s.armour_enchant[i])));
  const boss = lv === 8 && s.melee.length === 0 && s.ranged.length === 0 && s.boss_spawn_turns <= 0;
  v.flags = [s.sleeping, s.resting, s.spells[0], s.spells[1], s.monsters_killed >= 8, boss, false, false, false];
  return A.hud.map((n) => v[n]);
}

// THE NEW PLAYER TILE (tools/nc/craftax_lessons.py stamp(), the lessons crystals): the 16 × 16 player square at rows 64..79, cols
// 80..95. Each need at 3 or fewer hollows the body (thirsty: head; hungry: tummy; tired: arms; hurt: legs and feet), then the pickaxe
// tier lights 3 × 3 corners 1 px in: top-right (wood), top-left (stone), bottom-left (iron), bottom-right (diamond)
const TILE_Y = 64, TILE_X = 80;
const HOLES = [[[5, 7], [5, 8], [6, 7], [6, 8]], [[8, 7], [8, 8], [9, 7], [9, 8]], [[8, 4], [8, 5], [9, 4], [8, 10], [8, 11], [9, 11]],
  [[10, 6], [10, 9], [11, 5], [11, 6], [11, 9], [11, 10]]];
const CORNERS = [[1, 12], [1, 1], [12, 1], [12, 12]];
function stampPlayer(fr, F, s) {
  const needs = [s.drink <= 3, s.food <= 3, s.energy <= 3, roundEven(s.health) <= 3];
  needs.forEach((on, k) => { if (on) for (const [y, x] of HOLES[k]) fr[(TILE_Y + y) * F + TILE_X + x] = 0; });
  for (const [y0, x0] of CORNERS.slice(0, Math.min(4, Math.max(0, s.inventory.pickaxe))))
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) fr[(TILE_Y + y) * F + TILE_X + x] = 1;
}

// the 9 × 11 view's glyphs (the creature, else the item, else the block; unlit tiles dark; the player at the center), their health bars,
// and which creature class sits on each tile (-1: none), as renderFrame draws them
function viewTiles(A, s) {
  const [H, W] = A.view, NB = A.n_blocks, MS = s.size[0];
  const cy = H >> 1, cx = W >> 1, [py, px] = s.pos;
  const tile = new Int32Array(H * W), hp = new Float32Array(H * W), lit = new Uint8Array(H * W), entCls = new Int8Array(H * W).fill(-1);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const y = py - cy + r, x = px - cx + c, k = r * W + c, inside = y >= 0 && y < MS && x >= 0 && x < MS;
      const blk = inside ? s.map[y * MS + x] : A.blocks.indexOf("out of bounds"), item = inside ? s.items[y * MS + x] : 0;
      tile[k] = item > 0 ? NB + item - 1 : blk;
      lit[k] = inside && s.light[y * MS + x] > VISIBLE ? 1 : 0;
    }
  const ent = new Int32Array(H * W).fill(-1);
  A.classes.forEach((cls, ci) => {
    for (const m of s[CLASS_FIELD[cls]] || []) {
      const r = m.pos[0] - py + cy, c = m.pos[1] - px + cx;
      if (r < 0 || r >= H || c < 0 || c >= W) continue;
      let g = A.cls_base[ci][m.type];
      if (m.dir) { const [dy, dx] = m.dir; g += dx < 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3; }
      ent[r * W + c] = g; entCls[r * W + c] = ci; hp[r * W + c] = cls === "melee" || cls === "ranged" ? m.hp : 0;
    }
  });
  for (let k = 0; k < H * W; k++) {
    if (ent[k] >= 0) tile[k] = ent[k];
    if (!lit[k]) tile[k] = A.dark;
    if (!(lit[k] && ent[k] >= 0)) hp[k] = 0;
  }
  const ck = cy * W + cx; hp[ck] = 0; tile[ck] = A.player0 + Math.min(3, Math.max(0, s.dir - 1));
  return { tile, hp, lit, entCls };
}

// THE WALKER'S VIEW (test B2's TARGET, tools/nc/craftax_symbols.py tiles()): each of the 9 × 11 tiles as a coarse class, 0 unseen, 1 open
// (you can walk on it), 2 solid, 3 useful, 4 water, 5 danger, from the same glyphs the frame draws; the player's tile takes the class of
// the item, else the block, under it
const BLOCK_COARSE = { invalid: 0, "out of bounds": 0, darkness: 0, grass: 1, sand: 1, path: 1, gravel: 1, "fire grass": 1, "ice grass": 1,
  stone: 2, tree: 2, wood: 2, wall: 2, "mossy wall": 2, stalagmite: 2, "fire tree": 2, "ice shrub": 2, grave: 2, "grave 2": 2, "grave 3": 2,
  coal: 3, iron: 3, diamond: 3, sapphire: 3, ruby: 3, "crafting table": 3, furnace: 3, plant: 3, "ripe plant": 3, chest: 3, fountain: 3,
  "fire ench. table": 3, "ice ench. table": 3, water: 4, lava: 5, necromancer: 5, "necromancer (vulnerable)": 5 };
const ITEM_COARSE = { torch: 1, "ladder down": 3, "ladder up": 3, "ladder down (blocked)": 3 };
const CLASS_COARSE = { passive: 3, melee: 5, ranged: 5, "mob projectile": 5, "your projectile": 1 };
export function viewCoarse(A, s) {
  const [H, W] = A.view, NB = A.n_blocks, MS = s.size[0], { tile, lit, entCls } = viewTiles(A, s);
  const kind = (g) => (g < NB ? BLOCK_COARSE[A.blocks[g]] : ITEM_COARSE[A.items[g - NB]]) ?? 0;
  const out = new Uint8Array(H * W), ck = (H >> 1) * W + (W >> 1);
  for (let k = 0; k < H * W; k++) out[k] = !lit[k] ? 0 : entCls[k] >= 0 ? CLASS_COARSE[A.classes[entCls[k]]] : kind(tile[k]);
  const [py, px] = s.pos, item = s.items[py * MS + px];
  out[ck] = item > 0 ? kind(NB + item - 1) : kind(s.map[py * MS + px]);
  return out;
}

/** The frame for state s (cx_state_json, parsed): Uint8Array F*F of 0/1. mode: the HUD's mode pad (0..3; training drew all four).
 *  stamp: the new player tile (needs + pickaxe corners), for crystals trained with --stamp-player. */
export function renderFrame(A, s, mode = 0, stamp = false) {
  const F = A.frame, TL = A.tile, [H, W] = A.view;
  const { tile, hp } = viewTiles(A, s);
  const fr = A.staticBits.slice(), G = A.glyphBits;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const k = r * W + c, g0 = tile[k] * TL * TL, bar = hp[k] > 0, n = Math.min(TL, Math.max(0, Math.ceil(hp[k] / 2)));
      for (let y = 0; y < TL; y++)
        for (let x = 0; x < TL; x++) {
          let b = G[g0 + y * TL + x];
          if (bar && y >= TL - 2) b = y === TL - 1 && x < n ? 1 : 0;
          fr[(r * TL + y) * F + c * TL + x] = b;
        }
    }
  hudOn(A, s, mode).forEach((on, j) => on.forEach((o, k) => { if (o) for (const p of A.pads[j][k]) fr[p] = 1; }));
  if (stamp) stampPlayer(fr, F, s);
  return fr;
}
