import { NextResponse } from "next/server";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

interface GtPool {
  attributes: {
    name: string;
    address: string;
    pool_created_at: string;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    reserve_in_usd: string | null;
    price_change_percentage: Record<string, string>;
    transactions: Record<string, { buys: number; sells: number; buyers?: number; sellers?: number }>;
    volume_usd: Record<string, string>;
  };
  relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
}

export interface Heater {
  mint: string;
  pool: string;
  name: string;
  dex: string;
  createdAt: number;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  change5m: number;
  change1h: number;
  buys5m: number;
  sells5m: number;
  buyers5m: number;
  volume5m: number;
  heat: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

// Young Solana pools that are heating up right now, from GeckoTerminal (5 min trending + newest pools).
export async function GET() {
  const urls = [
    "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=5m&page=1",
    "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=5m&page=2",
    "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1",
    "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=2",
  ];
  const res = await Promise.allSettled(
    urls.map(async (u) => {
      const r = await fetch(u, { headers: UA, next: { revalidate: 45 }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`gecko ${r.status}`);
      return ((await r.json()).data ?? []) as GtPool[];
    })
  );
  if (!res.some((r) => r.status === "fulfilled")) {
    return NextResponse.json({ heaters: [], error: "GeckoTerminal unavailable" }, { status: 502 });
  }
  const now = Date.now();
  const seen = new Set<string>();
  const out: Heater[] = [];
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      const a = p.attributes;
      const mint = p.relationships.base_token.data.id.replace(/^solana_/, "");
      if (seen.has(mint) || /^So1111/.test(mint) || /^EPjFW|^Es9vM/.test(mint)) continue;
      const createdAt = Date.parse(a.pool_created_at);
      if (!createdAt || now - createdAt > 24 * 3600_000) continue;
      const t5 = a.transactions.m5 ?? { buys: 0, sells: 0 };
      const change5m = num(a.price_change_percentage.m5);
      const buyers5m = t5.buyers ?? t5.buys;
      // Heating: real buyer flow, more buys than sells, price going up.
      if (buyers5m < 15 || t5.buys < t5.sells * 1.1 || change5m <= 3) continue;
      seen.add(mint);
      const heat = Math.round(Math.min(100, Math.log2(1 + buyers5m) * 5 + Math.min(20, Math.log2(1 + change5m) * 3) + Math.min(15, (t5.buys / Math.max(1, t5.sells)) * 5)));
      out.push({
        mint,
        pool: a.address,
        name: a.name,
        dex: p.relationships.dex.data.id,
        createdAt,
        fdvUsd: a.fdv_usd ? num(a.fdv_usd) : null,
        liquidityUsd: a.reserve_in_usd ? num(a.reserve_in_usd) : null,
        change5m,
        change1h: num(a.price_change_percentage.h1),
        buys5m: t5.buys,
        sells5m: t5.sells,
        buyers5m,
        volume5m: num(a.volume_usd.m5),
        heat,
      });
    }
  }
  out.sort((a, b) => b.heat - a.heat);
  return NextResponse.json({ heaters: out.slice(0, 25), updatedAt: now }, { headers: { "Cache-Control": "s-maxage=30" } });
}
