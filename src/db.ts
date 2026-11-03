import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";
import type { NewToken } from "./strategy.ts";

const db = new DatabaseSync(config.dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    mint TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    mode TEXT NOT NULL,
    bonding_curve TEXT NOT NULL,
    cost_lamports TEXT NOT NULL,
    token_amount TEXT NOT NULL,
    peak_lamports TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    proceeds_lamports TEXT,
    exit_reason TEXT
  );
  -- Tous les tokens vus et la décision prise : matière première de l'analyse (agent d'apprentissage).
  CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    symbol TEXT,
    name TEXT,
    creator TEXT,
    bonding_curve TEXT,
    created_at INTEGER NOT NULL,
    dev_buy_sol REAL,
    mcap_sol REAL,
    mayhem INTEGER,
    decision TEXT
  );
`);

export type Position = {
  mint: string;
  symbol: string;
  bondingCurve: string;
  costLamports: bigint;
  tokenAmount: bigint;
  peakLamports: bigint;
  openedAt: number;
};

export function logToken(t: NewToken, decision: string) {
  db.prepare(
    `INSERT INTO tokens (mint, symbol, name, creator, bonding_curve, created_at, dev_buy_sol, mcap_sol, mayhem, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET decision = excluded.decision`,
  // PumpPortal omet parfois symbol ou bondingCurveKey : SQLite refuse undefined.
  ).run(t.mint, t.symbol ?? null, t.name ?? null, t.traderPublicKey ?? null, t.bondingCurveKey ?? null, Date.now(), t.solAmount ?? null, t.marketCapSol ?? null, t.is_mayhem_mode ? 1 : 0, decision);
}

export function openPosition(p: Omit<Position, "peakLamports">) {
  db.prepare(
    "INSERT INTO positions (mint, symbol, mode, bonding_curve, cost_lamports, token_amount, peak_lamports, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(p.mint, p.symbol, config.mode, p.bondingCurve, p.costLamports.toString(), p.tokenAmount.toString(), p.costLamports.toString(), p.openedAt);
}

export function updatePeak(mint: string, peak: bigint) {
  db.prepare("UPDATE positions SET peak_lamports = ? WHERE mint = ?").run(peak.toString(), mint);
}

export function closePosition(mint: string, proceedsLamports: bigint, reason: string) {
  db.prepare("UPDATE positions SET closed_at = ?, proceeds_lamports = ?, exit_reason = ? WHERE mint = ?").run(
    Date.now(),
    proceedsLamports.toString(),
    reason,
    mint,
  );
}

export function openPositions(): Position[] {
  return db
    .prepare("SELECT * FROM positions WHERE closed_at IS NULL AND mode = ?")
    .all(config.mode)
    .map((r: any) => ({
      mint: r.mint,
      symbol: r.symbol,
      bondingCurve: r.bonding_curve,
      costLamports: BigInt(r.cost_lamports),
      tokenAmount: BigInt(r.token_amount),
      peakLamports: BigInt(r.peak_lamports),
      openedAt: r.opened_at,
    }));
}

export function hasTraded(mint: string) {
  return db.prepare("SELECT 1 FROM positions WHERE mint = ?").get(mint) !== undefined;
}

export function realizedPnlSol(): number {
  const r = db
    .prepare(
      "SELECT SUM(CAST(proceeds_lamports AS INTEGER) - CAST(cost_lamports AS INTEGER)) AS pnl FROM positions WHERE closed_at IS NOT NULL AND mode = ?",
    )
    .get(config.mode) as { pnl: number | null };
  return (r.pnl ?? 0) / 1e9;
}

/** Lectures du tableau de bord : derniers tokens, décisions et débit depuis `since` (ms), trades fermés. */
export function dashboardData(since: number) {
  return {
    tokens: db.prepare("SELECT mint, symbol, created_at, dev_buy_sol, mcap_sol, decision FROM tokens ORDER BY created_at DESC LIMIT 60").all(),
    decisions: db.prepare("SELECT decision, COUNT(*) AS n FROM tokens WHERE created_at >= ? GROUP BY 1").all(since) as { decision: string; n: number }[],
    perMinute: db.prepare("SELECT created_at / 60000 AS m, COUNT(*) AS n FROM tokens WHERE created_at >= ? GROUP BY 1").all(since),
    closed: db
      .prepare("SELECT mint, symbol, cost_lamports, proceeds_lamports, opened_at, closed_at, exit_reason FROM positions WHERE closed_at IS NOT NULL AND mode = ? ORDER BY closed_at DESC LIMIT 30")
      .all(config.mode),
    totals: db
      .prepare("SELECT COUNT(*) AS trades, SUM(CAST(proceeds_lamports AS INTEGER) > CAST(cost_lamports AS INTEGER)) AS wins FROM positions WHERE closed_at IS NOT NULL AND mode = ?")
      .get(config.mode),
  };
}

/** Créateur dont un token nous a déjà fait perdre au moins `lossPct` % : liste noire, on ne lui fait plus confiance. */
export function isBlacklisted(creator: string, lossPct: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM positions p JOIN tokens t ON t.mint = p.mint
         WHERE t.creator = ? AND p.closed_at IS NOT NULL
           AND CAST(p.proceeds_lamports AS INTEGER) <= CAST(p.cost_lamports AS INTEGER) * (100 - ?) / 100`,
      )
      .get(creator, lossPct) !== undefined
  );
}
