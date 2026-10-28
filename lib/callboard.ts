// Call board: every token called by the followed Telegram channels in the last 24h, how many channels
// called it, its market cap when we first saw the call, and how it did since. Works on the worker
// (shared for everyone) and in the browser (no worker configured), with storage passed in.

import type { CallsResponse } from "./calls";
import type { TokenLookup } from "./types";

const KEEP_MS = 24 * 3600_000;
const STORE_KEY = "tns.callboard.v1";

export interface CallEntry {
  mint: string;
  firstAt: number; // earliest call time across channels
  callers: Record<string, number>; // channel -> its first call time
  name?: string;
  symbol?: string;
  image?: string;
  pairUrl?: string;
  baseFdv?: number; // FDV when we first priced the call (at or shortly after the call)
  baseAt?: number;
  baseLate?: boolean; // the call happened before we were watching, no FDV at call
  fdv?: number;
  peakFdv?: number;
  liquidityUsd?: number;
  updatedAt?: number;
}

export interface CallboardState {
  entries: CallEntry[];
  channels: CallsResponse["channels"];
  updatedAt: number;
  error: string | null;
}

export function createCallboard(opts: {
  api: (path: string) => Promise<Response>;
  storage: { get(k: string): string | null; set(k: string, v: string): void };
}) {
  const map = new Map<string, CallEntry>();
  let channels: CallsResponse["channels"] = [];
  let updatedAt = 0;
  let error: string | null = null;

  try {
    const raw = opts.storage.get(STORE_KEY);
    if (raw) for (const e of JSON.parse(raw) as CallEntry[]) map.set(e.mint, e);
  } catch {
    /* fresh */
  }

  const refresh = async () => {
    try {
      const r = await opts.api("/api/calls");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as CallsResponse;
      channels = j.channels;
      for (const c of j.calls) {
        let e = map.get(c.mint);
        if (!e) map.set(c.mint, (e = { mint: c.mint, firstAt: c.at, callers: {} }));
        e.firstAt = Math.min(e.firstAt, c.at);
        e.callers[c.channel] = Math.min(e.callers[c.channel] ?? Infinity, c.at);
      }
      const now = Date.now();
      for (const [k, e] of map) if (now - e.firstAt > KEEP_MS) map.delete(k);

      // Price the newest calls (DexScreener takes 30 addresses per request).
      const todo = [...map.values()].sort((a, b) => b.firstAt - a.firstAt).slice(0, 120);
      for (let i = 0; i < todo.length; i += 30) {
        const batch = todo.slice(i, i + 30);
        const tr = await opts.api(`/api/tokens?addresses=${batch.map((e) => e.mint).join(",")}`);
        if (!tr.ok) continue;
        const tj = (await tr.json()) as { tokens: TokenLookup[] };
        for (const t of tj.tokens ?? []) {
          const e = map.get(t.address);
          if (!e || !t.fdvUsd) continue;
          e.name = t.name;
          e.symbol = t.symbol;
          e.image = e.image ?? t.image;
          e.pairUrl = t.pairUrl;
          e.liquidityUsd = t.liquidityUsd;
          e.fdv = t.fdvUsd;
          // Only trust a baseline priced within 15 min of the call; older calls have no honest "at call" price.
          if (e.baseFdv == null && !e.baseLate) {
            if (now - e.firstAt <= 15 * 60_000) {
              e.baseFdv = t.fdvUsd;
              e.baseAt = now;
            } else e.baseLate = true;
          }
          if (e.baseFdv != null) e.peakFdv = Math.max(e.peakFdv ?? 0, t.fdvUsd);
          e.updatedAt = now;
        }
      }
      // Entries DexScreener never knew (wallet addresses, typos) are dropped after 30 min.
      for (const [k, e] of map) if (!e.name && now - e.firstAt > 30 * 60_000) map.delete(k);

      updatedAt = now;
      error = null;
      opts.storage.set(STORE_KEY, JSON.stringify([...map.values()]));
    } catch (e) {
      error = (e as Error).message;
    }
  };

  const state = (): CallboardState => ({
    entries: [...map.values()]
      .filter((e) => e.name)
      .sort((a, b) => Object.keys(b.callers).length - Object.keys(a.callers).length || b.firstAt - a.firstAt),
    channels,
    updatedAt,
    error,
  });

  return { refresh, state };
}
