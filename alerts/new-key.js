// Creates the signing key pair. Run once: `node alerts/new-key.js`.
// The private key goes into the ALERTS_SIGNING_KEY secret, never into git.
// The public key goes into OfficialAlert.publicKey in the app.
"use strict";
const { randomBytes } = require("node:crypto");
const { publicKeyFromSeed } = require("./sign");

const seed = randomBytes(32);
console.log("ALERTS_SIGNING_KEY (secret):", seed.toString("base64"));
console.log("Public key for the app:     ", publicKeyFromSeed(seed).toString("base64"));
