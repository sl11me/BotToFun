import assert from "node:assert/strict";
import { test } from "node:test";
import { buyQuote, exitReason, inflowReason, liquidityReason, mcapSol, mintReason, rejectReason, roundTripReason, rugReason, sellQuote, socialReason, type NewToken } from "../src/strategy.ts";

const rules = { minDevBuySol: 0.5, maxDevBuySol: 3, maxMcapSol: 45 };
const tok: NewToken = {
  mint: "M", name: "Cat", symbol: "CAT", uri: "ipfs://x", traderPublicKey: "D", bondingCurveKey: "B",
  solAmount: 1, marketCapSol: 30, vSolInBondingCurve: 31, pool: "pump", is_mayhem_mode: false,
};
const fresh = { vSol: 30_000_000_000n, vTokens: 1_073_000_000_000_000n, complete: false };

test("rejectReason", () => {
  assert.equal(rejectReason(tok, rules), null);
  assert.match(rejectReason({ ...tok, solAmount: 0 }, rules)!, /dev buy/);
  assert.match(rejectReason({ ...tok, solAmount: 5 }, rules)!, /dev buy/);
  assert.match(rejectReason({ ...tok, marketCapSol: 60 }, rules)!, /mcap/);
  assert.match(rejectReason({ ...tok, uri: "" }, rules)!, /métadonnées/);
  assert.match(rejectReason({ ...tok, pool: "bonk" }, rules)!, /pool/);
  assert.match(rejectReason({ ...tok, is_mayhem_mode: true }, rules)!, /mayhem/);
});

test("socialReason", () => {
  assert.equal(socialReason({ telegram: "https://t.me/x" }, true), null);
  assert.match(socialReason({ twitter: "x" }, true)!, /telegram/);
  assert.equal(socialReason({}, false), null);
});

test("curve : mcap de départ ~28 SOL, aller-retour perd ~2,5 % de frais", () => {
  assert.equal(mcapSol(fresh), 27);
  const spend = 1_000_000_000n;
  const tokens = buyQuote(fresh, spend);
  const after = { ...fresh, vSol: fresh.vSol + (spend * 9875n) / 10_000n, vTokens: fresh.vTokens - tokens };
  const back = sellQuote(after, tokens);
  const lossPct = (Number(spend - back) / Number(spend)) * 100;
  assert.ok(lossPct > 2.4 && lossPct < 2.6, `perte ${lossPct}`);
});

test("inflowReason", () => {
  assert.equal(inflowReason(31, { ...fresh, vSol: 35_000_000_000n }, 3), null);
  assert.match(inflowReason(31, { ...fresh, vSol: 32_000_000_000n }, 3)!, /inflow/);
});

test("exitReason", () => {
  const r = { takeProfitPct: 40, stopLossPct: 25, maxHoldSeconds: 300, trailArmPct: 10, trailPct: 15 };
  assert.equal(exitReason(100n, 105n, 105n, 10, r), null);
  assert.match(exitReason(100n, 140n, 140n, 10, r)!, /take profit/);
  assert.match(exitReason(100n, 75n, 100n, 10, r)!, /stop loss/);
  assert.match(exitReason(100n, 100n, 100n, 300, r)!, /timeout/);
  assert.equal(exitReason(100n, 108n, 120n, 10, r), null); // recul de 10 % < 15 %
  assert.match(exitReason(100n, 101n, 120n, 10, r)!, /trailing/); // recul de 16 % depuis +20 %
  assert.equal(exitReason(100n, 92n, 108n, 10, r), null); // trailing pas armé (plus haut +8 %)
});

const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const pumpMint = { program: T22, mintAuthority: null, freezeAuthority: null, extensions: [{ extension: "metadataPointer" }, { extension: "tokenMetadata" }] };

test("mintReason : un mint pump.fun standard passe, toute porte dérobée est rejetée", () => {
  assert.equal(mintReason(pumpMint), null);
  assert.match(mintReason({ ...pumpMint, mintAuthority: "DEV" })!, /mint authority/);
  assert.match(mintReason({ ...pumpMint, freezeAuthority: "DEV" })!, /freeze authority/);
  assert.match(mintReason({ ...pumpMint, extensions: [...pumpMint.extensions, { extension: "transferHook" }] })!, /transferHook/);
  assert.match(mintReason({ ...pumpMint, extensions: [{ extension: "permanentDelegate" }] })!, /permanentDelegate/);
  assert.match(mintReason({ ...pumpMint, program: "Evil111" })!, /programme/);
});

test("liquidityReason et roundTripReason", () => {
  assert.match(liquidityReason(fresh, 4)!, /liquidité 0.00/);
  assert.equal(liquidityReason({ ...fresh, vSol: 35_000_000_000n }, 4), null);
  assert.equal(roundTripReason(50_000_000n, 48_500_000n, 6), null); // -3 % : frais normaux de la curve
  assert.match(roundTripReason(50_000_000n, 40_000_000n, 6)!, /aller-retour -20.0%/);
});

test("rugReason : score, holders hors curve, insiders, créateur en série", () => {
  const sec = { maxRugScore: 20, maxTop10Pct: 30, maxHolderPct: 10, maxInsiderPct: 10, maxCreatorLaunches24h: 3 };
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ok = {
    score_normalised: 1,
    risks: [],
    topHolders: [{ owner: "B", pct: 85, insider: false }, { owner: "DEV", pct: 5, insider: false }, { owner: "X", pct: 3, insider: false }],
    creatorTokens: [{ createdAt: "2026-11-03T11:59:00Z" }],
  };
  assert.equal(rugReason(ok, "B", now, sec), null); // les 85 % de la bonding curve ne comptent pas
  assert.match(rugReason({ ...ok, risks: [{ name: "Creator history of rugged tokens", level: "danger" }] }, "B", now, sec)!, /history of rugged/);
  assert.match(rugReason({ ...ok, risks: [{ name: "Low liquidity", level: "warn" }], score_normalised: 65 }, "B", now, sec)!, /score 65/);
  assert.match(rugReason({ ...ok, topHolders: [{ owner: "W", pct: 15, insider: false }] }, "B", now, sec)!, /plus gros holder/);
  const spread = Array.from({ length: 10 }, (_, i) => ({ owner: `W${i}`, pct: 4, insider: i < 3 }));
  assert.match(rugReason({ ...ok, topHolders: spread }, "B", now, sec)!, /top10 holders 40.0%/);
  assert.match(rugReason({ ...ok, topHolders: spread.slice(0, 4) }, "B", now, sec)!, /insiders 12.0%/);
  const serial = Array.from({ length: 4 }, () => ({ createdAt: "2026-11-03T08:00:00Z" }));
  assert.match(rugReason({ ...ok, creatorTokens: serial }, "B", now, sec)!, /4 lancements/);
  assert.equal(rugReason({ ...ok, creatorTokens: [...serial.slice(0, 3), { createdAt: "2026-10-01T00:00:00Z" }] }, "B", now, sec), null);
});
