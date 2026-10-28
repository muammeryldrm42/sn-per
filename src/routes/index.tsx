import { createFileRoute } from "@tanstack/react-router";
import { TalonsApp } from "@/components/talons-app";
import { scanMarket } from "@/lib/market-fns";

export const Route = createFileRoute("/")({
  loader: () => scanMarket(),
  pendingComponent: Pending,
  component: Home,
});

function Home() {
  const scan = Route.useLoaderData();
  return <TalonsApp initial={scan} />;
}

function Pending() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6 text-center text-fg">
      <div>
        <p className="font-mono text-xs tracking-widest text-flow uppercase">Talons</p>
        <h1 className="mt-2 text-2xl font-semibold">Reading Solana pools</h1>
        <p className="mt-2 text-sm text-muted">Dex boosts, new pairs, and trending pools.</p>
      </div>
    </main>
  );
}
