import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public mainnet RPC by default. Set RPC_URL in .env to use your own (Helius, QuickNode...).
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// How many tokens of `mint` the wallet `owner` still holds.
export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner") || "";
  const mint = req.nextUrl.searchParams.get("mint") || "";
  if (!B58.test(owner) || !B58.test(mint)) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `rpc ${res.status}` }, { status: 502 });
    const j = await res.json();
    if (j.error) return NextResponse.json({ error: j.error.message }, { status: 502 });
    const accounts: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] =
      j.result?.value ?? [];
    const balance = accounts.reduce((sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
    return NextResponse.json({ balance });
  } catch {
    return NextResponse.json({ error: "rpc unreachable" }, { status: 502 });
  }
}
