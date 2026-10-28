import { NextRequest, NextResponse } from "next/server";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri") || "";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return NextResponse.json({ error: "invalid uri" }, { status: 400 });
  }
  if (url.protocol !== "https:" || /^[\d.]+$/.test(url.hostname) || url.hostname === "localhost") {
    return NextResponse.json({ error: "blocked uri" }, { status: 400 });
  }
  try {
    const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 });
    const text = await res.text();
    if (text.length > 100_000) return NextResponse.json({ error: "too large" }, { status: 502 });
    const j = JSON.parse(text);
    return NextResponse.json(
      {
        description: pick(j.description),
        image: pick(j.image),
        twitter: pick(j.twitter) ?? pick(j.extensions?.twitter),
        telegram: pick(j.telegram) ?? pick(j.extensions?.telegram),
        website: pick(j.website) ?? pick(j.extensions?.website),
      },
      { headers: { "Cache-Control": "s-maxage=3600" } }
    );
  } catch {
    return NextResponse.json({ error: "unreadable metadata" }, { status: 502 });
  }
}
