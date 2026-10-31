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

## Docker / VPS

Un seul conteneur, jamais plus : PumpPortal bannit l'IP au-delà d'une connexion WebSocket, et deux instances achèteraient deux fois le même token.

```bash
docker compose up -d --build   # base dans ./data/bottofun.db, relance automatique
docker compose logs -f
```

Déploiement sur un VPS (Hetzner Falkenstein/Nuremberg, proche de Francfort) :

```bash
git clone git@github.com:sl11me/BotToFun.git && cd BotToFun
cp .env.example .env && chmod 600 .env   # RPC_URL obligatoire pour tourner 24/7
mkdir -p data && sudo chown 1000:1000 data   # l'utilisateur node du conteneur doit pouvoir écrire
docker compose up -d --build
```

Mise à jour : `git pull && docker compose up -d --build`. Arrêter le bot local avant de lancer celui du VPS si les deux partagent la même IP.

## Fonctionnement

1. `src/feed.ts` — WebSocket PumpPortal, événements `create` des nouveaux tokens.
2. `src/strategy.ts` — règles pures : filtres d'entrée, maths de la bonding curve (frais 1,25 %), sorties TP / SL / trailing / timeout.
3. `src/chain.ts` — lecture on-chain de la bonding curve (RPC) et des métadonnées du token.
4. `src/jupiter.ts` — order + sign + execute (live) via `api.jup.ag/swap/v2`, et prix des tokens migrés.
5. `src/db.ts` — SQLite : `tokens` (chaque token vu + décision) et `positions` (PnL, plus haut atteint).
6. `src/bot.ts` — orchestration.

Parcours d'un token : filtre immédiat (pool, Mayhem, dev buy, mcap) → Telegram dans les métadonnées → attente `ENTRY_DELAY_SECONDS` → au moins `MIN_INFLOW_SOL` entrés dans la curve → achat. En paper, le prix vient de la curve on-chain et le coût inclut frais, tx et rent : les résultats sont pessimistes plutôt qu'optimistes.

Règles et sources : [docs/pumpfun-playbook.md](docs/pumpfun-playbook.md). Pistes d'optimisation : [docs/optimisations.md](docs/optimisations.md).

## Commandes

```bash
npm test          # tests de la stratégie
npm run typecheck
```

Analyser le PnL paper : `sqlite3 bottofun.db "select symbol, exit_reason, (proceeds_lamports - cost_lamports)/1e9 from positions"`.
Pourquoi les tokens sont rejetés : `sqlite3 bottofun.db "select decision, count(*) from tokens group by 1 order by 2 desc"`.
