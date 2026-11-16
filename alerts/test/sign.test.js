"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { signAlert, isSigned, publicKeyFromSeed, signedBytes } = require("../sign");
const vector = require("./vector.json");

const seed = Buffer.alloc(32, 7);
const alert = {
  id: "meteoalarm:abc", source: "meteoalarm", kind: "weather", country: "IT", severity: "severe",
  title: "Allerta arancione · piogge", detail: "Città: più di 100 mm…", area: "Liguria", link: "https://meteoalarm.org",
  issuedAt: 1794826800, startsAt: 1794855600, expiresAt: 1794898800,
};

test("a signed alert verifies and a changed one does not", () => {
  const signed = signAlert(alert, seed);
  const key = publicKeyFromSeed(seed);
  assert.ok(isSigned(signed, key));
  assert.ok(!isSigned({ ...signed, severity: "extreme" }, key));
  assert.ok(!isSigned({ ...signed, expiresAt: signed.expiresAt + 1 }, key));
});

// The app test OfficialAlertTests checks the same vector: if one side changes
// the byte layout, one of the two tests fails.
test("the shared test vector is unchanged", () => {
  const signed = signAlert(alert, seed);
  assert.deepEqual(vector, { publicKey: publicKeyFromSeed(seed).toString("base64"), alert: signed });
  assert.equal(signedBytes(alert).subarray(0, 27).toString(), "survive72.official.alert.v1");
});
