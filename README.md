# Brigitte

Bot de trading de memecoins Solana (repo `BotToFun`), source actuelle pump.fun : détecte les nouveaux tokens, filtre, entre, sort sur TP / SL / timeout.

Stack (voir `Technos.png`) : TypeScript (Node ≥ 24), Jupiter Swap V2, SQLite (`node:sqlite`), flux PumpPortal.

## Démarrage

```bash
npm install
cp .env.example .env   # ajuster les paramètres
npm start              # MODE=paper par défaut : simulation via les quotes Jupiter, aucun fonds engagé
```

Passer en réel : `MODE=live` + `BS58_PRIVATE_KEY` d'un **wallet dédié** contenant seulement ce qu'on accepte de perdre.

## Tableau de bord

Le bot sert une page temps réel sur http://localhost:8080 (`DASHBOARD_PORT`, 0 pour la couper) : flux des nouveaux tokens et décision prise, entonnoir des rejets sur la dernière heure, positions ouvertes avec PnL latent, trades fermés, logs, et derniers rapports des agents (`reports/supervision.md`, `docs/apprentissage.md`).

Sur un VPS, rien n'est exposé sur internet : `ssh -L 8080:localhost:8080 <vps>` puis ouvrir http://localhost:8080.

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
5. `src/dashboard.ts` + `dashboard.html` — page temps réel (lecture seule).
6. `src/db.ts` — SQLite : `tokens` (chaque token vu + décision) et `positions` (PnL, plus haut atteint).
7. `src/bot.ts` — orchestration.

Parcours d'un token : filtre immédiat (pool, Mayhem, dev buy, mcap) → créateur pas sur liste noire → mint sûr + Telegram dans les métadonnées → attente `ENTRY_DELAY_SECONDS` → liquidité, inflow, mcap → RugCheck → simulation achat/revente → achat.

### Sécurité

Chaque contrôle qui échoue, ou qui ne peut pas être fait (RPC, RugCheck ou Jupiter indisponible), bloque l'achat.

| Contrôle | Source | Règle |
|---|---|---|
| Mint authority | mint on-chain | doit être nulle (pas de création de tokens par le dev) |
| Freeze authority | mint on-chain | doit être nulle (pas de gel de nos tokens) |
| Extensions Token-2022 | mint on-chain | seules `metadataPointer` et `tokenMetadata` sont admises : pump.fun crée tous ses tokens en Token-2022 avec ces deux-là ; `transferHook`, `transferFeeConfig`, `permanentDelegate`, `pausable`… sont rejetées |
| Liquidité | bonding curve | ≥ `MIN_LIQUIDITY_SOL` SOL réels |
| Score RugCheck | api.rugcheck.xyz | aucun risque « danger » (dont l'historique de rug du créateur) et score ≤ `MAX_RUG_SCORE` |
| Holders | RugCheck | hors bonding curve : plus gros ≤ `MAX_HOLDER_PCT`, top 10 ≤ `MAX_TOP10_PCT`, insiders ≤ `MAX_INSIDER_PCT` |
| Créateur | RugCheck + base locale | ≤ `MAX_CREATOR_LAUNCHES_24H` lancements en 24 h ; liste noire si un de ses tokens nous a coûté ≥ `RUG_LOSS_PCT` % |
| Honeypot | quotes Jupiter | achat puis revente simulés : il faut une route de vente et une perte d'aller-retour ≤ `MAX_ROUNDTRIP_LOSS_PCT` (~3 % normal) | En paper, le prix vient de la curve on-chain et le coût inclut frais, tx et rent : les résultats sont pessimistes plutôt qu'optimistes.

Règles et sources : [docs/pumpfun-playbook.md](docs/pumpfun-playbook.md). Pistes d'optimisation : [docs/optimisations.md](docs/optimisations.md).

## Commandes

```bash
npm test          # tests de la stratégie
npm run typecheck
```

Analyser le PnL paper : `sqlite3 bottofun.db "select symbol, exit_reason, (proceeds_lamports - cost_lamports)/1e9 from positions"`.
Pourquoi les tokens sont rejetés : `sqlite3 bottofun.db "select decision, count(*) from tokens group by 1 order by 2 desc"`.
