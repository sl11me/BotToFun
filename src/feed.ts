import { config } from "./config.ts";
import { accountOwner } from "./chain.ts";
import { recentTokens } from "./jupiter.ts";
import { platformOf, type Launch, type NewToken } from "./strategy.ts";

// PumpPortal : flux temps réel des créations de tokens pump.fun (gratuit). Doc : https://pumpportal.fun/data-api/real-time
// Une seule connexion à la fois, sinon PumpPortal ban l'IP pendant 1h.
export function onNewToken(handler: (t: NewToken) => void) {
  const url = "wss://pumpportal.fun/api/data" + (config.pumpPortalApiKey ? `?api-key=${config.pumpPortalApiKey}` : "");
  let retryMs = 1000;

  const connect = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      retryMs = 1000;
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      console.log("[feed] connecté à PumpPortal");
    };
    ws.onmessage = (e) => {
      // Une erreur dans le handler ne doit ni tuer le bot ni couper le flux.
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.txType === "create") handler(msg as NewToken);
      } catch (err) {
        console.error(`[feed] ${(err as Error).message}`);
      }
    };
    ws.onclose = () => {
      console.warn(`[feed] déconnecté, reconnexion dans ${retryMs / 1000}s`);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 60_000);
    };
    ws.onerror = () => {}; // onclose suit toujours une erreur
  };
  connect();
}

/**
 * Lancements des autres plateformes (LetsBonk, Raydium, Meteora DBC, Moonshot) via la liste Jupiter
 * des tokens récents, interrogée toutes les LAUNCH_POLL_SECONDS. pump.fun reste sur PumpPortal, plus rapide.
 */
export function onNewLaunch(handler: (l: Launch) => void) {
  const seen = new Set<string>();
  const poll = async () => {
    try {
      for (const t of await recentTokens()) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        // launchpad absent (pool créée directement) : on reconnaît le DEX au programme de la pool.
        const platform = platformOf(t.launchpad, t.launchpad || !t.firstPool ? undefined : await accountOwner(t.firstPool.id).catch(() => undefined));
        if (platform && platform !== "pump.fun" && config.platforms.includes(platform))
          handler({ mint: t.id, name: t.name, symbol: t.symbol, traderPublicKey: t.dev ?? "", platform });
      }
      if (seen.size > 5_000) seen.clear(); // shortcut: la mémoire repart de zéro, la table tokens évite de réévaluer
    } catch (err) {
      console.error(`[launches] ${(err as Error).message}`);
    }
    setTimeout(poll, config.launchPollSeconds * 1000);
  };
  void poll();
}
