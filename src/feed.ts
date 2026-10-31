import { config } from "./config.ts";
import type { NewToken } from "./strategy.ts";

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
      const msg = JSON.parse(String(e.data));
      if (msg.txType === "create") handler(msg as NewToken);
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
