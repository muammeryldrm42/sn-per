// Smart wallets, learned from the chain. No bought or copied lists: a wallet becomes "smart" by repeatedly
// being an early buyer (first 10 min) of tokens that went on to 3x or more, at a decent hit rate.
// The book learns from every token whose early buyers we read (signals, and on the worker a sample of all
// launches). The watcher (worker only) then polls the top smart wallets and flags tokens that several of
// them buy within a short time.

import { inBatches, rpc, TX_OPTS, type EarlyWallet, type ParsedTx, type SigInfo } from "./cohort";

export const WIN_X = 3;
// Second live recording: with 2 wins at 25% the book filled with sniper bots (wallets that buy almost every
// launch get 2 lucky wins), and tokens with 5+ such "smart" buyers did worse than average. Stricter now:
// 3+ wins, a 30%+ hit rate, at least 5 settled tokens.
export const SMART_MIN_WINS = 3;
export const SMART_MIN_RATE = 0.3;
export const SMART_MIN_SEEN = 5;

const BOOK_KEY = "tns.smartbook.v1";

// Wallets you know yourself (comma separated in SMART_WALLETS). They count as smart from the start.
export function seedWallets(): string[] {
  const raw = (typeof process !== "undefined" && (process.env.SMART_WALLETS || process.env.NEXT_PUBLIC_SMART_WALLETS)) || "";
  return [...new Set(raw.split(",").map((w) => w.trim()).filter((w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)))];
}
const PENDING_TTL = 6 * 3600_000;
const STALE_MS = 3 * 24 * 3600_000;

export interface WalletRec {
  seen: number; // settled tokens it bought early
  wins: number; // of those, how many reached WIN_X
  best: number; // best peak multiple among wins
  last: number;
  recent: string[]; // last winning mints
}

interface Pending {
  at: number;
  wallets: string[];
}

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

export interface SmartWalletRow {
  wallet: string;
  wins: number;
  seen: number;
  rate: number;
  best: number;
  last: number;
  seed?: boolean; // added by you, not learned
}

export function createSmartBook(storage: Store, maxWallets = 150_000) {
  const wallets = new Map<string, WalletRec>();
  const pending = new Map<string, Pending>();

  try {
    const raw = storage.get(BOOK_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { w: [string, WalletRec][]; p: [string, Pending][] };
      for (const [k, v] of j.w ?? []) wallets.set(k, v);
      for (const [k, v] of j.p ?? []) pending.set(k, v);
    }
  } catch {
    /* fresh book */
  }

  const seeds = new Set(seedWallets());
  const isSmart = (w: string) => {
    if (seeds.has(w)) return true;
    const r = wallets.get(w);
    return !!r && r.seen >= SMART_MIN_SEEN && r.wins >= SMART_MIN_WINS && r.wins / r.seen >= SMART_MIN_RATE;
  };
  // Wallets of one operator move together (same wins, same tokens). Two smart wallets that share 2+ of their
  // recent wins count as one, so "2+ smart wallets" means two independent buyers.
  const independent = (ws: string[]) => {
    const kept: string[] = [];
    for (const w of ws) {
      const mine = new Set(wallets.get(w)?.recent ?? []);
      const twin = kept.some((k) => (wallets.get(k)?.recent ?? []).filter((m) => mine.has(m)).length >= 2);
      if (!twin) kept.push(w);
    }
    return kept;
  };

  return {
    // Remember who bought this token early; insiders (bundlers, dev-funded) never count.
    observe(mint: string, early: EarlyWallet[] | undefined) {
      if (!early?.length) return;
      const ws = early.filter((e) => !e.bundler && !e.linked).map((e) => e.w);
      const p = pending.get(mint);
      if (p) p.wallets = [...new Set([...p.wallets, ...ws])].slice(0, 80);
      else pending.set(mint, { at: Date.now(), wallets: ws.slice(0, 80) });
    },

    // The token's outcome is known: credit or debit every early buyer.
    settle(mint: string, peakX: number) {
      const p = pending.get(mint);
      if (!p) return;
      pending.delete(mint);
      const now = Date.now();
      for (const w of p.wallets) {
        const r = wallets.get(w) ?? { seen: 0, wins: 0, best: 0, last: now, recent: [] };
        r.seen++;
        r.last = now;
        if (peakX >= WIN_X) {
          r.wins++;
          r.best = Math.max(r.best, Math.round(peakX * 10) / 10);
          r.recent = [mint, ...r.recent.filter((m) => m !== mint)].slice(0, 8);
        }
        wallets.set(w, r);
      }
    },

    pendingMints(minAgeMs: number): { mint: string; at: number }[] {
      const now = Date.now();
      return [...pending.entries()].filter(([, p]) => now - p.at >= minAgeMs).map(([mint, p]) => ({ mint, at: p.at }));
    },

    has(mint: string) {
      return pending.has(mint);
    },

    isSmart,

    smartAmong(ws: string[]) {
      return independent(ws.filter(isSmart));
    },
    independent,

    leaderboard(n = 50): SmartWalletRow[] {
      const rows: SmartWalletRow[] = [];
      for (const w of seeds) {
        const r = wallets.get(w);
        rows.push({ wallet: w, wins: r?.wins ?? 0, seen: r?.seen ?? 0, rate: r && r.seen ? r.wins / r.seen : 0, best: r?.best ?? 0, last: r?.last ?? 0, seed: true });
      }
      for (const [w, r] of wallets) {
        if (seeds.has(w) || !isSmart(w)) continue;
        rows.push({ wallet: w, wins: r.wins, seen: r.seen, rate: r.wins / r.seen, best: r.best, last: r.last });
      }
      return rows.sort((a, b) => Number(!!b.seed) - Number(!!a.seed) || b.wins - a.wins || b.rate - a.rate).slice(0, n);
    },

    stats() {
      let smart = seeds.size;
      for (const w of wallets.keys()) if (!seeds.has(w) && isSmart(w)) smart++;
      return { tracked: wallets.size, smart, seeds: seeds.size, pending: pending.size };
    },

    persist() {
      const now = Date.now();
      for (const [k, p] of pending) if (now - p.at > PENDING_TTL) pending.delete(k);
      // One-off wallets that never won are noise after a few days.
      for (const [k, r] of wallets) if (r.wins === 0 && now - r.last > STALE_MS) wallets.delete(k);
      if (wallets.size > maxWallets) {
        const keep = [...wallets.entries()].sort((a, b) => b[1].wins - a[1].wins || b[1].last - a[1].last).slice(0, maxWallets);
        wallets.clear();
        for (const [k, v] of keep) wallets.set(k, v);
      }
      try {
        storage.set(BOOK_KEY, JSON.stringify({ w: [...wallets.entries()], p: [...pending.entries()] }));
      } catch {
        /* storage full */
      }
    },
  };
}

export type SmartBook = ReturnType<typeof createSmartBook>;

export interface SmartBuy {
  mint: string;
  firstAt: number; // first smart buy
  clusterAt?: number; // when the second smart wallet bought
  wallets: Record<string, number>; // wallet -> buy time
  name?: string;
  symbol?: string;
  baseFdv?: number; // FDV when the cluster formed
  fdv?: number;
  peakFdv?: number;
  liquidityUsd?: number;
}

const IGNORE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

// Polls the top smart wallets and reports tokens that 2+ of them bought within 30 minutes. Worker only.
export function createSmartWatcher(
  book: SmartBook,
  opts: { watch?: number; windowMs?: number; onTx?: (wallet: string, sig: string, tx: ParsedTx) => void } = {}
) {
  const WATCH = opts.watch ?? 40;
  const WINDOW = opts.windowMs ?? 30 * 60_000;
  const lastSig = new Map<string, string>();
  const buys = new Map<string, SmartBuy>();

  const poll = async () => {
    const top = book.leaderboard(WATCH).map((r) => r.wallet);
    const now = Date.now();
    const fresh: { w: string; sig: string }[] = [];
    await inBatches(top, 5, async (w) => {
      const until = lastSig.get(w);
      const sigs = await rpc<SigInfo[]>("getSignaturesForAddress", [w, { limit: 15, ...(until ? { until } : {}) }]);
      if (!sigs || !sigs.length) return;
      lastSig.set(w, sigs[0].signature);
      if (!until) return; // first poll only sets the cursor
      for (const s of sigs) if (!s.err && s.blockTime && now - s.blockTime * 1000 < WINDOW) fresh.push({ w, sig: s.signature });
    });
    await inBatches(fresh.slice(0, 40), 6, async ({ w, sig }) => {
      const tx = await rpc<ParsedTx>("getTransaction", [sig, TX_OPTS]);
      if (!tx?.meta || tx.meta.err) return;
      opts.onTx?.(w, sig, tx);
      const delta = new Map<string, number>();
      for (const b of tx.meta.postTokenBalances ?? []) if (b.owner === w) delta.set(b.mint, (delta.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
      for (const b of tx.meta.preTokenBalances ?? []) if (b.owner === w) delta.set(b.mint, (delta.get(b.mint) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
      for (const [mint, d] of delta) {
        if (d <= 0 || IGNORE_MINTS.has(mint)) continue;
        const e = buys.get(mint) ?? { mint, firstAt: now, wallets: {} };
        if (!e.wallets[w]) e.wallets[w] = now;
        e.firstAt = Math.min(e.firstAt, e.wallets[w]);
        if (!e.clusterAt && Object.keys(e.wallets).length >= 2) e.clusterAt = now;
        buys.set(mint, e);
      }
    });
    for (const [k, e] of buys) if (now - e.firstAt > 24 * 3600_000) buys.delete(k);
  };

  return {
    poll,
    clusters(): SmartBuy[] {
      return [...buys.values()].filter((b) => b.clusterAt).sort((a, b) => (b.clusterAt ?? 0) - (a.clusterAt ?? 0));
    },
    walletsFor(mint: string): string[] {
      return Object.keys(buys.get(mint)?.wallets ?? {});
    },
    all(): SmartBuy[] {
      return [...buys.values()];
    },
  };
}
