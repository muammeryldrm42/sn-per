import { NextRequest, NextResponse } from "next/server";
import { UA, lookupTokens } from "@/lib/dex";

export const dynamic = "force-dynamic";

// Market cap candles for one token (GeckoTerminal OHLCV on its main pair). Market cap = price x supply, with the
// supply taken from DexScreener (FDV / price), so the chart lines up with the market caps on calls.
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || "";
  const tf = [1, 5, 15].includes(Number(req.nextUrl.searchParams.get("tf"))) ? Number(req.nextUrl.searchParams.get("tf")) : 1;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  try {
    const [t] = await lookupTokens([mint]);
    if (!t?.pairAddress) return NextResponse.json({ candles: [], reason: "not indexed yet" });
    const supply = t.fdvUsd && t.priceUsd ? t.fdvUsd / t.priceUsd : 1e9;
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${t.pairAddress}/ohlcv/minute?aggregate=${tf}&limit=1000&currency=usd&token=base`,
      { headers: UA, cache: "no-store", signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return NextResponse.json({ candles: [], reason: `chart source ${r.status}` }, { status: r.status === 429 ? 429 : 200 });
    const j = await r.json();
    const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
    const candles = list
      .map(([ts, o, h, l, c, v]) => ({ t: ts, o: o * supply, h: h * supply, l: l * supply, c: c * supply, v }))
      .filter((k) => isFinite(k.o) && k.o > 0)
      .sort((a, b) => a.t - b.t);
    return NextResponse.json(
      { pair: t.pairAddress, dex: t.dexId, supply, tf, candles },
      { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } }
    );
  } catch {
    return NextResponse.json({ candles: [], reason: "chart source unreachable" }, { status: 502 });
  }
}
