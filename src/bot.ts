import { config } from "./config.ts";
import { closePosition, hasTraded, openPosition, openPositions, realizedPnlSol, type Position } from "./db.ts";
import { onNewToken } from "./feed.ts";
import { quote, SOL_MINT, swap } from "./jupiter.ts";
import { exitReason, rejectReason, type NewToken } from "./strategy.ts";

const live = config.mode === "live";
const busy = new Set<string>(); // mints en cours d'achat/vente, évite les doubles ordres

async function buy(t: NewToken) {
  const lamports = BigInt(Math.round(config.buySol * 1e9));
  const tokenAmount = live ? (await swap(SOL_MINT, t.mint, lamports)).outAmount : await quote(SOL_MINT, t.mint, lamports);
  openPosition({ mint: t.mint, symbol: t.symbol, costLamports: lamports, tokenAmount, openedAt: Date.now() });
  console.log(`[buy] ${t.symbol} ${t.mint} : ${config.buySol} SOL -> ${tokenAmount} tokens`);
}

async function check(p: Position) {
  const value = await quote(p.mint, SOL_MINT, p.tokenAmount);
  const reason = exitReason(p.costLamports, value, (Date.now() - p.openedAt) / 1000, config);
  if (!reason) return;
  const proceeds = live ? (await swap(p.mint, SOL_MINT, p.tokenAmount)).outAmount : value;
  closePosition(p.mint, proceeds, reason);
  console.log(`[sell] ${p.symbol} ${reason} -> ${Number(proceeds) / 1e9} SOL | PnL réalisé : ${realizedPnlSol().toFixed(4)} SOL`);
}

// Le verrou `busy` couvre aussi les erreurs : on relâche toujours, et l'erreur est loguée sans tuer le bot.
async function guarded(mint: string, fn: () => Promise<void>) {
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
  if (reason) return;
  if (hasTraded(t.mint) || openPositions().length + busy.size >= config.maxOpenPositions) return;
  void guarded(t.mint, () => buy(t));
});

setInterval(() => {
  for (const p of openPositions()) void guarded(p.mint, () => check(p));
}, config.pollSeconds * 1000);

console.log(`BotToFun démarré en mode ${config.mode.toUpperCase()} | ${config.buySol} SOL/position, max ${config.maxOpenPositions}`);
