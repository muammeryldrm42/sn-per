export type EntryKind = "phrase" | "headline" | "token";

export interface RawEntry {
  text: string;
  kind: EntryKind;
  source: string;
  weight: number;
  symbol?: string;
}

export interface NarrativeTerm {
  term: string;
  display: string;
  weight: number;
  sources: string[];
  context: string;
}

export const compact = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Common English words plus generic headline filler. Terms in here never become narratives.
const STOP = new Set(
  (
    "the and for with from that this what when where which who whom whose why how are was were will would could should " +
    "have has had not but you your our their them they his her its she him all any can may more most new now one two " +
    "three first last over under after before about into out off than then there here just also some such very still " +
    "says said say gets get got make makes made take takes took see seen show shows look looks back down year years " +
    "day days week weeks month months time times today tonight news live update updates report reports video watch " +
    "photos photo breaking official people man woman men women kid kids home world state states city country " +
    "high low big top best worst less amid against during while since until near far game games " +
    "season team teams win wins won lose loses lost vs final finals open opens close closes plan plans deal deals " +
    "price prices market markets stock stocks rate rates biggest major record like help need want know second " +
    "free full inside death dead dies killed calls call told tells claims claim might must being been every " +
    "latest early late long short part parts way ways thing things something nothing everything " +
    "january february march april june july august september october november december " +
    "match matches total cup champions met politics lawyer court judge fraud suspension league review reviews releases recall scheme police " +
    "official trailer teaser music lyrics lyric audio remix feat ft episode ep full highlights reaction reacts " +
    "shorts vlog challenge edition version visualizer performance podcast netflix hbo a24 hd 4k " +
    "former remains brothers house next white black red blue green supports support slow amid reveals reveal revealed hits hit fans fan star stars " +
    "monday tuesday wednesday thursday friday saturday sunday"
  ).split(" ")
);

// Chain and quote words that would match half of all launches.
const BLOCK = new Set([
  "sol", "solana", "usd", "usdc", "usdt", "wsol", "wrapped", "token", "coin", "coins", "meme", "memes",
  "pump", "pumpfun", "bonk", "inu", "cto", "dao", "fun", "moon",
]);

// Everyday words and meme staples. They can still match, but they say little about a *new* narrative.
export const GENERIC = new Set(
  (
    "life love hot cold party random money cash rich king queen baby dog cat frog bird fish bear bull moon star " +
    "fire ice gold diamond happy sad little based chad degen alpha god man boy girl mom dad bro friend friends " +
    "world earth time night game play win run jump fly dream magic power energy vibe vibes good bad cool nice " +
    "super mega ultra max pro real true fake crazy wild lucky luck fortune chill smile cute sweet dark light " +
    "red black white green blue pink purple orange yellow golden silver number first last only just peace " +
    "doge shib pepe wojak elon hope family home heart soul mind spirit rocket lambo gem send hold hodl buy " +
    "sell token coin chart green candle ape apes monkey penguin dragon tiger lion wolf shark whale ghost " +
    "angel devil zombie alien robot ninja pirate cowboy hero boss legend meme memes internet community"
  ).split(" ")
);

function add(
  map: Map<string, NarrativeTerm>,
  key: string,
  display: string,
  weight: number,
  source: string,
  context: string
) {
  if (key.length < 3 || key.length > 24) return;
  if (STOP.has(key) || BLOCK.has(key) || /^\d+$/.test(key)) return;
  const cur = map.get(key);
  if (cur) {
    cur.weight += weight;
    if (!cur.sources.includes(source)) cur.sources.push(source);
  } else {
    map.set(key, { term: key, display, weight, sources: [source], context });
  }
}

export function buildDictionary(entries: RawEntry[], limit = 400): NarrativeTerm[] {
  const map = new Map<string, NarrativeTerm>();

  for (const e of entries) {
    const text = (e.text || "").trim();
    if (!text) continue;

    if (e.kind === "token") {
      add(map, compact(text), text, e.weight, e.source, text);
      if (e.symbol) add(map, compact(e.symbol), e.symbol.toUpperCase(), e.weight, e.source, text);
      continue;
    }

    if (e.kind === "phrase") {
      // Keep multi-word trends whole: splitting "antonio brown" into "brown" matches too much junk.
      if (text.split(/\s+/).length <= 3) add(map, compact(text), text, e.weight, e.source, text);
      continue;
    }

    // headline: proper nouns and short runs of capitalised words
    const clean = text.replace(/\s[-|]\s[^-|]+$/, "");
    const words = clean.split(/\s+/);
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 2 && run.length <= 3) {
        add(map, compact(run.join("")), run.join(" "), e.weight, e.source, clean);
      }
      run = [];
    };
    for (const raw of words) {
      const w = raw.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9]+$/g, "").replace(/['’]s$/i, "");
      const c = compact(w);
      if (/^[A-Z$]/.test(w) && c.length >= 3 && !STOP.has(c)) {
        add(map, c, w, e.weight, e.source, clean);
        run.push(w);
      } else {
        flush();
      }
    }
    flush();
  }

  return [...map.values()]
    .filter((t) => t.weight >= 2)
    .map((t) => ({ ...t, weight: Math.round(t.weight * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export interface Match {
  term: NarrativeTerm;
  kind: "exact" | "word" | "contains" | "fuzzy";
  strength: number;
  generic?: boolean;
}

export class Matcher {
  private exact = new Map<string, NarrativeTerm>();
  private long: NarrativeTerm[] = [];

  constructor(terms: NarrativeTerm[]) {
    for (const t of terms) {
      this.exact.set(t.term, t);
      if (t.term.length >= 5) this.long.push(t);
    }
  }

  get size() {
    return this.exact.size;
  }

  match(name: string, symbol: string): Match | null {
    const nm = compact(name);
    const sy = compact(symbol);
    const cands: Match[] = [];

    for (const k of [sy, nm]) {
      if (k.length < 3) continue;
      const t = this.exact.get(k);
      if (t) cands.push({ term: t, kind: "exact", strength: 1 });
    }

    if (!cands.length) {
      for (const w of name.split(/[^A-Za-z0-9]+/)) {
        const c = compact(w);
        if (c.length < 3) continue;
        const t = this.exact.get(c);
        if (t) cands.push({ term: t, kind: "word", strength: 0.85 });
      }
    }

    // Always check multi-word phrases too, so "Antonio Brown Coin" beats a bare "Antonio".
    {
      for (const t of this.long) {
        // Substring matches need a longer term, otherwise "match" hits "Matcha".
        if (t.term.length < 6) continue;
        if (nm.includes(t.term) || (sy.length >= 6 && sy.includes(t.term))) {
          cands.push({ term: t, kind: "contains", strength: 0.7 });
        }
      }
    }

    if (!cands.length && sy.length >= 5) {
      for (const t of this.long) {
        if (Math.abs(t.term.length - sy.length) <= 1 && lev(t.term, sy) <= 1) {
          cands.push({ term: t, kind: "fuzzy", strength: 0.5 });
        }
      }
    }

    if (!cands.length) return null;
    for (const c of cands) {
      // Your own watch words are never discounted.
      if (GENERIC.has(c.term.term) && !c.term.sources.includes("watchlist")) {
        c.generic = true;
        c.strength *= 0.4;
      }
    }
    return cands.sort((a, b) => b.term.weight * b.strength - a.term.weight * a.strength)[0];
  }
}
