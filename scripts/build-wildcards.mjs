/*
 * Build prompt-wildcard .txt files from the e621 tags export.
 *
 * Refresh recipe:
 *   1. curl -A "YourApp/1.0 (by you on e621)" \
 *        https://static1.e621.net/data/db_export/tags.csv.gz -o tags.csv.gz
 *      curl -A "YourApp/1.0 (by you on e621)" \
 *        https://static1.e621.net/data/db_export/tag_implications.csv.gz -o tag_implications.csv.gz
 *   2. node scripts/build-wildcards.mjs tags.csv.gz data/wildcards tag_implications.csv.gz
 *
 * Produces e621-native files (species/pokemon/characters/artists/copyright) plus
 * thematic buckets from general tags (hair, eyes, clothing, pose, expression, body, …),
 * each ~300 tags ranked by post_count. Tags are formatted like the app's tag
 * insertion (underscores→spaces, escaped weighting parens). Tune CAP / FLOOR /
 * the bucket matcher lists below. Wildcard files are read live — no restart.
 *
 * The optional 3rd arg (tag_implications export) splits Pokémon out of `species`
 * into their own `pokemon` file — a tag is a Pokémon iff it transitively implies
 * `pokemon_(species)` (the export precomputes this in its `descendant_names` column).
 * Omit it to keep the old single-`species` behavior.
 */
import { createReadStream, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";

const SRC = process.argv[2];
const OUT = process.argv[3];
const IMPL = process.argv[4]; // optional tag_implications.csv.gz → Pokémon separation
const CAP = 300;
const FLOOR = 100; // min post_count to be eligible (kills long-tail noise)
mkdirSync(OUT, { recursive: true });

// e621 tag categories
const CAT = { general: 0, artist: 1, copyright: 3, character: 4, species: 5 };

// Administrative / meta tags that live in content categories but aren't usable
// as prompt terms — drop them everywhere.
const BLOCK = new Set([
  "conditional_dnp", "unknown_artist", "third-party_edit", "sound_warning", "anonymous_artist",
  "avoid_posting", "epilepsy_warning", "sound_edit", "self_upload", "commissioner_upload",
  "unknown_artist_signature", "unknown_editor", "unknown_colorist", "alternate_version",
  "distracting_watermark", "fan_character", "unknown_character", "unknown_species",
  "mixed_species", "voice_acted", "story_in_description", "dialogue_in_description",
]);

// --- Native-category collectors (top N by post_count) ---
// `pokemon` is carved out of the species category (see IMPL handling below).
const native = {
  species: { cat: CAT.species, items: [] },
  pokemon: { cat: CAT.species, items: [] },
  characters: { cat: CAT.character, items: [] },
  artists: { cat: CAT.artist, items: [] },
  copyright: { cat: CAT.copyright, items: [] },
};

// --- Thematic buckets from GENERAL tags (first match wins; order = priority) ---
const B = (name, opts) => ({ name, ...opts, items: [] });
const buckets = [
  // suffix-based (clean)
  B("hair", { suffix: ["_hair"] }),
  B("eyes", { suffix: ["_eyes"] }),
  B("ears", { suffix: ["_ears"] }),
  B("tail", { suffix: ["_tail"] }),
  B("wings", { suffix: ["_wings"] }),
  B("horns", { suffix: ["_horn", "_horns"] }),
  B("background", { suffix: ["_background"] }),
  // keyword/phrase-based
  B("clothing", {
    words: ["shirt","t-shirt","dress","skirt","miniskirt","bikini","swimsuit","lingerie","underwear","bra","panties","thong","shorts","pants","jeans","jacket","coat","hoodie","sweater","uniform","kimono","leotard","stockings","thighhighs","pantyhose","gloves","hat","cap","beanie","collar","necktie","tie","bowtie","scarf","apron","robe","bodysuit","corset","socks","boots","shoes","heels","sandals","glasses","sunglasses","choker","harness","cape","cloak","armor","overalls","garter","veil","headband","ribbon","suspenders","belt","jockstrap","briefs","boxers","bikini_top","bikini_bottom","kneesocks"],
    phrases: ["crop_top","tank_top","tube_top","sports_bra","dress_shirt","school_uniform"],
  }),
  B("pose", {
    phrases: ["standing","sitting","lying","kneeling","crouching","squatting","all_fours","on_back","on_front","on_side","on_stomach","bent_over","arched_back","spread_legs","spread_arms","legs_up","legs_apart","crossed_legs","crossed_arms","arms_up","arms_behind_back","arms_behind_head","hand_on_hip","hands_on_hips","stretching","walking","running","jumping","presenting","looking_back","looking_at_viewer","looking_away","looking_down","looking_up","leaning","reclining","fetal_position","straddling","top_down_bottom_up","face_down_ass_up","doggystyle","missionary","bowing","curled_up","tiptoes","action_pose","dynamic_pose","combat_stance","kneeling"],
  }),
  B("expression", {
    words: ["smile","grin","blush","frown","wink","pout","tears","drooling","laughing","ahegao","moaning","smug","happy","sad","angry","worried","nervous","embarrassed","seductive","surprised","shocked","scared","yawning","screaming","pouting"],
    phrases: ["open_mouth","closed_eyes","half-closed_eyes","narrowed_eyes","tongue_out","licking_lips","bedroom_eyes","gritted_teeth","clenched_teeth","one_eye_closed","raised_eyebrow","expressionless","teary_eyes","sweatdrop"],
  }),
  B("body", {
    words: ["muscular","chubby","overweight","obese","slim","slender","curvy","voluptuous","abs","toned","athletic","petite","thick","plump","busty","buff","belly","pecs","biceps","fit","hourglass"],
    phrases: ["thick_thighs","wide_hips","big_breasts","huge_breasts","hyper_breasts","small_breasts","flat_chested","big_butt","huge_butt","hourglass_figure","muscular_thighs","big_belly","dad_bod","six-pack_abs"],
  }),
  B("view", {
    phrases: ["from_above","from_below","from_behind","from_side","from_front","close-up","wide_shot","cowboy_shot","full-length_portrait","portrait","upper_body","lower_body","dutch_angle","low-angle_view","high-angle_view","first-person_perspective","three-quarter_view","front_view","side_view","back_view","rear_view","fisheye","pov"],
  }),
  B("setting", {
    words: ["forest","beach","bedroom","bathroom","kitchen","city","cityscape","street","indoors","outdoors","park","pool","shower","bed","sky","night","sunset","sunrise","snow","rain","desert","jungle","cave","mountain","mountains","river","lake","ocean","underwater","field","meadow","garden","urban","alley","rooftop","classroom","office","bar","cafe","gym","dungeon","castle","temple","space","moon","waterfall","cliff","tent"],
    phrases: ["living_room","swimming_pool","on_bed","hot_spring","locker_room","forest_background","nature_background"],
  }),
];

function matchBucket(tag, toks) {
  for (const b of buckets) {
    if (b.suffix && b.suffix.some((s) => tag.endsWith(s))) return b;
    if (b.words) { for (const t of toks) if (b.words.includes(t)) return b; }
    if (b.phrases) { for (const p of b.phrases) if (tag.includes(p)) return b; }
  }
  return null;
}
// Pre-index word arrays as Sets for speed
for (const b of buckets) if (b.words) b.wordSet = new Set(b.words);
function matchBucketFast(tag, toks) {
  // Boundary-padded so a phrase only matches whole underscore-delimited tokens
  // ("_leaning_" won't hit "cleaning", "_lying_" won't hit "flying").
  const padded = `_${tag}_`;
  for (const b of buckets) {
    if (b.suffix && b.suffix.some((s) => tag.endsWith(s))) return b;
    if (b.wordSet) { for (const t of toks) if (b.wordSet.has(t)) return b; }
    if (b.phrases) { for (const p of b.phrases) if (padded.includes(`_${p}_`)) return b; }
  }
  return null;
}

// --- Pokémon detection (optional) --------------------------------------------
// A tag is a Pokémon iff it transitively implies `pokemon_(species)`. e621's
// tag_implications export precomputes that closure in its `descendant_names`
// column, so we just collect the antecedent (col 1) of every active row whose
// line mentions `pokemon_(species)`.
const POKE_MARK = "pokemon_(species)";
const pokemonTags = new Set([POKE_MARK]);
if (IMPL) {
  const irl = createInterface({ input: createReadStream(IMPL).pipe(createGunzip()), crlfDelay: Infinity });
  let ifirst = true;
  for await (const line of irl) {
    if (ifirst) { ifirst = false; continue; } // header
    if (!line || !line.includes(POKE_MARK)) continue;
    // id,antecedent,consequent,created_at,status,…  (first 5 cols have no commas)
    const a1 = line.indexOf(",");
    const a2 = line.indexOf(",", a1 + 1);
    const a3 = line.indexOf(",", a2 + 1);
    const a4 = line.indexOf(",", a3 + 1);
    const a5 = line.indexOf(",", a4 + 1);
    const antecedent = line.slice(a1 + 1, a2);
    const status = line.slice(a4 + 1, a5);
    if (status === "active" && antecedent) pokemonTags.add(antecedent);
  }
  console.log(`loaded ${pokemonTags.size} pokemon tags from implications\n`);
}

const rl = createInterface({ input: createReadStream(SRC).pipe(createGunzip()), crlfDelay: Infinity });
let first = true;
let n = 0;
for await (const line of rl) {
  if (first) { first = false; continue; } // header
  if (!line) continue;
  // id,name,category,post_count,created_at,updated_at,is_locked  (names never contain commas)
  const c1 = line.indexOf(",");
  const c2 = line.indexOf(",", c1 + 1);
  const c3 = line.indexOf(",", c2 + 1);
  const c4 = line.indexOf(",", c3 + 1);
  const name = line.slice(c1 + 1, c2);
  const category = Number(line.slice(c2 + 1, c3));
  const count = Number(line.slice(c3 + 1, c4));
  if (!name || !Number.isFinite(count) || count < FLOOR) continue;
  if (BLOCK.has(name)) continue;
  n++;

  // Native categories (Pokémon split out of species via the implications closure)
  if (category === CAT.species) {
    (IMPL && pokemonTags.has(name) ? native.pokemon : native.species).items.push([name, count]);
  }
  else if (category === CAT.character) native.characters.items.push([name, count]);
  else if (category === CAT.artist) native.artists.items.push([name, count]);
  else if (category === CAT.copyright) native.copyright.items.push([name, count]);
  else if (category === CAT.general) {
    const toks = name.split(/[_]+/);
    const b = matchBucketFast(name, toks);
    if (b) b.items.push([name, count]);
  }
}

// Format like the app's tag insertion: underscores→spaces, escape weighting parens.
const fmt = (tag) => tag.replace(/_/g, " ").replace(/([()])/g, "\\$1");

function emit(label, items) {
  items.sort((a, b) => b[1] - a[1]);
  const top = items.slice(0, CAP);
  const header = `# ${label} · top ${top.length} e621 tags by post count (auto-generated)\n`;
  const body = top.map(([t]) => fmt(t)).join("\n") + "\n";
  writeFileSync(join(OUT, `${label}.txt`), header + body, "utf8");
  return { label, total: items.length, kept: top.length, sample: top.slice(0, 8).map(([t]) => fmt(t)) };
}

const summary = [];
for (const key of Object.keys(native)) {
  if (native[key].items.length === 0) continue; // e.g. pokemon when no implications given
  summary.push(emit(key, native[key].items));
}
for (const b of buckets) summary.push(emit(b.name, b.items));

console.log(`scanned ${n} tags (>= ${FLOOR} posts)\n`);
for (const s of summary) {
  console.log(`${s.label.padEnd(12)} kept ${String(s.kept).padStart(3)}/${String(s.total).padStart(6)}  e.g. ${s.sample.join(", ")}`);
}
console.log("\nfiles:", readdirSync(OUT).join(", "));
