# Optimisations du bot — recherche du 31/10/2026

## À retenir d'abord : les frais fixes
Avec `BUY_SOL=0.05`, les frais fixes comptent plus que la vitesse. Coût d'un aller-retour (achat + vente) :
- **Bonding curve** : ~0,95 % par trade pour les petites caps, barème dynamique selon la capitalisation (« Project Ascend »).
- **PumpPortal trade-local** : 0,5 % par trade si on l'utilise.
- **Tip Helius Sender** : 0,001 SOL par envoi, soit 2 % de 0,05 SOL.
- **Rent du compte de token (ATA)** : ~0,002 SOL, récupérable via `closeAccount` après la vente.

**Coût total : 6 à 10 % par position avant tout mouvement de prix.** Le mode paper doit simuler ces frais, sinon il est trop optimiste.

## Priorités

### 1. Prix local à partir des réserves virtuelles (impact fort, effort faible, gratuit)
- Supprime la dépendance au délai d'indexation de Jupiter, responsable de l'erreur 400 « not a valid token mint ».
- Courbe x·y=k avec réserves virtuelles initiales : 1 073 000 000 tokens (6 décimales) et 30 SOL.
- Achat : `out = vT − k/(vS + solIn_net)`. Vente : `solOut = vS − k/(vT + tokens)`, moins les frais.
- Frais dynamiques (`fee_config`) : prendre le barème dans le source du SDK ([fees.rs](https://docs.rs/pump-rust-client/0.1.3/src/pump_rust_client/math/fees.rs.html)), pas sur les blogs.
- Suivi des positions, deux options :
  - `subscribeTokenTrade` de PumpPortal sur les mints détenus : 0,01 SOL / 10 000 messages, sur la même WebSocket.
  - Ou `getAccountInfo` RPC sur le PDA de la bonding curve.
- Vérifié : les événements `create` contiennent bien `vSolInBondingCurve`, `vTokensInBondingCurve` et `marketCapSol`.
- Docs : [programme pump.fun](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md), [flux PumpPortal](https://pumpportal.fun/data-api/real-time).

### 2. Acheter directement sur la curve (impact fort, effort moyen)
- **Étape A** : PumpPortal `POST https://pumpportal.fun/api/trade-local` (`publicKey`, `action`, `mint`, `amount`, `denominatedInSol`, `slippage`, `priorityFee`, `pool`).
  - On signe la transaction renvoyée avec `@solana/kit` et on l'envoie soi-même. Coût : 0,5 %.
  - Éviter l'API Lightning : 1 %, et la clé privée reste chez eux.
  - Docs : [trading API](https://pumpportal.fun/local-trading-api/trading-api).
- **Étape B** : SDK officiel `@pump-fun/pump-sdk`, qui supprime les 0,5 %.
  - Il traîne web3.js, anchor et bn.js.
  - Le programme change souvent (`buy_v2`, `sell_v2`, nouveaux comptes obligatoires).
- Garder Jupiter pour les tokens migrés sur PumpSwap, détectés via `subscribeMigration` (gratuit).

### 3. Envoi et confirmation des transactions (impact fort, effort faible)
- **[Helius Sender](https://www.helius.dev/docs/sending-transactions/sender)** : endpoint régional (`fra-`, `ams-`…).
  - Priority fee et tip obligatoires.
  - `?swqos_only=true` : tip de 0,000005 SOL seulement, adapté aux petites positions.
- **Alternative [Jito](https://docs.jito.wtf/lowlatencytxnsend/)** : `bundleOnly=true`, tip ≥ plancher donné par `tip_floor`.
- **Confirmation** :
  - Interroger `getSignatureStatuses` jusqu'à `confirmed`, avec N tentatives max.
  - N'enregistrer en base que la quantité réellement reçue.
- **Rent** : `closeAccount` dans la transaction de vente totale.

### 4. Risque et sorties (impact moyen à fort, effort faible — logique pure dans `strategy.ts`)
- **Trailing stop** : sortir à X % sous le plus haut atteint par la position.
- **Sorties partielles** : peu rentables à 0,05 SOL, car chaque vente coûte un tip.
- **Slippage** : serré à l'achat (5–15 %), plus large sur un stop loss d'urgence.
- **Filtres** : pas de vente du dev, nombre minimal d'acheteurs distincts. Nécessite le flux de trades.

### 5. Données basse latence (seulement si le bot est rentable)
Yellowstone gRPC filtré sur le programme `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` :

| Fournisseur | Prix |
|---|---|
| Chainstack | 49 $/mois |
| Shyft | 199 $/mois |
| Helius LaserStream | 499 $/mois |

Les latences « sous 3 ms » annoncées sont du marketing.

### 6. Infrastructure
- **Hébergement** : VPS à Francfort ou Amsterdam, avec les régions Sender et Jito.
- **Base de données** : garder SQLite. Redis est inutile avec un seul processus.
- **Monitoring** : latence, taux d'échec, frais payés, PnL net. Alertes Telegram.

### 7. Bots open source : piège sérieux
En 2025, de faux repos « pumpfun bot » volaient les clés privées via des dépendances npm piégées ([source](https://cointelegraph.com/news/solana-trading-bot-github-malware-scam)). À lire pour les idées seulement, jamais à exécuter avec une clé.

## Ordre conseillé
1. Prix local et paper réaliste (frais, rent, tip).
2. PumpPortal trade-local, Sender et confirmation des transactions.
3. Trailing stop et `closeAccount`.
4. VPS à Francfort.
5. SDK officiel.
6. gRPC, seulement si le PnL net est positif sur plusieurs centaines de trades.

## Incertain
- Le barème exact des frais de la curve.
- La cause exacte de l'erreur 400 de Jupiter.
- Les tarifs Shyft.
- Aucune mesure de latence indépendante entre PumpPortal et gRPC.
