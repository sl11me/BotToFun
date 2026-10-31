// Logique de décision pure (sans I/O) : testable et facile à faire évoluer.
// Référence des règles : docs/pumpfun-playbook.md

export type NewToken = {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  traderPublicKey: string; // créateur
  bondingCurveKey: string;
  solAmount: number; // achat initial du dev, en SOL
  marketCapSol: number;
  vSolInBondingCurve: number; // SOL virtuels juste après la création (achat du dev inclus)
  pool?: string;
  is_mayhem_mode?: boolean;
};

export type EntryRules = { minDevBuySol: number; maxDevBuySol: number; maxMcapSol: number };

/** Filtre immédiat sur l'événement de création. Renvoie null si le token passe, sinon la raison du rejet. */
export function rejectReason(t: NewToken, r: EntryRules): string | null {
  if (t.pool && t.pool !== "pump") return `pool ${t.pool}`;
  if (t.is_mayhem_mode) return "mayhem mode"; // une IA trade le token au hasard : métriques faussées (E6)
  if (!t.uri) return "pas de métadonnées";
  if (!t.name.trim() || !t.symbol.trim()) return "nom/symbole vide";
  // Dev qui n'achète rien = peu d'engagement ; dev qui achète trop = risque de dump (E7).
  if (t.solAmount < r.minDevBuySol) return `dev buy ${t.solAmount.toFixed(2)} < ${r.minDevBuySol}`;
  if (t.solAmount > r.maxDevBuySol) return `dev buy ${t.solAmount.toFixed(2)} > ${r.maxDevBuySol}`;
  if (t.marketCapSol > r.maxMcapSol) return `mcap ${t.marketCapSol.toFixed(1)} > ${r.maxMcapSol}`;
  return null;
}

/** Réseaux sociaux dans le JSON de métadonnées : un lien Telegram multiplie la graduation par ~9 (E1). */
export function socialReason(meta: Record<string, unknown>, requireTelegram: boolean): string | null {
  return requireTelegram && !meta.telegram ? "pas de telegram" : null;
}

export type Curve = { vSol: bigint; vTokens: bigint; complete: boolean };

// Frais de la curve : 0,95 % protocole + 0,30 % créateur (pump.fun/docs/fees, 17/10/2026).
const FEE_BPS = 125n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export const mcapSol = (c: Curve) => Number((c.vSol * 1_000_000n) / c.vTokens); // supply 1 Md, 6 décimales

/** Tokens reçus pour `lamports` SOL dépensés sur la curve (x·y=k, frais déduits à l'entrée). */
export function buyQuote(c: Curve, lamports: bigint): bigint {
  const net = (lamports * (10_000n - FEE_BPS)) / 10_000n;
  return c.vTokens - ceilDiv(c.vSol * c.vTokens, c.vSol + net);
}

/** Lamports reçus pour la vente de `tokens` sur la curve, frais déduits. */
export function sellQuote(c: Curve, tokens: bigint): bigint {
  const gross = c.vSol - ceilDiv(c.vSol * c.vTokens, c.vTokens + tokens);
  return (gross * (10_000n - FEE_BPS)) / 10_000n;
}

/** Momentum pendant le délai d'entrée : SOL entré dans la curve depuis la création (E2/E5). */
export function inflowReason(createdVSolSol: number, now: Curve, minInflowSol: number): string | null {
  const inflow = Number(now.vSol) / 1e9 - createdVSolSol;
  return inflow < minInflowSol ? `inflow ${inflow.toFixed(2)} SOL < ${minInflowSol}` : null;
}

export type ExitRules = {
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldSeconds: number;
  trailArmPct: number; // le trailing stop s'active une fois ce gain atteint
  trailPct: number; // recul toléré depuis le plus haut
};

/** Décide s'il faut sortir, à partir du coût, de la valeur actuelle et du plus haut atteint (lamports). */
export function exitReason(cost: bigint, value: bigint, peak: bigint, heldSeconds: number, r: ExitRules): string | null {
  const pct = (v: bigint) => (Number(v - cost) / Number(cost)) * 100;
  const pnl = pct(value);
  if (pnl >= r.takeProfitPct) return `take profit ${pnl.toFixed(1)}%`;
  if (pnl <= -r.stopLossPct) return `stop loss ${pnl.toFixed(1)}%`;
  if (pct(peak) >= r.trailArmPct && Number(value) <= Number(peak) * (1 - r.trailPct / 100))
    return `trailing ${pnl.toFixed(1)}% (plus haut ${pct(peak).toFixed(1)}%)`;
  if (heldSeconds >= r.maxHoldSeconds) return `timeout ${pnl.toFixed(1)}%`;
  return null;
}
