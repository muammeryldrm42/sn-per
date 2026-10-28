"use client";

// No shared worker configured: run the same engine (lib/core.ts) inside this browser tab.
// Price data goes straight to DexScreener and CoinGecko (both allow browser requests), so a busy page does not
// burn the site's own API calls. Returns the same shape as useRemoteEngine.

import { useEffect, useState } from "react";
import { createCore, type CoreState } from "./core";
import { createTicker } from "./ticker";
import { createSmartBook } from "./smart";
import { lookupTokens } from "./dex";

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or blocked */
    }
  },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function api(path: string): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (url.pathname === "/api/tokens") {
    const list = (url.searchParams.get("addresses") || "").split(",").filter(Boolean);
    try {
      return json({ tokens: await lookupTokens(list) });
    } catch {
      return fetch(path); // fall back to the site route
    }
  }
  if (url.pathname === "/api/sol") {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
      const j = await r.json();
      if (typeof j?.solana?.usd === "number") return json({ solUsd: j.solana.usd });
    } catch {
      /* fall back */
    }
  }
  return fetch(path);
}

const EMPTY: CoreState = {
  narratives: null,
  narrError: null,
  signals: [],
  hits: {},
  stats: { ws: "connecting", seen: 0, perMin: 0, matched: 0, unnamedPending: 0 },
  fresh: [],
  watch: [],
  graduations: 0,
  calls: [],
  radar: 0,
  solUsd: null,
};

export function useLocalCore() {
  const [state, setState] = useState<CoreState>(EMPTY);

  useEffect(() => {
    const ticker = createTicker();
    const core = createCore({
      api,
      storage,
      every: ticker.every,
      after: ticker.after,
      smart: createSmartBook(storage, 15_000),
      onFlush: (s) => setState(s),
    });
    return () => {
      core.stop();
      ticker.close();
    };
  }, []);

  return {
    ...state,
    workerError: null as string | null,
    role: "leader" as const,
    clearHistory: null as null | (() => void),
    setWatch: null as null | ((w: string[]) => void),
  };
}
