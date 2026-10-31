import assert from "node:assert/strict";
import { test } from "node:test";
import { buyQuote, exitReason, inflowReason, mcapSol, rejectReason, sellQuote, socialReason, type NewToken } from "../src/strategy.ts";

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
