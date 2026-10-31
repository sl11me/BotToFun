import assert from "node:assert/strict";
import { test } from "node:test";
import { exitReason, rejectReason, type NewToken } from "../src/strategy.ts";

const rules = { minDevBuySol: 0.5, maxDevBuySol: 3, maxMcapSol: 45 };
const tok: NewToken = { mint: "M", name: "Cat", symbol: "CAT", uri: "ipfs://x", solAmount: 1, marketCapSol: 30, pool: "pump" };

test("rejectReason", () => {
  assert.equal(rejectReason(tok, rules), null);
  assert.match(rejectReason({ ...tok, solAmount: 0 }, rules)!, /dev buy/);
  assert.match(rejectReason({ ...tok, solAmount: 5 }, rules)!, /dev buy/);
  assert.match(rejectReason({ ...tok, marketCapSol: 60 }, rules)!, /mcap/);
  assert.match(rejectReason({ ...tok, uri: "" }, rules)!, /métadonnées/);
  assert.match(rejectReason({ ...tok, pool: "bonk" }, rules)!, /pool/);
});

test("exitReason", () => {
  const r = { takeProfitPct: 50, stopLossPct: 25, maxHoldSeconds: 300 };
  assert.equal(exitReason(100n, 120n, 10, r), null);
  assert.match(exitReason(100n, 150n, 10, r)!, /take profit/);
  assert.match(exitReason(100n, 75n, 10, r)!, /stop loss/);
  assert.match(exitReason(100n, 100n, 300, r)!, /timeout/);
});
