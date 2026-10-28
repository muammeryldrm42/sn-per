import { NextRequest, NextResponse } from "next/server";
import { lookupTokens } from "@/lib/dex";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const list = (req.nextUrl.searchParams.get("addresses") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s));
  if (!list.length) return NextResponse.json({ tokens: [] });
  try {
    return NextResponse.json({ tokens: await lookupTokens(list) });
  } catch (e) {
    return NextResponse.json({ tokens: [], error: String((e as Error).message) }, { status: 502 });
  }
}
