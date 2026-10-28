// Named KOL wallets. The list comes from kolscan.io's public leaderboard page (wallet, name, X and Telegram links,
// realized profit), refreshed twice a day and cached, plus anything you add in KOL_WALLETS ("name:wallet,...").
// Only the list is taken; trades are read from the chain (or PumpPortal) by the worker itself.

export interface Kol {
  w: string; // wallet
  name: string;
  x?: string; // X profile url
  tg?: string;
  pnl?: number; // best realized profit (SOL) across the leaderboard timeframes
  wins?: number;
  losses?: number;
  src: "kolscan" | "env";
}

const KEY = "tns.kols.v1";
const REFRESH_MS = 12 * 3600_000;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

// The leaderboard page embeds its data as escaped JSON in the Next.js payload: leaderboard rows (with profit)
// and a directory of every listed KOL (wallet, name, X, Telegram). Fields are read one by one, so a new or
// missing field does not break the parse.
export function parseKolscan(html: string): Kol[] {
  const out = new Map<string, Kol>();
  const field = (o: string, k: string) => o.match(new RegExp(`\\\\"${k}\\\\":(null|-?[\\d.eE+-]+|\\\\"((?:[^\\\\"]|\\\\\\\\.)*)\\\\")`));
  const str = (o: string, k: string) => {
    const m = field(o, k);
    if (!m || m[1] === "null" || m[2] == null) return undefined;
    return m[2].replace(/\\\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, "") || undefined;
  };
  const num = (o: string, k: string) => {
    const m = field(o, k);
    return m && m[2] == null && m[1] !== "null" ? Number(m[1]) : undefined;
  };
  for (const [o] of html.matchAll(/\{\\"wallet_address\\":[^{}]{0,600}\}/g)) {
    const w = str(o, "wallet_address");
    if (!w || !B58.test(w)) continue;
    const cur = out.get(w) ?? { w, name: "", src: "kolscan" as const };
    cur.name = cur.name || str(o, "name") || "";
    cur.x = cur.x ?? str(o, "twitter");
    cur.tg = cur.tg ?? str(o, "telegram");
    const p = num(o, "profit");
    if (p != null && p > (cur.pnl ?? -Infinity)) Object.assign(cur, { pnl: p, wins: num(o, "wins"), losses: num(o, "losses") });
    out.set(w, cur);
  }
  return [...out.values()]
    .map((k) => ({ ...k, name: k.name || `${k.w.slice(0, 4)}...${k.w.slice(-4)}` }))
    .sort((a, b) => (b.pnl ?? -1e9) - (a.pnl ?? -1e9));
}

function envKols(): Kol[] {
  const raw = (typeof process !== "undefined" && process.env.KOL_WALLETS) || "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.lastIndexOf(":");
      const name = i > 0 ? p.slice(0, i).trim() : "";
      const w = (i > 0 ? p.slice(i + 1) : p).trim();
      return { w, name: name || `${w.slice(0, 4)}...${w.slice(-4)}`, src: "env" as const };
    })
    .filter((k) => B58.test(k.w));
}

export function createKolBook(storage: Store) {
  let list: Kol[] = [];
  let at = 0;
  let error: string | null = null;
  try {
    const j = JSON.parse(storage.get(KEY) || "null") as { at: number; list: Kol[] } | null;
    if (j?.list) {
      list = j.list;
      at = j.at;
    }
  } catch {
    /* empty */
  }

  const merged = () => {
    const map = new Map<string, Kol>();
    for (const k of list) map.set(k.w, k);
    for (const k of envKols()) map.set(k.w, { ...map.get(k.w), ...k });
    return [...map.values()];
  };
  let byWallet = new Map(merged().map((k) => [k.w, k]));

  const refresh = async (force = false) => {
    if (!force && Date.now() - at < REFRESH_MS && list.length) return;
    try {
      const r = await fetch("https://kolscan.io/leaderboard", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TalonsCalls/1.0)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`kolscan ${r.status}`);
      const next = parseKolscan(await r.text());
      if (next.length < 10) throw new Error("kolscan list looks empty");
      list = next;
      at = Date.now();
      error = null;
      storage.set(KEY, JSON.stringify({ at, list }));
    } catch (e) {
      error = (e as Error).message;
    }
    byWallet = new Map(merged().map((k) => [k.w, k]));
  };

  return {
    refresh,
    all: () => [...byWallet.values()],
    get: (w: string) => byWallet.get(w),
    has: (w: string) => byWallet.has(w),
    stats: () => ({ kols: byWallet.size, updatedAt: at, error }),
  };
}

export type KolBook = ReturnType<typeof createKolBook>;
