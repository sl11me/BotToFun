# Brigitte (repo BotToFun)

Bot de trading memecoins pump.fun en TypeScript. Node ≥ 24 exécute le `.ts` directement (type stripping) : pas de build.

- `npm start` / `npm test` / `npm run typecheck`
- Docker : `docker compose up -d --build`, base dans `./data/bottofun.db`. Une seule instance du bot à la fois (local OU conteneur).
- Dashboard : http://localhost:8080 (`src/dashboard.ts`, lecture seule). Tout texte de token y passe par `esc()` (noms contrôlés par n'importe qui) ; jamais de secret dans `/api/state`.
- Imports avec extension `.ts` ; syntaxe effaçable uniquement (pas d'`enum`, pas de `namespace`).
- Toute nouvelle règle de trading va dans `src/strategy.ts` (fonctions pures) avec un test dans `test/`.
- `MODE=paper` par défaut. Ne jamais lancer en `live` ni committer `.env` / une clé privée.

## Pièges

- Compte bonding curve : `[8 discriminator][vTokens u64][vSol u64][realTokens][realSol][supply][complete u8 @48]`. Certaines curves (cotées USDC ?) ont un vSol aberrant : les filtres mcap/inflow les rejettent.
- Les tokens pump.fun sont des Token-2022 (extensions `metadataPointer` + `tokenMetadata`, autorités nulles) : ne pas rejeter Token-2022 en bloc, seulement les autres extensions (`mintReason`).
- RugCheck (`api.rugcheck.xyz`, sans clé) : `score_normalised` 1 = sain, 100 = risqué ; `topHolders` inclut la bonding curve, à exclure.
- Jupiter Tokens API (`/tokens/v2/recent`, `/search`) : les réseaux sociaux d'un token neuf sont presque toujours vides ; le Telegram se lit dans les métadonnées (URI via `rug.tokenMeta`).
- Holders : on exclut les owners hors courbe ed25519 (`isOffCurveAddress`) = bonding curve, pool DBC, coffres.
- ipfs.io, dweb.link, w3s.link ne servent plus de JSON : `fetchMetadata` essaie pump.mypinata, gateway.pinata puis 4everland.
- Jupiter renvoie 400 « not a valid token mint » pendant les premières secondes d'un token : il n'est pas encore indexé.
- PumpPortal : une seule connexion WebSocket à la fois, sinon ban IP d'1h. `subscribeTokenTrade` est payant.
- Jupiter Swap V1 (`/swap/v1/quote`) est déprécié : utiliser V2 `/order` + `/execute`.
- Frais Jupiter de 50 bps sur les tokens de moins de 24h, déjà inclus dans les quotes.
