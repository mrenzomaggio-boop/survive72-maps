// Downloads the official alerts, signs each one and writes the feed the app
// reads: `node alerts/build.js out.json`. Without ALERTS_SIGNING_KEY it only
// prints what it found (used on pull requests).
"use strict";

const { writeFileSync } = require("node:fs");
const { METEOALARM_COUNTRIES, parseMeteoalarm, parseINGV, parseGDACS, rank } = require("./sources");
const { signAlert, isSigned, publicKeyFromSeed } = require("./sign");

const now = Math.floor(Date.now() / 1000);
const out = process.argv[2];
const seedText = process.env.ALERTS_SIGNING_KEY ?? "";

async function get(url, kind) {
  const response = await fetch(url, {
    headers: { "User-Agent": "survive72-alerts (+https://github.com/mrenzomaggio-boop/survive72-maps)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return kind === "json" ? response.json() : response.text();
}

async function main() {
  const found = [];
  const problems = [];

  await Promise.all(Object.entries(METEOALARM_COUNTRIES).map(async ([feed, country]) => {
    try {
      const json = await get(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${feed}`, "json");
      const alerts = parseMeteoalarm(json, country, now);
      console.log(`meteoalarm ${feed}: ${json?.warnings?.length ?? 0} warnings, ${alerts.length} orange/red`);
      found.push(...alerts);
    } catch (error) {
      problems.push(`meteoalarm ${feed}: ${error.message}`);
    }
  }));

  try {
    const start = new Date((now - 48 * 3600) * 1000).toISOString().slice(0, 19);
    const text = await get("https://webservices.ingv.it/fdsnws/event/1/query?format=text&minmag=4"
      + `&starttime=${start}&minlat=35&maxlat=48&minlon=6&maxlon=19.5&orderby=time`, "text");
    const alerts = parseINGV(text, now);
    console.log(`ingv: ${alerts.length} earthquakes M4+`);
    found.push(...alerts);
  } catch (error) {
    problems.push(`ingv: ${error.message}`);
  }

  try {
    const alerts = parseGDACS(await get("https://www.gdacs.org/xml/rss.xml", "text"), now);
    console.log(`gdacs: ${alerts.length} orange/red events`);
    found.push(...alerts);
  } catch (error) {
    problems.push(`gdacs: ${error.message}`);
  }

  for (const problem of problems) console.log(`::warning::${problem}`);
  const alerts = rank(found);
  console.log(`total: ${alerts.length} alerts`);
  for (const alert of alerts.slice(0, 15)) {
    console.log(`  ${alert.severity.padEnd(8)} ${alert.country} ${alert.source}: ${alert.title} — ${alert.area}`);
  }

  // Too many sources down: keep the previous feed rather than publish an empty one.
  if (problems.length > Object.keys(METEOALARM_COUNTRIES).length / 2) {
    throw new Error(`${problems.length} sources failed`);
  }
  if (!seedText) {
    console.log("No ALERTS_SIGNING_KEY: nothing signed or written.");
    return;
  }
  const seed = Buffer.from(seedText, "base64");
  const publicKey = publicKeyFromSeed(seed);
  const signed = alerts.map((alert) => signAlert(alert, seed));
  if (!signed.every((alert) => isSigned(alert, publicKey))) throw new Error("Signature check failed");
  writeFileSync(out, JSON.stringify({ version: 1, generatedAt: now, alerts: signed }) + "\n");
  console.log(`Wrote ${out} signed by ${publicKey.toString("base64")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
