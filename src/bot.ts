import { fetchCurve, fetchMetadata } from "./chain.ts";
import { config } from "./config.ts";
import { closePosition, hasTraded, logToken, openPosition, openPositions, realizedPnlSol, updatePeak, type Position } from "./db.ts";
import { onNewToken } from "./feed.ts";
import { quote, SOL_MINT, swap } from "./jupiter.ts";
import { buyQuote, exitReason, inflowReason, mcapSol, rejectReason, sellQuote, socialReason, type NewToken } from "./strategy.ts";

const live = config.mode === "live";
const busy = new Set<string>(); // mints en cours d'évaluation/achat/vente, évite les doubles ordres
const lamports = (sol: number) => BigInt(Math.round(sol * 1e9));
const txCost = lamports(config.txCostSol);

/** Filtres lents (métadonnées, momentum après délai), puis achat. Renvoie la décision pour la table tokens. */
async function evaluate(t: NewToken): Promise<string> {
  const social = socialReason(await fetchMetadata(t.uri!), config.requireTelegram);
  if (social) return social;

  await new Promise((r) => setTimeout(r, config.entryDelaySeconds * 1000));
  const curve = await fetchCurve(t.bondingCurveKey);
  if (curve.complete) return "déjà migré";
  const inflow = inflowReason(t.vSolInBondingCurve, curve, config.minInflowSol);
  if (inflow) return inflow;
  if (mcapSol(curve) > config.maxMcapSol) return `mcap ${mcapSol(curve)} > ${config.maxMcapSol} après délai`;

  const spend = lamports(config.buySol);
  const tokenAmount = live ? (await swap(SOL_MINT, t.mint, spend)).outAmount : buyQuote(curve, spend);
  // Coût complet : mise + frais de transaction + rent du compte de token (Jupiter ne le referme pas).
  const cost = spend + txCost + lamports(config.ataRentSol);
  openPosition({ mint: t.mint, symbol: t.symbol, bondingCurve: t.bondingCurveKey, costLamports: cost, tokenAmount, openedAt: Date.now() });
  console.log(`[buy] ${t.symbol} ${t.mint} : ${config.buySol} SOL -> ${tokenAmount} tokens (mcap ${mcapSol(curve)} SOL)`);
  return "achat";
}

async function check(p: Position) {
  const curve = await fetchCurve(p.bondingCurve);
  // Après migration vers PumpSwap, la curve est figée : on demande le prix à Jupiter.
  const value = (curve.complete ? await quote(p.mint, SOL_MINT, p.tokenAmount) : sellQuote(curve, p.tokenAmount)) - txCost;
  const peak = value > p.peakLamports ? value : p.peakLamports;
  if (peak !== p.peakLamports) updatePeak(p.mint, peak);

  const reason = exitReason(p.costLamports, value, peak, (Date.now() - p.openedAt) / 1000, config);
  if (!reason) return;
  const proceeds = live ? (await swap(p.mint, SOL_MINT, p.tokenAmount)).outAmount - txCost : value;
  closePosition(p.mint, proceeds, reason);
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

onNewToken((t) => {
  const reason = rejectReason(t, config);
  if (reason) return logToken(t, reason);
  if (hasTraded(t.mint)) return;
  if (openPositions().length + busy.size >= config.maxOpenPositions) return logToken(t, "capacité max");
  logToken(t, "en évaluation");
  void guarded(t.mint, async () => logToken(t, await evaluate(t).catch((e) => `erreur : ${(e as Error).message}`)));
});

setInterval(() => {
  for (const p of openPositions()) void guarded(p.mint, () => check(p));
}, config.pollSeconds * 1000);

console.log(`BotToFun démarré en mode ${config.mode.toUpperCase()} | ${config.buySol} SOL/position, max ${config.maxOpenPositions}`);
