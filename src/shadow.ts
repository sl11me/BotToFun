import { fetchCurves } from "./chain.ts";
import { config } from "./config.ts";
import { logShadow } from "./db.ts";
import { mcapSol, shadowStep, type Shadow } from "./strategy.ts";

// Suivi fantôme : trajectoire de la mcap de chaque token pump.fun, acheté ou non. Permet de tester une règle
// d'entrée ou de sortie sur des milliers de tokens en un jour, au lieu d'attendre des centaines de trades paper.
const tracked = new Map<string, Shadow & { curve: string }>();
let ticks = 0;
let running = false;

export function shadowTrack(mint: string, curve: string, mcap: number) {
  if (!config.shadowHours || tracked.has(mint) || !(mcap > 0)) return;
  const now = Date.now();
  tracked.set(mint, { curve, startAt: now, startMcap: mcap, lastAt: now, lastMcap: mcap });
  logShadow(mint, now, mcap);
}

async function tick() {
  if (running) return; // un tour lent (RPC) ne doit pas se superposer au suivant
  running = true;
  try {
    const entries = [...tracked];
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const curves = await fetchCurves(batch.map(([, s]) => s.curve));
      const now = Date.now();
      batch.forEach(([mint, s], j) => {
        const c = curves[j];
        // Annoncé par PumpPortal juste avant confirmation : on laisse une minute au compte pour apparaître.
        if (!c) return void (now - s.startAt > 60_000 && tracked.delete(mint));
        const mcap = c.vTokens > 0n ? mcapSol(c) : s.lastMcap; // curve vidée à la migration
        const { store, stop } = shadowStep(s, mcap, c.complete, now, config.shadowHours);
        if (store) {
          logShadow(mint, now, mcap, c.complete);
          s.lastAt = now;
          s.lastMcap = mcap;
        }
        if (stop) tracked.delete(mint);
      });
    }
    if (++ticks % Math.round(600 / config.shadowSeconds) === 0) console.log(`[shadow] ${tracked.size} tokens suivis`);
  } catch (e) {
    console.error(`[shadow] ${(e as Error).message}`);
  } finally {
    running = false;
  }
}

if (config.shadowHours) setInterval(tick, config.shadowSeconds * 1000);
