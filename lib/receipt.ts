// Server side: one call from the shared worker, for share pages and their preview images.
import type { CallRow } from "./archive";

const WORKER = (process.env.NEXT_PUBLIC_WORKER_URL || "").replace(/\/$/, "");

export async function getCall(mint: string): Promise<CallRow | null> {
  if (!WORKER || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  try {
    const r = await fetch(`${WORKER}/call?m=${mint}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { call?: CallRow };
    return j.call ?? null;
  } catch {
    return null;
  }
}

export function shortUsd(n: number) {
  if (!isFinite(n)) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export function shortX(x: number) {
  if (!isFinite(x) || x <= 0) return "-";
  return x >= 100 ? `${Math.round(x)}x` : x >= 10 ? `${x.toFixed(1)}x` : `${x.toFixed(2)}x`;
}
