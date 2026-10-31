import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

const db = new DatabaseSync(config.dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    mint TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    mode TEXT NOT NULL,
    cost_lamports TEXT NOT NULL,
    token_amount TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    proceeds_lamports TEXT,
    exit_reason TEXT
  )
`);

export type Position = { mint: string; symbol: string; costLamports: bigint; tokenAmount: bigint; openedAt: number };

export function openPosition(p: Position) {
  db.prepare(
    "INSERT INTO positions (mint, symbol, mode, cost_lamports, token_amount, opened_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(p.mint, p.symbol, config.mode, p.costLamports.toString(), p.tokenAmount.toString(), p.openedAt);
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
      costLamports: BigInt(r.cost_lamports),
      tokenAmount: BigInt(r.token_amount),
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
