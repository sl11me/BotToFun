import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { config } from "./config.ts";
import { dashboardData, openPositions, realizedPnlSol } from "./db.ts";

// Copie des derniers logs console pour la page ; le terminal / Docker garde les logs complets.
const logs: string[] = [];
for (const level of ["log", "error"] as const) {
  const print = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logs.push(`${new Date().toLocaleTimeString("fr-FR")} ${args.join(" ")}`);
    if (logs.length > 300) logs.shift();
    print(...args);
  };
}

const startedAt = Date.now();
const sol = (lamports: unknown) => Number(lamports ?? 0) / 1e9;
const report = async (path: string) => (await readFile(path, "utf8").catch(() => "")).slice(0, 12_000);

function state(liveValue: (mint: string) => bigint | undefined) {
  const now = Date.now();
  const d = dashboardData(now - 3_600_000);
  // « dev buy 0.03 < 0.5 » et « dev buy 0.20 < 0.5 » comptent dans la même raison.
  const funnel: Record<string, number> = {};
  for (const { decision, n } of d.decisions) {
    const key = decision.replace(/ -?\d+(\.\d+)?%?/, "");
    funnel[key] = (funnel[key] ?? 0) + n;
  }
  return {
    now,
    startedAt,
    mode: config.mode,
    realizedPnl: realizedPnlSol(),
    totals: d.totals,
    funnel,
    perMinute: d.perMinute,
    tokens: d.tokens,
    open: openPositions().map((p) => {
      const value = liveValue(p.mint);
      return { mint: p.mint, symbol: p.symbol, cost: sol(p.costLamports), value: value === undefined ? null : sol(value), peak: sol(p.peakLamports), openedAt: p.openedAt };
    }),
    closed: d.closed.map((c: any) => ({ ...c, cost: sol(c.cost_lamports), proceeds: sol(c.proceeds_lamports) })),
    logs,
  };
}

const json = (res: ServerResponse, body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));

/** Page temps réel sur DASHBOARD_HOST:DASHBOARD_PORT. Une panne du serveur est loguée sans arrêter le bot. */
export function startDashboard(liveValue: (mint: string) => bigint | undefined) {
  if (!config.dashboardPort) return;
  // Jamais de secrets dans la page : clé privée, clés API, URL RPC (Helius y met sa clé).
  const { privateKey, rpcUrl, jupiterApiKey, pumpPortalApiKey, ...rules } = config;
  createServer(async (req, res) => {
    try {
      if (req.url === "/api/state") return json(res, { ...state(liveValue), rules });
      if (req.url === "/api/reports") return json(res, { supervision: await report("reports/supervision.md"), apprentissage: await report("docs/apprentissage.md") });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(new URL("dashboard.html", import.meta.url)));
    } catch (e) {
      res.writeHead(500).end((e as Error).message);
    }
  })
    .on("error", (e) => console.error(`[dashboard] ${e.message}`))
    .listen(config.dashboardPort, config.dashboardHost, () => console.log(`[dashboard] http://${config.dashboardHost}:${config.dashboardPort}`));
}
