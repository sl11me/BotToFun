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

// --- Sécurité (Brigitte) : chaque règle renvoie la raison du rejet, ou null si le token passe. ---

/** Compte mint lu on-chain (jsonParsed). */
export type MintInfo = {
  program: string; // programme propriétaire du mint
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: { extension: string }[];
};

export const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
// pump.fun crée tous ses tokens en Token-2022 avec seulement ces deux extensions (métadonnées).
// Toute autre extension (transferHook, transferFeeConfig, permanentDelegate, pausable, defaultAccountState…)
// permet de taxer, bloquer ou saisir les tokens : rejet.
const SAFE_EXTENSIONS = new Set(["metadataPointer", "tokenMetadata"]);

export function mintReason(m: MintInfo): string | null {
  if (!TOKEN_PROGRAMS.has(m.program)) return `programme de token inconnu ${m.program}`;
  if (m.mintAuthority) return "mint authority active"; // le dev peut créer des tokens à volonté
  if (m.freezeAuthority) return "freeze authority active"; // le dev peut geler nos tokens (honeypot)
  const bad = m.extensions.find((e) => !SAFE_EXTENSIONS.has(e.extension));
  return bad ? `extension token-2022 ${bad.extension}` : null;
}

/** Liquidité réelle de la curve : SOL au-delà des 30 SOL virtuels de départ. */
export function liquidityReason(c: Curve, minLiquiditySol: number): string | null {
  const liquidity = Number(c.vSol) / 1e9 - 30;
  return liquidity < minLiquiditySol ? `liquidité ${liquidity.toFixed(2)} SOL < ${minLiquiditySol}` : null;
}

/** Simulation achat puis revente immédiate (quotes Jupiter) : perte d'aller-retour en %. */
export function roundTripReason(spentLamports: bigint, backLamports: bigint, maxLossPct: number): string | null {
  const loss = (1 - Number(backLamports) / Number(spentLamports)) * 100;
  return loss > maxLossPct ? `aller-retour -${loss.toFixed(1)}% > ${maxLossPct}` : null;
}

/** Sous-ensemble du rapport RugCheck (api.rugcheck.xyz/v1/tokens/{mint}/report). */
export type RugReport = {
  score_normalised: number; // 1 = sain … 100 = très risqué
  risks: { name: string; level: string }[] | null;
  topHolders: { owner: string; pct: number; insider: boolean }[] | null;
  creatorTokens: { createdAt: string }[] | null;
};

export type SecurityRules = {
  maxRugScore: number;
  maxTop10Pct: number;
  maxHolderPct: number;
  maxInsiderPct: number;
  maxCreatorLaunches24h: number;
};

/** Score RugCheck, répartition des holders (hors bonding curve) et historique du créateur. */
export function rugReason(r: RugReport, bondingCurve: string, now: number, rules: SecurityRules): string | null {
  // Les risques « danger » incluent l'historique de rug du créateur.
  const danger = r.risks?.find((x) => x.level === "danger");
  if (danger) return `rugcheck : ${danger.name}`;
  if (r.score_normalised > rules.maxRugScore) return `rugcheck score ${r.score_normalised} > ${rules.maxRugScore}`;

  const holders = (r.topHolders ?? []).filter((h) => h.owner !== bondingCurve).sort((a, b) => b.pct - a.pct);
  const biggest = holders[0]?.pct ?? 0;
  if (biggest > rules.maxHolderPct) return `plus gros holder ${biggest.toFixed(1)}% > ${rules.maxHolderPct}`;
  const top10 = holders.slice(0, 10).reduce((a, h) => a + h.pct, 0);
  if (top10 > rules.maxTop10Pct) return `top10 holders ${top10.toFixed(1)}% > ${rules.maxTop10Pct}`;
  const insiders = holders.filter((h) => h.insider).reduce((a, h) => a + h.pct, 0);
  if (insiders > rules.maxInsiderPct) return `insiders ${insiders.toFixed(1)}% > ${rules.maxInsiderPct}`;

  const launches = (r.creatorTokens ?? []).filter((t) => now - Date.parse(t.createdAt) < 86_400_000).length;
  return launches > rules.maxCreatorLaunches24h ? `créateur ${launches} lancements/24h > ${rules.maxCreatorLaunches24h}` : null;
}
