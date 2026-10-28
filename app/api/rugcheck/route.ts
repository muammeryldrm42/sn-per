import { NextRequest, NextResponse } from "next/server";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

interface Holder {
  owner?: string;
  pct?: number;
  insider?: boolean;
}

interface Report {
  score?: number;
  score_normalised?: number;
  risks?: { name: string; level: string; description?: string }[];
  rugged?: boolean;
  totalHolders?: number;
  topHolders?: Holder[];
  knownAccounts?: Record<string, { name?: string; type?: string }>;
  graphInsidersDetected?: number;
  insiderNetworks?: { size?: number; tokenAmount?: number }[] | null;
  token?: { supply?: number; decimals?: number };
  creatorTokens?: { mint: string; marketCap?: number; createdAt?: string }[] | null;
}

// A previous launch still under this market cap is treated as dead.
const DEAD_MCAP_USD = 8000;

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return NextResponse.json({ pending: true, status: res.status });
    const j = (await res.json()) as Report;

    const risks = (j.risks ?? []).map((r) => ({ name: r.name, level: r.level, description: r.description }));

    // Holder concentration without AMM pools and bonding curves.
    const known = j.knownAccounts ?? {};
    const isPool = (owner?: string) => {
      if (!owner || !known[owner]) return false;
      const k = known[owner];
      return k.type === "AMM" || /pump|raydium|meteora|orca|launch|bonk|curve/i.test(k.name ?? "");
    };
    const real = (j.topHolders ?? []).filter((h) => !isPool(h.owner));
    const top10Pct = real.slice(0, 10).reduce((s, h) => s + (h.pct ?? 0), 0);
    const top1Pct = real[0]?.pct ?? 0;

    const supplyRaw = j.token?.supply ?? 0;
    const insiderRaw = (j.insiderNetworks ?? []).reduce((s, n) => s + (n.tokenAmount ?? 0), 0);
    const insiderPct = supplyRaw > 0 ? (insiderRaw / supplyRaw) * 100 : 0;

    const ct = (j.creatorTokens ?? []).filter((t) => t.mint !== mint);
    const caps = ct.map((t) => t.marketCap ?? 0);

    return NextResponse.json({
      pending: false,
      score: j.score_normalised ?? j.score,
      risks,
      rugged: !!j.rugged,
      holders: j.totalHolders ?? null,
      top10Pct: Math.round(top10Pct * 10) / 10,
      top1Pct: Math.round(top1Pct * 10) / 10,
      insiders: j.graphInsidersDetected ?? 0,
      insiderPct: Math.round(insiderPct * 10) / 10,
      devPrevTokens: ct.length,
      devPrevDead: caps.filter((c) => c < DEAD_MCAP_USD).length,
      devPrevBest: caps.length ? Math.max(...caps) : null,
    });
  } catch {
    return NextResponse.json({ pending: true });
  }
}
