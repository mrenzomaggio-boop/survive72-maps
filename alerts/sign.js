// Signature of one official alert. The byte layout must stay identical to
// OfficialAlert.signedBytes in the SURVIVE 72 app
// (ios/SURVIVE72/Models/OfficialAlert.swift in mrenzomaggio-boop/SURVIVE72).
"use strict";

const { createPrivateKey, createPublicKey, sign, verify } = require("node:crypto");

// PKCS#8 header for a raw 32-byte Ed25519 private key (seed).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
// SPKI header for a raw 32-byte Ed25519 public key.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Fields covered by the signature, in this order. */
const SIGNED_FIELDS = ["id", "source", "kind", "country", "severity", "title", "detail", "area", "link",
  "issuedAt", "startsAt", "expiresAt"];

function signedBytes(alert) {
  const chunks = [Buffer.from("survive72.official.alert.v1", "utf8")];
  for (const field of SIGNED_FIELDS) {
    const value = alert[field];
    if (value === undefined || value === null) throw new Error(`Missing field ${field}`);
    const part = Buffer.from(String(value), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(part.length);
    chunks.push(length, part);
  }
  return Buffer.concat(chunks);
}

function privateKeyFromSeed(seed) {
  if (seed.length !== 32) throw new Error("The signing key must be 32 bytes");
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
}

/** Raw 32-byte public key, the one built into the app. */
function publicKeyFromSeed(seed) {
  const der = createPublicKey(privateKeyFromSeed(seed)).export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

/** The alert with its signature (base64), as the app decodes it. */
function signAlert(alert, seed) {
  const signature = sign(null, signedBytes(alert), privateKeyFromSeed(seed));
  return { ...alert, signature: signature.toString("base64") };
}

function isSigned(alert, publicKey) {
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey]), format: "der", type: "spki" });
  return verify(null, signedBytes(alert), key, Buffer.from(alert.signature, "base64"));
}

module.exports = { SIGNED_FIELDS, signedBytes, signAlert, isSigned, publicKeyFromSeed };
