# BotToFun

Bot de trading de memecoins pump.fun (Solana) : détecte les nouveaux tokens, filtre, entre, sort sur TP / SL / timeout.

Stack (voir `Technos.png`) : TypeScript (Node ≥ 24), Jupiter Swap V2, SQLite (`node:sqlite`), flux PumpPortal.

## Démarrage

```bash
npm install
cp .env.example .env   # ajuster les paramètres
npm start              # MODE=paper par défaut : simulation via les quotes Jupiter, aucun fonds engagé
```

Passer en réel : `MODE=live` + `BS58_PRIVATE_KEY` d'un **wallet dédié** contenant seulement ce qu'on accepte de perdre.

## Fonctionnement

1. `src/feed.ts` — WebSocket PumpPortal, événements `create` des nouveaux tokens.
2. `src/strategy.ts` — règles pures : filtre d'entrée (`rejectReason`) et de sortie (`exitReason`).
3. `src/jupiter.ts` — quote (paper) ou order + sign + execute (live) via `api.jup.ag/swap/v2`.
4. `src/db.ts` — positions et PnL dans SQLite (`bottofun.db`).
5. `src/bot.ts` — orchestration : achat sur signal, vérification des positions toutes les `POLL_SECONDS`.

## Commandes

```bash
npm test          # tests de la stratégie
npm run typecheck
```

Analyser le PnL paper : `sqlite3 bottofun.db "select symbol, exit_reason, (proceeds_lamports - cost_lamports)/1e9 from positions"`.
