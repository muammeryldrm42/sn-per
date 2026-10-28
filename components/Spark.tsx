"use client";

import { useId } from "react";
import type { CallRow } from "@/lib/archive";

// Market cap since the call: entry diamond at the start, triangle at the peak, dashed line at the entry level.
// Time runs on a square root scale so the first minutes (where most of the action is) get room.
export function Spark({ row, width = 150, height = 36, axis = false }: { row: CallRow; width?: number; height?: number; axis?: boolean }) {
  const gid = useId().replace(/:/g, "");
  const pts: [number, number][] = [...(row.h ?? [])];
  const nowMin = Math.max(0, (row.chk - row.t) / 60_000);
  if (row.now > 0 && (!pts.length || nowMin > pts[pts.length - 1][0] + 0.5)) pts.push([nowMin, row.now]);
  if (pts.length < 2) {
    return (
      <span className="font-mono text-[10px] text-dim" style={{ width }}>
        {row.h ? "tracking..." : "no chart"}
      </span>
    );
  }
  const padX = 6;
  const padY = 5;
  const maxT = Math.max(1, pts[pts.length - 1][0]);
  const vals = pts.map((p) => p[1]).concat(row.c);
  const lo = Math.log(Math.max(1, Math.min(...vals)));
  const hi = Math.log(Math.max(...vals));
  const span = Math.max(0.05, hi - lo);
  const x = (t: number) => padX + (Math.sqrt(t) / Math.sqrt(maxT)) * (width - padX * 2);
  const y = (v: number) => height - padY - ((Math.log(Math.max(1, v)) - lo) / span) * (height - padY * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${x(pts[pts.length - 1][0]).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  const up = row.now >= row.c;
  const color = up ? "var(--flow)" : "var(--warn)";
  let pi = 0;
  pts.forEach((p, i) => {
    if (p[1] > pts[pi][1]) pi = i;
  });
  const [pt, pv] = pts[pi];
  const ey = y(row.c);
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Market cap since the call, now ${(row.now / row.c).toFixed(2)}x`}>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padX} x2={width - padX} y1={ey} y2={ey} stroke="var(--narr)" strokeOpacity="0.55" strokeDasharray="2 3" strokeWidth="1" />
      <path d={area} fill={`url(#g${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${x(0)},${ey - 3.5}l3.5,3.5l-3.5,3.5l-3.5,-3.5z`} fill="var(--narr)" />
      {pi > 0 && <path d={`M${x(pt)},${y(pv) - 5}l3.5,5h-7z`} fill={color} />}
      <circle cx={x(last[0])} cy={y(last[1])} r="2" fill={color} />
      {axis && (
        <g className="font-mono" fontSize="9" fill="var(--dim)">
          <text x={padX} y={height - 1}>call</text>
          <text x={width - padX} y={height - 1} textAnchor="end">
            {last[0] < 90 ? `${Math.round(last[0])}m` : last[0] < 2880 ? `${Math.round(last[0] / 60)}h` : `${Math.round(last[0] / 1440)}d`}
          </text>
        </g>
      )}
    </svg>
  );
}
