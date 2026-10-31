# BotToFun

Bot de trading memecoins pump.fun en TypeScript. Node ≥ 24 exécute le `.ts` directement (type stripping) : pas de build.

- `npm start` / `npm test` / `npm run typecheck`
- Imports avec extension `.ts` ; syntaxe effaçable uniquement (pas d'`enum`, pas de `namespace`).
- Toute nouvelle règle de trading va dans `src/strategy.ts` (fonctions pures) avec un test dans `test/`.
- `MODE=paper` par défaut. Ne jamais lancer en `live` ni committer `.env` / une clé privée.

## Pièges

- Jupiter renvoie 400 « not a valid token mint » pendant les premières secondes d'un token : il n'est pas encore indexé.
- PumpPortal : une seule connexion WebSocket à la fois, sinon ban IP d'1h. `subscribeTokenTrade` est payant.
- Jupiter Swap V1 (`/swap/v1/quote`) est déprécié : utiliser V2 `/order` + `/execute`.
- Frais Jupiter de 50 bps sur les tokens de moins de 24h, déjà inclus dans les quotes.
