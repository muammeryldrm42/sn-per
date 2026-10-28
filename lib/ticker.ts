"use client";

// Timers that keep running when the tab is in the background.
// Browsers throttle setTimeout/setInterval in hidden tabs (down to once a minute in Chrome),
// but timers inside a dedicated Web Worker are not throttled that way. The worker only ticks;
// all work still happens on the main thread when its message arrives.

const WORKER_SRC = `
const t = new Map();
onmessage = (e) => {
  const { op, id, ms } = e.data;
  if (op === "i") t.set(id, setInterval(() => postMessage(id), ms));
  else if (op === "t") t.set(id, setTimeout(() => { t.delete(id); postMessage(id); }, ms));
  else if (op === "c") { clearInterval(t.get(id)); clearTimeout(t.get(id)); t.delete(id); }
};
`;

export interface Ticker {
  every: (ms: number, fn: () => void) => () => void;
  after: (ms: number, fn: () => void) => () => void;
  close: () => void;
  background: boolean; // true when running on the worker
}

export function createTicker(): Ticker {
  let worker: Worker | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    worker = new Worker(url);
  } catch {
    worker = null;
  }

  if (!worker) {
    return {
      every: (ms, fn) => {
        const h = setInterval(fn, ms);
        return () => clearInterval(h);
      },
      after: (ms, fn) => {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      },
      close: () => {},
      background: false,
    };
  }

  const w = worker;
  let seq = 0;
  const cbs = new Map<number, { fn: () => void; once: boolean }>();
  w.onmessage = (e: MessageEvent<number>) => {
    const cb = cbs.get(e.data);
    if (!cb) return;
    if (cb.once) cbs.delete(e.data);
    try {
      cb.fn();
    } catch (err) {
      console.error(err);
    }
  };
  const start = (op: "i" | "t", ms: number, fn: () => void) => {
    const id = ++seq;
    cbs.set(id, { fn, once: op === "t" });
    w.postMessage({ op, id, ms });
    return () => {
      cbs.delete(id);
      w.postMessage({ op: "c", id });
    };
  };
  return {
    every: (ms, fn) => start("i", ms, fn),
    after: (ms, fn) => start("t", ms, fn),
    close: () => {
      cbs.clear();
      w.terminate();
      if (url) URL.revokeObjectURL(url);
    },
    background: true,
  };
}
