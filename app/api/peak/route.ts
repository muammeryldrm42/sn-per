import { NextRequest, NextResponse } from "next/server";
import { UA, lookupTokens } from "@/lib/dex";

export const dynamic = "force-dynamic";

// Peak multiple of a token within a window after launch, from GeckoTerminal minute candles.
// base = launch market cap in USD (pump.fun supply is 1B, so price = mcap / 1e9).
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || "";
  const from = Number(req.nextUrl.searchParams.get("from"));
  const base = Number(req.nextUrl.searchParams.get("base"));
  const windowMin = Math.min(240, Math.max(10, Number(req.nextUrl.searchParams.get("window")) || 45));
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !isFinite(from) || !isFinite(base) || base <= 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  try {
    const [t] = await lookupTokens([mint]);
    if (!t) return NextResponse.json({ peakX: null, reason: "not indexed" });
    // DexScreener URLs are lowercased, so use the real (case-sensitive) pair address.
    const pair = t.pairAddress;
    if (!pair) return NextResponse.json({ peakX: null, reason: "no pair" });
    // GeckoTerminal rejects a before_timestamp in the future.
    const until = Math.floor(Math.min(Date.now(), from + windowMin * 60_000) / 1000) + 60;
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair}/ohlcv/minute?aggregate=1&limit=${windowMin + 5}&currency=usd&token=base&before_timestamp=${until}`,
      { headers: UA, cache: "no-store", signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return NextResponse.json({ peakX: null, reason: `gecko ${r.status}` }, { status: r.status === 429 ? 429 : 200 });
    const j = await r.json();
    const candles: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
    let high = 0;
    for (const c of candles) if (c[0] * 1000 >= from - 60_000 && c[0] * 1000 <= from + windowMin * 60_000) high = Math.max(high, c[2]);
    if (!high) return NextResponse.json({ peakX: 1, reason: "no trades in window" });
    const peakX = (high * 1e9) / base;
    // Wild values mean a broken candle or a non-standard supply; do not learn from them.
    if (peakX > 500) return NextResponse.json({ peakX: null, reason: "implausible" });
    return NextResponse.json({ peakX: Math.round(peakX * 100) / 100 });
  } catch {
    return NextResponse.json({ peakX: null, reason: "unreachable" }, { status: 502 });
  }
}
