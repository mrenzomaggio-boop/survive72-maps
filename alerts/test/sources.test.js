"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMeteoalarm, parseINGV, parseGDACS, rank } = require("../sources");

const NOW = Date.parse("2026-11-16T12:00:00Z") / 1000;

function warning(level, extra = {}) {
  return {
    uuid: `u-${level}`,
    alert: {
      status: "Actual", msgType: "Alert", sent: "2026-11-16T08:00:00+01:00",
      info: [
        { language: "en-GB", headline: "Orange wind warning", event: "Wind", severity: "Severe",
          onset: "2026-11-16T18:00:00+01:00", expires: "2026-11-17T06:00:00+01:00",
          parameter: [{ valueName: "awareness_level", value: `3; ${level}; Severe` }],
          area: [{ areaDesc: "Liguria" }] },
        { language: "it-IT", headline: "Allerta arancione vento", event: "Vento", severity: "Severe",
          description: "Raffiche   fino a 100 km/h.", instruction: "Restate in casa.",
          onset: "2026-11-16T18:00:00+01:00", expires: "2026-11-17T06:00:00+01:00", web: "https://example.org",
          parameter: [{ valueName: "awareness_level", value: `3; ${level}; Severe` }],
          area: [{ areaDesc: "Liguria" }, { areaDesc: "Toscana" }, { areaDesc: "Liguria" }] },
      ],
      ...extra,
    },
  };
}

test("Meteoalarm keeps orange and red, in Italian", () => {
  const json = { warnings: [warning("orange"), warning("yellow"), warning("red")] };
  const alerts = parseMeteoalarm(json, "IT", NOW);
  assert.equal(alerts.length, 2);
  const orange = alerts.find((a) => a.severity === "severe");
  assert.equal(orange.id, "meteoalarm:u-orange");
  assert.equal(orange.title, "Allerta arancione vento");
  assert.equal(orange.detail, "Raffiche fino a 100 km/h. Restate in casa.");
  assert.equal(orange.area, "Liguria, Toscana");
  assert.equal(orange.country, "IT");
  assert.equal(orange.issuedAt, Date.parse("2026-11-16T07:00:00Z") / 1000);
  assert.equal(orange.startsAt, Date.parse("2026-11-16T17:00:00Z") / 1000);
  assert.equal(alerts.find((a) => a.severity === "extreme").id, "meteoalarm:u-red");
});

test("Meteoalarm skips cancelled, test and expired warnings", () => {
  const expired = warning("red");
  expired.alert.info.forEach((i) => { i.expires = "2026-11-15T00:00:00Z"; });
  const json = { warnings: [warning("red", { msgType: "Cancel" }), warning("red", { status: "Test" }), expired] };
  assert.deepEqual(parseMeteoalarm(json, "IT", NOW), []);
  assert.deepEqual(parseMeteoalarm({}, "IT", NOW), []);
});

test("INGV keeps earthquakes from magnitude 4", () => {
  const text = [
    "#EventID|Time|Latitude|Longitude|Depth/Km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
    "4100001|2026-11-16T09:30:00.120000|42.8|13.1|9.6|SURVEY-INGV||||ML|4.6|--|3 km SW Norcia (PG)|earthquake",
    "4100002|2026-11-16T10:00:00.000000|42.8|13.1|9.6|SURVEY-INGV||||ML|3.1|--|Norcia (PG)|earthquake",
  ].join("\n");
  const alerts = parseINGV(text, NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "ingv:4100001");
  assert.equal(alerts[0].title, "Terremoto ML 4.6");
  assert.equal(alerts[0].severity, "severe");
  assert.equal(alerts[0].area, "3 km SW Norcia (PG)");
  assert.equal(alerts[0].issuedAt, Date.parse("2026-11-16T09:30:00Z") / 1000);
  assert.equal(alerts[0].expiresAt, alerts[0].issuedAt + 48 * 3600);
});

test("GDACS keeps current orange and red events", () => {
  const item = (level, iso3, current = "true") => `<item><title><![CDATA[Red flood alert in Italy]]></title>
    <description>Flood &amp; landslides</description><link>https://www.gdacs.org/report.aspx?eventid=1</link>
    <gdacs:alertlevel>${level}</gdacs:alertlevel><gdacs:eventtype>FL</gdacs:eventtype>
    <gdacs:eventid>1001</gdacs:eventid><gdacs:episodeid>2</gdacs:episodeid>
    <gdacs:fromdate>Sun, 15 Nov 2026 00:00:00 GMT</gdacs:fromdate><gdacs:todate>Mon, 16 Nov 2026 00:00:00 GMT</gdacs:todate>
    <gdacs:iscurrent>${current}</gdacs:iscurrent><gdacs:country>Italy</gdacs:country><gdacs:iso3>${iso3}</gdacs:iso3></item>`;
  const xml = `<rss><channel>${item("Red", "ITA")}${item("Green", "ITA")}${item("Orange", "PHL")}${item("Red", "ITA", "false")}</channel></rss>`;
  const alerts = parseGDACS(xml, NOW);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].country, "IT");
  assert.equal(alerts[0].kind, "flood");
  assert.equal(alerts[0].severity, "extreme");
  assert.equal(alerts[0].detail, "Flood & landslides");
  assert.equal(alerts[0].expiresAt, NOW + 72 * 3600);
  assert.equal(alerts[1].country, "WORLD");
});

test("rank puts the strongest and newest first and removes duplicates", () => {
  const base = { source: "x", kind: "weather", country: "IT", title: "t", detail: "", area: "", link: "",
    startsAt: 1, expiresAt: 2 };
  const ranked = rank([
    { ...base, id: "a", severity: "moderate", issuedAt: 5 },
    { ...base, id: "b", severity: "extreme", issuedAt: 1 },
    { ...base, id: "c", severity: "moderate", issuedAt: 9 },
    { ...base, id: "a", severity: "moderate", issuedAt: 5 },
  ]);
  assert.deepEqual(ranked.map((a) => a.id), ["b", "c", "a"]);
});
