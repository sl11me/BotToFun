// En premier : le dashboard capture console.log dès le démarrage.
import { startDashboard } from "./dashboard.ts";
import { isOffCurveAddress, type Address } from "@solana/kit";
import { fetchBalance, fetchCurve, fetchMetadata, fetchMint, fetchRugReport } from "./chain.ts";
import { config } from "./config.ts";
import { closePosition, isBlacklisted, isKnown, logToken, openPosition, openPositions, realizedPnlSol, updatePeak, type Position } from "./db.ts";
import { onNewLaunch, onNewToken } from "./feed.ts";
import { h, isMint, notify, startTelegram } from "./telegram.ts";
import { quote, SOL_MINT, swap, tokenInfo, walletAddress } from "./jupiter.ts";
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
let evaluating = 0; // tokens en cours d'évaluation (attente du délai comprise)
let buying = 0; // achats en cours : places de position réservées
const values = new Map<string, bigint>(); // dernière valeur de revente de chaque position, pour le dashboard
// Holder hors courbe ed25519 = compte de programme (bonding curve, pool, coffre), pas un wallet : exclu de l'analyse.
// shortcut: un multisig (PDA) qui accumule passerait inaperçu ; à affiner si RugCheck le signale.
const isPool = (owner: string) => isOffCurveAddress(owner as Address);
const wait = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
let paused = false; // /pause sur Telegram : plus d'achat automatique, les ventes continuent
const chart = (mint: string) => `<a href="https://dexscreener.com/solana/${mint}">graphique</a>`;

/**
 * Filtres lents puis achat. Renvoie la décision pour la table tokens.
 * Sécurité « fail closed » : un contrôle qui lève une erreur (RPC, RugCheck, Jupiter) bloque l'achat.
 */
async function evaluate(t: NewToken): Promise<string> {
  if (isBlacklisted(t.traderPublicKey, config.rugLossPct)) return "créateur sur liste noire";
  // Sans filtre Telegram, inutile de lire les métadonnées IPFS (4,5 % d'erreurs de passerelle).
  const [meta, mint] = await Promise.all([config.requireTelegram ? fetchMetadata(t.uri!) : {}, fetchMint(t.mint)]);
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
  const meta: Record<string, any> = config.requireTelegram && rug.tokenMeta?.uri ? await fetchMetadata(rug.tokenMeta.uri) : {};
  const telegram = meta.telegram ?? meta.extensions?.telegram ?? token.telegram;
  const reason =
    socialReason({ telegram }, config.requireTelegram) ?? marketReason(token, solUsd, config) ?? rugReason(rug, isPool, Date.now(), config);
  return reason ?? simulateAndBuy(l, "");
}

/** Simulation achat + revente, puis achat (live) ou position simulée (paper). `curve` : prix local pump.fun. */
async function simulateAndBuy(t: { mint: string; symbol: string }, bondingCurve: string, curve?: Curve, manual = false): Promise<string> {
  if (paused && !manual) return "en pause";
  // Place réservée dès maintenant : deux évaluations qui finissent ensemble ne doivent pas dépasser la limite.
  if (openPositions().length + buying >= config.maxOpenPositions) return "capacité max";
  buying++;
  try {
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
    notify({
      text: `🟢 <b>Achat ${h(t.symbol)}</b>${manual ? " (manuel)" : ""} · ${config.buySol} SOL${curve ? ` · mcap ${mcapSol(curve).toFixed(1)} SOL` : ""}\n<code>${t.mint}</code> · ${chart(t.mint)}`,
      buttons: [[{ text: `Vendre ${t.symbol}`, data: `vendre ${t.mint}` }]],
    });
    return "achat";
  } finally {
    buying--;
  }
}

async function check(p: Position, forced?: string) {
  const curve = p.bondingCurve ? await fetchCurve(p.bondingCurve) : null;
  // Hors curve pump.fun active (autre plateforme, ou token migré) : prix de revente demandé à Jupiter.
  const value = (curve && !curve.complete ? sellQuote(curve, p.tokenAmount) : await quote(p.mint, SOL_MINT, p.tokenAmount)) - txCost;
  const peak = value > p.peakLamports ? value : p.peakLamports;
  if (peak !== p.peakLamports) updatePeak(p.mint, peak);
  values.set(p.mint, value);

  const reason = forced ?? exitReason(p.costLamports, value, peak, (Date.now() - p.openedAt) / 1000, config);
  if (!reason) return;
  const proceeds = live ? (await swap(p.mint, SOL_MINT, p.tokenAmount)).outAmount - txCost : value;
  closePosition(p.mint, proceeds, reason);
  values.delete(p.mint);
  console.log(`[sell] ${p.symbol} ${reason} -> ${Number(proceeds) / 1e9} SOL | PnL réalisé : ${realizedPnlSol().toFixed(4)} SOL`);
  const pnl = Number(proceeds - p.costLamports) / 1e9;
  notify(`${pnl >= 0 ? "✅" : "🔻"} <b>Vente ${h(p.symbol)}</b> · ${h(reason)}\nPnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL (${((pnl / (Number(p.costLamports) / 1e9)) * 100).toFixed(1)} %) · total ${realizedPnlSol().toFixed(4)} SOL`);
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
  // La limite de positions est vérifiée à l'achat ; ici on borne seulement la charge (RPC, RugCheck, Jupiter).
  if (evaluating >= config.maxEvaluations) return logToken(t, "trop d'évaluations en cours");
  logToken(t, "en évaluation");
  evaluating++;
  void guarded(t.mint, async () => logToken(t, await run().catch((e) => `erreur : ${(e as Error).message}`))).finally(() => evaluating--);
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

/** Achat depuis Telegram : contrôles de sécurité complets, sans les filtres de stratégie (délai, Telegram, mcap). */
async function manualBuy(mint: string): Promise<string> {
  if (!isMint(mint)) return "Adresse invalide : colle le mint du token après /acheter.";
  if (openPositions().some((p) => p.mint === mint)) return "Déjà en position sur ce token.";
  if (busy.has(mint)) return "Ce token est déjà en cours d'analyse.";
  busy.add(mint);
  try {
    const [info, mintInfo, rug] = await Promise.all([tokenInfo([mint]), fetchMint(mint), fetchRugReport(mint)]);
    const token = info.find((i) => i.id === mint);
    const l = { mint, name: token?.name ?? "", symbol: token?.symbol ?? mint.slice(0, 6), traderPublicKey: token?.dev ?? "", platform: token?.launchpad ?? undefined };
    const decision =
      (l.traderPublicKey && isBlacklisted(l.traderPublicKey, config.rugLossPct) ? "créateur sur liste noire" : null) ??
      mintReason(mintInfo) ??
      rugReason(rug, isPool, Date.now(), config) ??
      (await simulateAndBuy(l, "", undefined, true));
    logToken(l, `${decision} (manuel)`);
    return decision === "achat" ? `Achat de ${h(l.symbol)} lancé.` : `Pas d'achat de ${h(l.symbol)} : ${h(decision)}`;
  } finally {
    busy.delete(mint);
  }
}

/** Vente immédiate d'une position, par mint ou symbole. */
async function forceSell(query: string): Promise<string> {
  const q = query.toLowerCase();
  const p = openPositions().find((x) => x.mint === query || x.symbol.toLowerCase() === q);
  if (!p) return query ? `Aucune position ouverte sur ${h(query)}.` : "Précise le token : /vendre SYMBOLE";
  if (busy.has(p.mint)) return `${h(p.symbol)} est déjà en cours de vente ou d'évaluation, réessaie dans quelques secondes.`;
  await guarded(p.mint, () => check(p, "vente manuelle"));
  return openPositions().some((x) => x.mint === p.mint) ? `Échec de la vente de ${h(p.symbol)}, voir les logs.` : `${h(p.symbol)} vendu.`;
}

function status(): string {
  const open = openPositions();
  const lines = open.map((p) => {
    const v = values.get(p.mint);
    const pct = v === undefined ? "…" : `${((Number(v - p.costLamports) / Number(p.costLamports)) * 100).toFixed(1)} %`;
    return `• <b>${h(p.symbol)}</b> ${pct} · ${Math.round((Date.now() - p.openedAt) / 1000)} s`;
  });
  return [
    `<b>Brigitte</b> · ${config.mode.toUpperCase()} · achats ${paused ? "⏸ en pause" : "▶️ actifs"}`,
    `PnL réalisé : ${realizedPnlSol().toFixed(4)} SOL`,
    `Positions : ${open.length}/${config.maxOpenPositions}`,
    ...lines,
  ].join("\n");
}

const help = [
  "<b>Commandes</b>",
  "/statut : mode, PnL, positions",
  "/positions : positions avec bouton de vente",
  "/acheter MINT : achat après les contrôles de sécurité",
  "/vendre SYMBOLE : vente immédiate",
  "/pause, /reprendre : achats automatiques",
].join("\n");

void startTelegram(
  {
    start: async () => help,
    aide: async () => help,
    statut: async () => status(),
    positions: async () => {
      const open = openPositions();
      return open.length ? { text: status(), buttons: open.map((p) => [{ text: `Vendre ${p.symbol}`, data: `vendre ${p.mint}` }]) } : "Aucune position ouverte.";
    },
    acheter: (arg) => manualBuy(arg),
    vendre: (arg) => forceSell(arg),
    pause: async () => ((paused = true), "⏸ Achats automatiques en pause. Les positions ouvertes restent surveillées."),
    reprendre: async () => ((paused = false), "▶️ Achats automatiques relancés."),
  },
  [
    ["statut", "Mode, PnL et positions"],
    ["positions", "Positions ouvertes et vente"],
    ["acheter", "Acheter un token (mint)"],
    ["vendre", "Vendre une position"],
    ["pause", "Suspendre les achats auto"],
    ["reprendre", "Relancer les achats auto"],
  ],
);

setInterval(() => {
  for (const p of openPositions()) void guarded(p.mint, () => check(p));
}, config.pollSeconds * 1000);

/** Adresse et solde du wallet, pour vérifier au démarrage que c'est le bon. Jamais la clé, même dans une erreur. */
async function walletLine(): Promise<string> {
  if (!config.privateKey) return "aucun wallet (BS58_PRIVATE_KEY vide)";
  const address = await walletAddress().catch(() => null);
  if (!address) return "BS58_PRIVATE_KEY invalide";
  const balance = await fetchBalance(address).then((sol) => `${sol.toFixed(4)} SOL`, () => "solde illisible");
  return `wallet ${address} · ${balance}`;
}

startDashboard((mint) => values.get(mint));
const wallet = await walletLine();
console.log(`Brigitte démarrée en mode ${config.mode.toUpperCase()} | ${config.buySol} SOL/position, max ${config.maxOpenPositions} | ${wallet}`);
notify(`🚀 Brigitte démarrée en mode <b>${config.mode.toUpperCase()}</b> · ${config.buySol} SOL/position, max ${config.maxOpenPositions}\n${h(wallet)}`);
