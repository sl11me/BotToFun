import assert from "node:assert/strict";
import { test } from "node:test";
import { h, isMint, parseCommand } from "../src/telegram.ts";

test("parseCommand : commande, mention du bot et argument", () => {
  assert.deepEqual(parseCommand("/statut"), { name: "statut", arg: "" });
  assert.deepEqual(parseCommand("  /Vendre@BrigitteBot   CAT "), { name: "vendre", arg: "CAT" });
  assert.deepEqual(parseCommand("/acheter BhE74229BwSQ7caVt8juanuGF2AgUUNMTzyogHBVpump"), { name: "acheter", arg: "BhE74229BwSQ7caVt8juanuGF2AgUUNMTzyogHBVpump" });
  assert.equal(parseCommand("salut"), null);
});

test("isMint : seulement une adresse base58 plausible", () => {
  assert.ok(isMint("BhE74229BwSQ7caVt8juanuGF2AgUUNMTzyogHBVpump"));
  assert.ok(!isMint("0OIl" + "a".repeat(40))); // caractères hors base58
  assert.ok(!isMint("court"));
  assert.ok(!isMint("BhE74229BwSQ7caVt8juanuGF2AgUUNMTzyogHBVpump; rm"));
});

test("h : un nom de token ne peut pas injecter de HTML", () => {
  assert.equal(h(`<a href="x">&</a>`), `&lt;a href="x"&gt;&amp;&lt;/a&gt;`);
});
