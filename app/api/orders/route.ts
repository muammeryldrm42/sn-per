import { NextRequest, NextResponse } from "next/server";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

// Has the team paid DexScreener (profile, ads, boosts)? A dev spending real money early is a commitment signal.
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") || "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }
  try {
    const res = await fetch(`https://api.dexscreener.com/orders/v1/solana/${mint}`, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return NextResponse.json({ error: `dexscreener ${res.status}` }, { status: 502 });
    const j = (await res.json()) as {
      orders?: { type: string; status: string; paymentTimestamp?: number }[];
      boosts?: { amount?: number }[];
    };
    const approved = (j.orders ?? []).filter((o) => o.status === "approved");
    const paidAt = approved.length ? Math.min(...approved.map((o) => o.paymentTimestamp ?? Date.now())) : null;
    return NextResponse.json({
      paid: approved.length > 0,
      types: approved.map((o) => o.type),
      paidAt,
      boosts: (j.boosts ?? []).reduce((s, b) => s + (b.amount ?? 0), 0),
    });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
