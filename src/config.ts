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
};
