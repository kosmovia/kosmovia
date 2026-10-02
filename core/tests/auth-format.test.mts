import assert from "node:assert/strict";
import test from "node:test";

import { formatAmount, shortAddress } from "../lib/pollar-horizon.ts";
import { readPublishableKey, MISSING_KEY_MESSAGE } from "../lib/pollar-config.ts";

test("formatAmount works on strings only and trims trailing zeros", () => {
  assert.equal(formatAmount("0.0000000"), "0");
  assert.equal(formatAmount("10000.0000000"), "10.000");
  assert.equal(formatAmount("1234.5600000"), "1.234,56");
  assert.equal(formatAmount("0.0000001"), "0,0000001");
  // Past 2^53 a float would lose digits; a string does not.
  assert.equal(formatAmount("9007199254740993.1234567"), "9.007.199.254.740.993,1234567");
  assert.equal(formatAmount("no es numero"), "no es numero");
});

test("shortAddress keeps the ends", () => {
  assert.equal(shortAddress("GABCDEFGHIJKLMNOPQRSTUVWXYZ"), "GABC…WXYZ");
  assert.equal(shortAddress("GABC"), "GABC");
});

test("a missing or mainnet publishable key is reported, never accepted", () => {
  const missing = readPublishableKey("");
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.message, MISSING_KEY_MESSAGE);
  assert.equal(readPublishableKey("pub_mainnet_abc").ok, false);
  assert.equal(readPublishableKey("pub_testnet_abc").ok, true);
});
