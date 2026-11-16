// Turns public alert feeds into the plain alerts SURVIVE 72 shows.
// Every function here is pure: it gets the downloaded text and the time,
// so the tests can run without a network.
"use strict";

const HOUR = 3600;
const LIMITS = { id: 200, title: 200, detail: 1000, area: 400, link: 300 };
const SEVERITY_ORDER = { extreme: 3, severe: 2, moderate: 1 };

// Meteoalarm feed names and the ISO country code the app uses.
const METEOALARM_COUNTRIES = {
  austria: "AT", belgium: "BE", "bosnia-herzegovina": "BA", bulgaria: "BG", croatia: "HR", cyprus: "CY",
  czechia: "CZ", denmark: "DK", estonia: "EE", finland: "FI", france: "FR", germany: "DE", greece: "GR",
  hungary: "HU", iceland: "IS", ireland: "IE", israel: "IL", italy: "IT", latvia: "LV", lithuania: "LT",
  luxembourg: "LU", malta: "MT", moldova: "MD", montenegro: "ME", netherlands: "NL",
  "republic-of-north-macedonia": "MK", norway: "NO", poland: "PL", portugal: "PT", romania: "RO",
  serbia: "RS", slovakia: "SK", slovenia: "SI", spain: "ES", sweden: "SE", switzerland: "CH",
  "united-kingdom": "GB", ukraine: "UA",
};

// GDACS gives ISO3 codes: the countries above, so their disasters also show
// to people who follow that country. Everything else goes under "WORLD".
const ISO3_TO_ISO2 = {
  AUT: "AT", BEL: "BE", BIH: "BA", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ", DNK: "DK", EST: "EE",
  FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", ISL: "IS", IRL: "IE", ISR: "IL", ITA: "IT",
  LVA: "LV", LTU: "LT", LUX: "LU", MLT: "MT", MDA: "MD", MNE: "ME", NLD: "NL", MKD: "MK", NOR: "NO",
  POL: "PL", PRT: "PT", ROU: "RO", SRB: "RS", SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE", CHE: "CH",
  GBR: "GB", UKR: "UA", ALB: "AL", SMR: "SM", VAT: "VA",
};

function clip(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

function seconds(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Common checks and clipping. Returns null for an alert that is unusable or already over. */
function finish(alert, now) {
  if (!alert.id || !alert.title || !alert.issuedAt || !alert.expiresAt) return null;
  if (alert.expiresAt <= now || alert.expiresAt <= alert.issuedAt) return null;
  // The app refuses alerts that live longer than 10 days.
  const expiresAt = Math.min(alert.expiresAt, alert.issuedAt + 10 * 24 * HOUR - 1);
  return {
    id: clip(alert.id, LIMITS.id),
    source: alert.source,
    kind: alert.kind,
    country: alert.country,
    severity: alert.severity,
    title: clip(alert.title, LIMITS.title),
    detail: clip(alert.detail, LIMITS.detail),
    area: clip(alert.area, LIMITS.area),
    link: clip(alert.link, LIMITS.link),
    issuedAt: alert.issuedAt,
    startsAt: Math.max(alert.startsAt ?? alert.issuedAt, alert.issuedAt),
    expiresAt,
  };
}

// MARK: Meteoalarm (official weather warnings of the national services in Europe)

function awareness(info) {
  const params = Array.isArray(info.parameter) ? info.parameter : [];
  const find = (name) => params.find((p) => p.valueName === name)?.value ?? "";
  const level = find("awareness_level").toLowerCase();
  let severity = null;
  if (level.includes("red")) severity = "extreme";
  else if (level.includes("orange")) severity = "severe";
  else if (level.includes("yellow")) severity = "moderate";
  else {
    const cap = String(info.severity ?? "").toLowerCase();
    if (cap === "extreme") severity = "extreme";
    else if (cap === "severe") severity = "severe";
    else if (cap === "moderate") severity = "moderate";
  }
  return { severity, type: find("awareness_type") };
}

/** Picks the Italian text, then English, then whatever there is. */
function pickInfo(infos) {
  const lang = (info) => String(info.language ?? "").toLowerCase();
  return infos.find((i) => lang(i).startsWith("it"))
    ?? infos.find((i) => lang(i).startsWith("en"))
    ?? infos[0];
}

/** Orange and red warnings only: yellow ones are daily routine. */
function parseMeteoalarm(json, country, now) {
  const warnings = Array.isArray(json?.warnings) ? json.warnings : [];
  const alerts = [];
  for (const warning of warnings) {
    const cap = warning?.alert;
    if (!cap || cap.status !== "Actual" || cap.msgType === "Cancel") continue;
    const infos = Array.isArray(cap.info) ? cap.info : [];
    if (infos.length === 0) continue;
    const info = pickInfo(infos);
    const { severity } = awareness(info);
    if (severity !== "severe" && severity !== "extreme") continue;
    const areas = (Array.isArray(info.area) ? info.area : []).map((a) => a.areaDesc).filter(Boolean);
    const startsAt = seconds(info.onset) ?? seconds(info.effective) ?? seconds(cap.sent);
    const sent = seconds(cap.sent) ?? seconds(info.effective) ?? startsAt;
    const alert = finish({
      id: `meteoalarm:${warning.uuid ?? cap.identifier}`,
      source: "meteoalarm",
      kind: "weather",
      country,
      severity,
      title: info.headline || info.event,
      detail: [info.description, info.instruction].filter(Boolean).join(" "),
      area: [...new Set(areas)].join(", "),
      link: info.web || "https://meteoalarm.org",
      // Shown from when it was sent, even if the danger starts later.
      issuedAt: Math.min(sent ?? startsAt, startsAt ?? sent),
      startsAt,
      expiresAt: seconds(info.expires),
    }, now);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

// MARK: INGV (earthquakes in and around Italy)

/** FDSN text format: #EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType */
function parseINGV(text, now) {
  const alerts = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("|");
    if (f.length < 13) continue;
    const [eventId, time, , , depth, , , , , magType, magnitude, , place] = f;
    const mag = Number(magnitude);
    if (!Number.isFinite(mag) || mag < 4) continue;
    // Times are UTC without a zone.
    const issuedAt = seconds(/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : time + "Z");
    if (!issuedAt) continue;
    const severity = mag >= 5.5 ? "extreme" : mag >= 4.5 ? "severe" : "moderate";
    const km = Number(depth);
    const alert = finish({
      id: `ingv:${eventId}`,
      source: "ingv",
      kind: "earthquake",
      country: "IT",
      severity,
      title: `Terremoto ${magType || "M"} ${mag.toFixed(1)}`,
      detail: Number.isFinite(km) ? `Profondità ${Math.round(km)} km.` : "",
      area: place,
      link: `https://terremoti.ingv.it/event/${eventId}`,
      issuedAt,
      expiresAt: issuedAt + 48 * HOUR,
    }, now);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

// MARK: GDACS (large disasters worldwide, UN and European Commission)

const GDACS_KINDS = { EQ: "earthquake", TC: "cyclone", FL: "flood", VO: "volcano", DR: "drought", WF: "fire", TS: "tsunami" };

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  if (!match) return "";
  return match[1]
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Orange and red events that are still going on. */
function parseGDACS(xml, now) {
  const alerts = [];
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const item of items) {
    const level = tag(item, "gdacs:alertlevel").toLowerCase();
    if (level !== "orange" && level !== "red") continue;
    if (tag(item, "gdacs:iscurrent").toLowerCase() === "false") continue;
    const type = tag(item, "gdacs:eventtype");
    const from = seconds(tag(item, "gdacs:fromdate")) ?? seconds(tag(item, "pubDate"));
    const to = seconds(tag(item, "gdacs:todate")) ?? from;
    if (!from) continue;
    const iso3 = tag(item, "gdacs:iso3").split(/[,;\s]+/).filter(Boolean);
    const country = iso3.map((c) => ISO3_TO_ISO2[c.toUpperCase()]).find(Boolean) ?? "WORLD";
    const alert = finish({
      id: `gdacs:${type}${tag(item, "gdacs:eventid")}-${tag(item, "gdacs:episodeid")}`,
      source: "gdacs",
      kind: GDACS_KINDS[type] ?? "disaster",
      country,
      severity: level === "red" ? "extreme" : "severe",
      title: tag(item, "title"),
      detail: tag(item, "description"),
      area: tag(item, "gdacs:country"),
      link: tag(item, "link") || "https://www.gdacs.org",
      issuedAt: from,
      // Kept 3 days after the end of the event, for people still dealing with it.
      expiresAt: Math.max(to, now) + 72 * HOUR,
    }, now);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

/** Strongest and newest first, at most `max` (the app keeps 400). */
function rank(alerts, max = 300) {
  const byId = new Map();
  for (const alert of alerts) byId.set(alert.id, alert);
  return [...byId.values()]
    .sort((a, b) => (SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]) || (b.issuedAt - a.issuedAt)
      || a.id.localeCompare(b.id))
    .slice(0, max);
}

module.exports = { METEOALARM_COUNTRIES, parseMeteoalarm, parseINGV, parseGDACS, rank, clip };
