# Playbook pump.fun — état au 31/10/2026

Base de connaissances pour coder les règles d'entrée et de sortie. **[spéc.]** = seuil de départ à backtester, non prouvé.

## 1. Mécanique

**Bonding curve** — produit constant x·y=k sur des réserves virtuelles ([docs](https://pump.fun/docs/bonding-curve)) :
- Au départ : 30 SOL virtuels et 1,073 Md de tokens virtuels, dont 793,1 M réels.
- Supply totale : 1 Md ; 206,9 M tokens réservés pour la migration.
- Prix = vSol / vTokens ; mcap de départ ≈ 28 SOL.

**Graduation** — quand les 793,1 M tokens réels sont vendus :
- vSol ≈ 115 SOL, soit ≈ 85 SOL réels.
- `progress = 100 − (solde − 206,9M)·100/793,1M` ([Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/Pumpfun/Pump-Fun-Marketcap-Bonding-Curve-API/)).
- **Raisonner en SOL, jamais en $** : le mcap USD à la graduation va de 11 k$ à 101 k$.
- Migration atomique vers PumpSwap.
- ~3 % des curves sont cotées en USDC : vérifier l'actif de cotation.

**BOOST (juillet 2026)** — ~20 % de la liquidité migrée rachète et brûle le token pendant les 5 minutes qui suivent la graduation : pression acheteuse programmée ([The Block](https://www.theblock.co/news/defi/2026-07-29-pump-fun-token-graduation-rate-jumps-boost-changes-launch-incentives-409815)).

**Frais** ([docs, 17/10/2026](https://pump.fun/docs/fees)) :
- Curve : 1,25 % (0,95 % protocole + 0,30 % créateur).
- PumpSwap : 1,25 % sous 420 SOL de mcap, dégressif au-delà.
- Graduation : 0,015 SOL.
- Le « Platform Fee » de 0,45 % ne touche que l'app web/mobile.
- **Aller-retour : ≥ 2,5 % avant slippage, tips et rent.**

**Mayhem Mode** ([docs](https://pump.fun/docs/mayhem-mode)) :
- Une IA mint 1 Md de tokens supplémentaires et trade au hasard pendant 24 h (wallet `BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s`).
- Fausse toutes les métriques et peut bloquer la revente.

**Flux PumpPortal**, vérifié sur un message réel :
- Champs : `mint`, `traderPublicKey` (créateur), `txType`, `initialBuy`, `solAmount`, `bondingCurveKey`, `vTokensInBondingCurve`, `vSolInBondingCurve`, `marketCapSol`, `name`, `symbol`, `uri`, `pool`, `is_mayhem_mode`.

## 2. Chiffres clés

| Métrique | Valeur | Source |
|---|---|---|
| Lancements par jour | 30 à 52 k | Coinmonks, août 2026 |
| Taux de graduation | 0,6 % → 2,5 % → ~4,7 % après BOOST (fenêtres de mesure différentes) | arXiv 2602.14860, The Block |
| Délai de graduation | médiane 1,7 à 4,4 min ; 90 % en < 2–3 min | arXiv |
| Tokens morts-nés | 53 % ne dépassent jamais 1 SOL dans la curve | arXiv 2610.39458 |
| Dev qui vend en < 1 min | 65 % des coins | [Bitquery](https://bitquery.io/investigations/pump-fun-snipers-bundles) |
| Bundle du dev au bloc 0 | 21 % des lancements, médiane 10 % de la supply | Bitquery |
| Gains devs + bundles | ≥ 579 M$ | Bitquery |
| Gains snipers bloc 0 | 15 M$ nets en 11 mois | Bitquery |

**Résultat le plus important** (arXiv 2610.39458, 200 k lancements) :
- Copier les wallets précoces : −4 % à −11 % par trade, **pas mieux qu'une entrée aléatoire**.
- Les faux profits en backtest viennent de trois erreurs :
  1. ignorer l'impact de sa propre position sur les réserves ;
  2. une fuite de label ;
  3. des sorties sur des prix jamais observés.

**Acheter à vSol=X et tenir jusqu'à la graduation** (arXiv 2602.14860) :
- Rentable seulement si P(graduation | vSol) > (vSol/115)².
- La probabilité de base est toujours en dessous : **l'avantage ne peut venir que de filtres supplémentaires**.

## 3. Règles d'entrée candidates

| # | Règle | Donnée | Source |
|---|---|---|---|
| E1 | Lien Telegram dans les métadonnées : graduation ×8,9. Les trois réseaux : ×17. Twitter seul : ×1,5. | fetch `uri` | arXiv 2607.02823 |
| E2 | Accumulation rapide : vSol ≥ 45 en ≤ 50 swaps, ou ≥ 60 en ≤ 100 swaps [spéc.] | `subscribeTokenTrade` | arXiv 2602.14860 |
| E3 | Part d'activité non-bot > 30 % | classification des wallets | arXiv 2602.14860 |
| E4 | Wallets « top performers » ou créateur au bon historique, en fin de curve | historique PnL en base | arXiv 2602.14860 |
| E5 | Pas d'entrée au bloc 0 : âge ≥ 60 s et dev qui n'a pas vendu [spéc.] | trades du créateur | Bitquery |
| E6 | Exclure le Mayhem Mode | `is_mayhem_mode` | docs pump.fun |
| E7 | Achat du dev entre 0,5 et 3 SOL, < 10 % de la supply [spéc.] — déjà codé | `solAmount` | Bitquery |
| E8 | Heures et jours : aucune donnée fiable, à mesurer nous-mêmes | — | — |

## 4. Règles de danger (rejet ou sortie immédiate)

| # | Règle | Donnée |
|---|---|---|
| D1 | Le dev vend → sortie immédiate | trades du `traderPublicKey` |
| D2 | Bundle > 10 % de la supply sur le bloc de lancement et les 4 txs suivantes → rejet | trades du premier bloc |
| D3 | Wallets liés, top 10 hors curve > 30 % → rejet [spéc.] | transferts SOL, holders |
| D4 | `uri` vide ou injoignable, ou nom/ticker copié dans les 24 h → rejet | fetch `uri`, cache des noms |
| D5 | Mint ou freeze authority non nulle → rejet | `getAccountInfo` sur le mint |
| D6 | Wash trading : ratio swaps/wallets uniques > 5 [spéc.] | trades par wallet |
| D7 | Créateur en série : > 3 lancements en 24 h [spéc.] | historique du créateur |

## 5. Règles de sortie (toutes [spéc.], aucun backtest public)

- **S1** — Stop à −25/−30 %. Time-stop si vSol ne gagne pas 10 SOL en 3 min.
- **S2** — Vendre 50 % à ×2 (récupère la mise), 25 % à ×3, le reste en trailing stop à −25 % du plus haut.
- **S3** — Vendre une partie avant 100 % de progression, ou tenir une fraction pendant les 5 min de BOOST puis sortir.
- **S4** — D1 ou D3 déclenché en cours de position → tout vendre.
- **S5** — Sortir en tranches si l'impact simulé dépasse 5 % (la curve contient ~85 SOL réels au maximum).

## 6. Réalité économique

- Le jeu est à somme négative : le gain des uns est la perte des autres, moins ≥ 2,5 % de frais par aller-retour, plus slippage et tips.
- Les devs et leurs bundles captent l'essentiel des gains.
- Une entrée naïve perd 4 à 11 % par trade.
- Une espérance positive est **possible mais non démontrée publiquement**. Elle demande de combiner E1 à E4, une latence faible et un backtest avec les coûts réels.
- Méthode : paper trading d'abord, puis 0,05 à 0,1 SOL par position.

**Non couvert :** heures et jours, copy trading de KOL (au-delà de l'étude négative), backtests de sortie. Plusieurs sources sont éditoriales (BloFin, Medium).
