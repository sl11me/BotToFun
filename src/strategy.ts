// Logique de décision pure (sans I/O) : testable et facile à faire évoluer.

export type NewToken = {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  solAmount: number; // achat initial du dev, en SOL
  marketCapSol: number;
  pool?: string;
};

export type EntryRules = { minDevBuySol: number; maxDevBuySol: number; maxMcapSol: number };

/** Renvoie null si le token passe, sinon la raison du rejet. */
export function rejectReason(t: NewToken, r: EntryRules): string | null {
  if (t.pool && t.pool !== "pump") return `pool ${t.pool}`;
  if (!t.uri) return "pas de métadonnées";
  if (!t.name.trim() || !t.symbol.trim()) return "nom/symbole vide";
  // Dev qui n'achète rien = peu d'engagement ; dev qui achète trop = risque de dump.
  if (t.solAmount < r.minDevBuySol) return `dev buy ${t.solAmount.toFixed(2)} < ${r.minDevBuySol}`;
  if (t.solAmount > r.maxDevBuySol) return `dev buy ${t.solAmount.toFixed(2)} > ${r.maxDevBuySol}`;
  if (t.marketCapSol > r.maxMcapSol) return `mcap ${t.marketCapSol.toFixed(1)} > ${r.maxMcapSol}`;
  return null;
}

export type ExitRules = { takeProfitPct: number; stopLossPct: number; maxHoldSeconds: number };

/** Décide s'il faut sortir d'une position, à partir de la valeur actuelle (en lamports) de la position. */
export function exitReason(
  costLamports: bigint,
  valueLamports: bigint,
  heldSeconds: number,
  r: ExitRules,
): string | null {
  const pnlPct = (Number(valueLamports - costLamports) / Number(costLamports)) * 100;
  if (pnlPct >= r.takeProfitPct) return `take profit ${pnlPct.toFixed(1)}%`;
  if (pnlPct <= -r.stopLossPct) return `stop loss ${pnlPct.toFixed(1)}%`;
  if (heldSeconds >= r.maxHoldSeconds) return `timeout ${pnlPct.toFixed(1)}%`;
  return null;
}
