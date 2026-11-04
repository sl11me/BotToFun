const num = (key: string, def: number) => {
  const v = Number(process.env[key] ?? def);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${key} invalide : ${process.env[key]}`);
  return v;
};

const mode = process.env.MODE ?? "paper";
if (mode !== "paper" && mode !== "live") throw new Error(`MODE doit être paper ou live, reçu : ${mode}`);
if (mode === "live" && !process.env.BS58_PRIVATE_KEY) throw new Error("MODE=live exige BS58_PRIVATE_KEY");

export const config = {
  mode,
  privateKey: process.env.BS58_PRIVATE_KEY ?? "",
  rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  jupiterApiKey: process.env.JUPITER_API_KEY ?? "",
  pumpPortalApiKey: process.env.PUMPPORTAL_API_KEY ?? "",
  buySol: num("BUY_SOL", 0.05),
  maxOpenPositions: num("MAX_OPEN_POSITIONS", 3),
  maxEvaluations: num("MAX_EVALUATIONS", 10), // tokens évalués en parallèle (chacun attend ENTRY_DELAY_SECONDS)
  txCostSol: num("TX_COST_SOL", 0.0002),
  ataRentSol: num("ATA_RENT_SOL", 0.00204),
  takeProfitPct: num("TAKE_PROFIT_PCT", 40),
  stopLossPct: num("STOP_LOSS_PCT", 25),
  trailArmPct: num("TRAIL_ARM_PCT", 10),
  trailPct: num("TRAIL_PCT", 15),
  maxHoldSeconds: num("MAX_HOLD_SECONDS", 300),
  pollSeconds: num("POLL_SECONDS", 5),
  minDevBuySol: num("MIN_DEV_BUY_SOL", 0.5),
  maxDevBuySol: num("MAX_DEV_BUY_SOL", 3),
  maxMcapSol: num("MAX_MCAP_SOL", 45),
  requireTelegram: (process.env.REQUIRE_TELEGRAM ?? "true") === "true",
  entryDelaySeconds: num("ENTRY_DELAY_SECONDS", 60),
  minInflowSol: num("MIN_INFLOW_SOL", 3),
  dbPath: process.env.DB_PATH ?? "bottofun.db",
  // Sécurité (voir rugReason / mintReason dans strategy.ts)
  maxRugScore: num("MAX_RUG_SCORE", 20),
  maxTop10Pct: num("MAX_TOP10_PCT", 30),
  maxHolderPct: num("MAX_HOLDER_PCT", 10),
  maxInsiderPct: num("MAX_INSIDER_PCT", 10),
  maxCreatorLaunches24h: num("MAX_CREATOR_LAUNCHES_24H", 3),
  minLiquiditySol: num("MIN_LIQUIDITY_SOL", 4),
  maxRoundTripLossPct: num("MAX_ROUNDTRIP_LOSS_PCT", 6),
  rugLossPct: num("RUG_LOSS_PCT", 50), // perte qui met le créateur sur liste noire
  // Plateformes suivies : pump.fun (PumpPortal) + les autres via la liste Jupiter des tokens récents.
  platforms: (process.env.PLATFORMS ?? "pump.fun,letsbonk,raydium,meteora-dbc,moonshot").split(",").map((p) => p.trim()),
  launchPollSeconds: num("LAUNCH_POLL_SECONDS", 10),
  dashboardPort: num("DASHBOARD_PORT", 8080), // 0 = désactivé
  dashboardHost: process.env.DASHBOARD_HOST || "127.0.0.1",
  // Bot Telegram (créé avec @BotFather) : notifications et commandes depuis le mobile. Vide = désactivé.
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "", // seul chat autorisé à piloter Brigitte
};
