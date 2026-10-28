"use client";

import { useEffect, useMemo, useState } from "react";
import { TRIGGER_LABEL, type CallRow } from "@/lib/archive";
import { age, mult, usd } from "@/lib/format";

// Every call ever made, newest first. Nothing is removed, losers included.
export function Archive({ recent, now, remoteUrl }: { recent: CallRow[]; now: number; remoteUrl?: string }) {
  const [older, setOlder] = useState<CallRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    const map = new Map<string, CallRow>();
    for (const r of [...older, ...recent]) map.set(r.m, r);
    return [...map.values()].sort((a, b) => b.t - a.t);
  }, [recent, older]);

  useEffect(() => {
    if (!remoteUrl) return;
    fetch(`${remoteUrl.replace(/\/$/, "")}/archive?limit=1`)
      .then((r) => r.json())
      .then((j) => setTotal(j.total ?? null))
      .catch(() => {});
  }, [remoteUrl, recent.length]);

  const loadOlder = async () => {
    if (!remoteUrl) return;
    setLoading(true);
    try {
      const before = rows.length ? rows[rows.length - 1].t : Date.now() + 1;
      const r = await fetch(`${remoteUrl.replace(/\/$/, "")}/archive?before=${before}&limit=100`);
      const j = (await r.json()) as { calls: CallRow[]; total: number };
      setOlder((o) => [...o, ...j.calls]);
      setTotal(j.total);
    } catch {
      /* try again */
    }
    setLoading(false);
  };

  const share = async (mint: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?mint=${mint}`);
      setCopied(mint);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* blocked */
    }
  };

  return (
    <section className="border-b border-line px-5 py-5 md:px-8" aria-labelledby="archive-title">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <h2 id="archive-title" className="font-display text-lg font-bold">
          Call archive
        </h2>
        <span className="text-sm text-muted">
          {open ? "Hide" : "Show"} every call ever made{total != null ? `, ${total.toLocaleString()} so far` : ""}
        </span>
      </button>
      {open &&
        (rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No calls yet. The first one lands here the moment it is made and stays forever.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-normal">Called</th>
                    <th className="pb-2 font-normal">Token</th>
                    <th className="pb-2 font-normal">Why</th>
                    <th className="pb-2 text-right font-normal">Mcap at call</th>
                    <th className="pb-2 text-right font-normal">Peak 1h</th>
                    <th className="pb-2 text-right font-normal">Peak 7d</th>
                    <th className="pb-2 text-right font-normal">Now</th>
                    <th className="pb-2 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const nowX = r.now / r.c;
                    return (
                      <tr key={r.m} className="border-t border-line">
                        <td className="py-2 pr-2 text-muted" title={new Date(r.t).toLocaleString()}>
                          {age(r.t, now)} ago
                        </td>
                        <td className="py-2 pr-2">
                          <a
                            href={`https://dexscreener.com/solana/${r.m}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold hover:text-narr"
                          >
                            {r.n}
                          </a>{" "}
                          <span className="text-muted">${r.s}</span>
                        </td>
                        <td className="py-2 pr-2">
                          <span className="text-narr">{TRIGGER_LABEL[r.tr] ?? r.tr}</span>
                          {r.sm ? <span className="text-flow">, {r.sm} smart</span> : null}
                          {r.cl ? <span className="text-flow">, clean</span> : null}
                        </td>
                        <td className="py-2 text-right">{usd(r.c)}</td>
                        <td className="py-2 text-right text-flow">{mult(r.p1 / r.c)}</td>
                        <td className="py-2 text-right font-semibold text-flow">{mult(r.pk / r.c)}</td>
                        <td className={`py-2 text-right ${nowX >= 1 ? "text-flow" : "text-warn"}`}>{mult(nowX)}</td>
                        <td className="py-2 pl-3 text-right">
                          <button type="button" onClick={() => share(r.m)} className="text-xs text-muted underline-offset-4 hover:text-text hover:underline">
                            {copied === r.m ? "copied" : "link"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {remoteUrl && (total == null || rows.length < total) && (
              <button
                type="button"
                onClick={loadOlder}
                disabled={loading}
                className="mt-3 rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-text"
              >
                {loading ? "Loading..." : "Load older calls"}
              </button>
            )}
            {!remoteUrl && (
              <p className="mt-2 text-xs text-muted">This tab shows the last 7 days it saw. With the shared worker every call is kept and listed forever.</p>
            )}
          </>
        ))}
    </section>
  );
}
