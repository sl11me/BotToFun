// En premier : le dashboard capture console.log dès le démarrage.
import { startDashboard } from "./dashboard.ts";
import { isOffCurveAddress, type Address } from "@solana/kit";
import { fetchCurve, fetchMetadata, fetchMint, fetchRugReport } from "./chain.ts";
import { config } from "./config.ts";
import { closePosition, isBlacklisted, isKnown, logToken, openPosition, openPositions, realizedPnlSol, updatePeak, type Position } from "./db.ts";
import { onNewLaunch, onNewToken } from "./feed.ts";
import { quote, SOL_MINT, swap, tokenInfo } from "./jupiter.ts";
import {
  buyQuote,
  exitReason,
  inflowReason,
  liquidityReason,
  marketReason,
  mcapSol,
  mintReason,
  rejectReason,
  roundTripReason,
  rugReason,
  sellQuote,
  socialReason,
  type Curve,
  type Launch,
  type NewToken,
} from "./strategy.ts";

const live = config.mode === "live";
const busy = new Set<string>(); // mints en cours d'évaluation/achat/vente, évite les doubles ordres
const lamports = (sol: number) => BigInt(Math.round(sol * 1e9));
const txCost = lamports(config.txCostSol);
const values = new Map<string, bigint>(); // dernière valeur de revente de chaque position, pour le dashboard
// Holder hors courbe ed25519 = compte de programme (bonding curve, pool, coffre), pas un wallet : exclu de l'analyse.
// shortcut: un multisig (PDA) qui accumule passerait inaperçu ; à affiner si RugCheck le signale.
const isPool = (owner: string) => isOffCurveAddress(owner as Address);
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * Filtres lents puis achat. Renvoie la décision pour la table tokens.
 * Sécurité « fail closed » : un contrôle qui lève une erreur (RPC, RugCheck, Jupiter) bloque l'achat.
 */
async function evaluate(t: NewToken): Promise<string> {
  if (isBlacklisted(t.traderPublicKey, config.rugLossPct)) return "créateur sur liste noire";
  const [meta, mint] = await Promise.all([fetchMetadata(t.uri!), fetchMint(t.mint)]);
  const early = mintReason(mint) ?? socialReason(meta, config.requireTelegram);
  if (early) return early;

  await wait(config.entryDelaySeconds);
  const [curve, rug] = await Promise.all([fetchCurve(t.bondingCurveKey), fetchRugReport(t.mint)]);
  if (curve.complete) return "déjà migré";
  const reason =
    liquidityReason(curve, config.minLiquiditySol) ??
    inflowReason(t.vSolInBondingCurve, curve, config.minInflowSol) ??
    (mcapSol(curve) > config.maxMcapSol ? `mcap ${mcapSol(curve)} > ${config.maxMcapSol} après délai` : null) ??
    rugReason(rug, isPool, Date.now(), config);
  return reason ?? simulateAndBuy(t, t.bondingCurveKey, curve);
}

/** LetsBonk, Raydium, Meteora DBC, Moonshot : mêmes contrôles de sécurité, marché lu chez Jupiter. */
async function evaluateLaunch(l: Launch): Promise<string> {
  if (isBlacklisted(l.traderPublicKey, config.rugLossPct)) return "créateur sur liste noire";
  const early = mintReason(await fetchMint(l.mint));
  if (early) return early;

  await wait(config.entryDelaySeconds);
  const [info, rug] = await Promise.all([tokenInfo([l.mint, SOL_MINT]), fetchRugReport(l.mint)]);
  const token = info.find((i) => i.id === l.mint);
  const solUsd = info.find((i) => i.id === SOL_MINT)?.usdPrice;
  if (!token || !solUsd) throw new Error("données Jupiter absentes");
  // Jupiter ne connaît pas encore les réseaux sociaux d'un token neuf : on lit ses métadonnées (URI fournie par RugCheck).
  const meta: Record<string, any> = rug.tokenMeta?.uri ? await fetchMetadata(rug.tokenMeta.uri) : {};
  const telegram = meta.telegram ?? meta.extensions?.telegram ?? token.telegram;
  const reason =
    socialReason({ telegram }, config.requireTelegram) ?? marketReason(token, solUsd, config) ?? rugReason(rug, isPool, Date.now(), config);
  return reason ?? simulateAndBuy(l, "");
}

/** Simulation achat + revente, puis achat (live) ou position simulée (paper). `curve` : prix local pump.fun. */
async function simulateAndBuy(t: { mint: string; symbol: string }, bondingCurve: string, curve?: Curve): Promise<string> {
  // Simulation achat puis revente : un token invendable (honeypot) ou trop taxé échoue ici.
  const spend = lamports(config.buySol);
  const simulated = await quote(SOL_MINT, t.mint, spend)
    .then(async (out) => ({ out, back: await quote(t.mint, SOL_MINT, out) }))
    .catch((e) => e as Error);
  if (simulated instanceof Error) {
    console.error(`[sim] ${t.symbol} ${t.mint}: ${simulated.message}`);
    // Message court et stable : la réponse Jupiter contient un requestId qui éclaterait l'entonnoir du dashboard.
    return simulated.message.startsWith("/order") ? "simulation impossible : aucune route Jupiter" : `simulation impossible : ${simulated.name}`;
  }
  const roundTrip = roundTripReason(spend, simulated.back, config.maxRoundTripLossPct);
  if (roundTrip) return roundTrip;

  const tokenAmount = live ? (await swap(SOL_MINT, t.mint, spend)).outAmount : curve ? buyQuote(curve, spend) : simulated.out;
  // Coût complet : mise + frais de transaction + rent du compte de token (Jupiter ne le referme pas).
  const cost = spend + txCost + lamports(config.ataRentSol);
  openPosition({ mint: t.mint, symbol: t.symbol, bondingCurve, costLamports: cost, tokenAmount, openedAt: Date.now() });
  console.log(`[buy] ${t.symbol} ${t.mint} : ${config.buySol} SOL -> ${tokenAmount} tokens${curve ? ` (mcap ${mcapSol(curve)} SOL)` : ""}`);
  return "achat";
}

async function check(p: Position) {
  const curve = p.bondingCurve ? await fetchCurve(p.bondingCurve) : null;
  // Hors curve pump.fun active (autre plateforme, ou token migré) : prix de revente demandé à Jupiter.
  const value = (curve && !curve.complete ? sellQuote(curve, p.tokenAmount) : await quote(p.mint, SOL_MINT, p.tokenAmount)) - txCost;
  const peak = value > p.peakLamports ? value : p.peakLamports;
  if (peak !== p.peakLamports) updatePeak(p.mint, peak);
  values.set(p.mint, value);

  const reason = exitReason(p.costLamports, value, peak, (Date.now() - p.openedAt) / 1000, config);
  if (!reason) return;
  const proceeds = live ? (await swap(p.mint, SOL_MINT, p.tokenAmount)).outAmount - txCost : value;
  closePosition(p.mint, proceeds, reason);
  values.delete(p.mint);
  console.log(`[sell] ${p.symbol} ${reason} -> ${Number(proceeds) / 1e9} SOL | PnL réalisé : ${realizedPnlSol().toFixed(4)} SOL`);
}

// Le verrou `busy` est toujours relâché ; une erreur est loguée sans tuer le bot.
async function guarded(mint: string, fn: () => Promise<unknown>) {
  if (busy.has(mint)) return;
  busy.add(mint);
  try {
    await fn();
  } catch (e) {
    console.error(`[err] ${mint}: ${(e as Error).message}`);
  } finally {
    busy.delete(mint);
  }
}

/** Point d'entrée commun aux flux : un mint n'est évalué qu'une fois, dans la limite des positions. */
function consider(t: Launch, run: () => Promise<string>) {
  if (busy.has(t.mint) || isKnown(t.mint)) return;
  if (openPositions().length + busy.size >= config.maxOpenPositions) return logToken(t, "capacité max");
  logToken(t, "en évaluation");
  void guarded(t.mint, async () => logToken(t, await run().catch((e) => `erreur : ${(e as Error).message}`)));
}

onNewToken((t) => {
  // PumpPortal relaie aussi LetsBonk : même parcours que les lancements vus par Jupiter.
  if (t.pool === "bonk") {
    const l = { mint: t.mint, name: t.name, symbol: t.symbol, traderPublicKey: t.traderPublicKey, platform: "letsbonk" };
    if (config.platforms.includes("letsbonk")) consider(l, () => evaluateLaunch(l));
    return;
  }
  if (!config.platforms.includes("pump.fun")) return;
  const token = { ...t, platform: "pump.fun" };
  const reason = rejectReason(t, config);
  if (reason) return isKnown(t.mint) || logToken(token, reason);
  consider(token, () => evaluate(t));
});

onNewLaunch((l) => consider(l, () => evaluateLaunch(l)));

setInterval(() => {
  for (const p of openPositions()) void guarded(p.mint, () => check(p));
}, config.pollSeconds * 1000);

startDashboard((mint) => values.get(mint));
console.log(`Brigitte démarrée en mode ${config.mode.toUpperCase()} | ${config.buySol} SOL/position, max ${config.maxOpenPositions}`);
