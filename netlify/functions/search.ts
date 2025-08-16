// /netlify/functions/search.js — Amadeus Flight Offers Search (with sandbox fallback)
export const handler = async (event) => {
  try {
    const { AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET, AMADEUS_ENV } = process.env;
    const params = event.queryStringParameters || {};

    const fly_from = params.fly_from || "YUL";
    const dateFrom = params.dateFrom || "2025-08-18";
    const returnFrom = params.returnFrom || "2025-08-27";
    const returnTo = params.returnTo || "2025-08-31";
    const curr = params.curr || "CAD";
    const excludeAC = (params.excludeAC ?? "1") === "1";
    const cabin = (params.cabin || "M").toUpperCase(); // M/W/C
    let max_stopovers = Number(params.max_stopovers ?? 1);

    // Primary target airports (≤~4h train/drive to Albertville)
    const PRIMARY_TO = (params.fly_to || "LYS,GVA,GNB,CMF,TRN,MXP,CDG,ORY").toUpperCase().split(",");

    // Wider hubs fallback (sandbox-friendly & still viable with TGV/drive)
    const HUBS = ["CDG","ORY","LHR","AMS","FRA","ZRH","BCN","MAD","BRU","FCO","VCE","MXP","LIN","LYS","GVA","TRN","GNB","CMF"];

    // If no keys, return samples
    if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
      return json(200, { ok: true, simulated: true, results: SAMPLE_RESULTS, note: "No Amadeus creds; showing sample results." });
    }

    const base = (AMADEUS_ENV || "live") === "test"
      ? "https://test.api.amadeus.com"
      : "https://api.amadeus.com";

    // OAuth
    const tokenRes = await fetch(base + "/v1/security/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: AMADEUS_CLIENT_ID,
        client_secret: AMADEUS_CLIENT_SECRET,
      }),
    });
    if (!tokenRes.ok) return text(tokenRes.status, await tokenRes.text());
    const { access_token } = await tokenRes.json();
    const headers = { Authorization: `Bearer ${access_token}` };

    // Helper to run a batch
    const runBatch = async (tos, depDate, retFrom, retTo, stops, tag) => {
      const retDates = enumerateDates(retFrom, retTo);
      const cabinMap = { M: "ECONOMY", W: "PREMIUM_ECONOMY", C: "BUSINESS" };
      const travelClass = cabinMap[cabin] || "ECONOMY";
      const out = [];

      for (const to of tos) {
        for (const rdate of retDates) {
          const url = new URL(base + "/v2/shopping/flight-offers");
          url.searchParams.set("originLocationCode", fly_from);
          url.searchParams.set("destinationLocationCode", to);
          url.searchParams.set("departureDate", depDate);
          url.searchParams.set("returnDate", rdate);
          url.searchParams.set("adults", "1");
          url.searchParams.set("currencyCode", curr);
          url.searchParams.set("max", "5");
          url.searchParams.set("nonStop", String(stops === 0));
          url.searchParams.set("travelClass", travelClass);
          if (excludeAC) url.searchParams.set("excludeAirlineCodes", "AC");

          const res = await fetch(url.toString(), { headers });
          if (!res.ok) continue;
          const data = await res.json();
          const offers = (data?.data || []).slice(0, 5);
          for (const o of offers) out.push({ ...normalizeAmadeus(o, curr, to), _tag: tag });
        }
      }
      return out;
    };

    // 1) Try the primary list with user’s stop limit & dates
    let results = await runBatch(PRIMARY_TO, dateFrom, returnFrom, returnTo, max_stopovers, "primary");

    // 2) If sandbox & empty, broaden: allow up to 2 stops + extend return window by +3 days
    if ((AMADEUS_ENV || "live") === "test" && results.length === 0) {
      const widenedTo = addDays(returnTo, 3);
      max_stopovers = Math.max(max_stopovers, 2);
      results = await runBatch(HUBS, dateFrom, returnFrom, widenedTo, max_stopovers, "fallback");
    }

    // Sort & respond
    results.sort((a, b) => (a.price - b.price) || (a.durationTotal - b.durationTotal));
    const note = ((AMADEUS_ENV || "live") === "test" && results.length === 0)
      ? "Amadeus sandbox returned 0 results (very limited inventory). Try production or broaden parameters."
      : ((AMADEUS_ENV || "live") === "test" ? "Sandbox mode with broadened search." : "Live mode.");

    return json(200, { ok: true, simulated: false, env: (AMADEUS_ENV || "live"), results, note });
  } catch (e) {
    return text(500, e?.message || "Server error");
  }
};

function enumerateDates(start, end) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const out = [];
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function normalizeAmadeus(o, currency, destCode) {
  const price = Number(o?.price?.grandTotal || o?.price?.total || 0);
  const itineraries = o?.itineraries || [];
  const out = itineraries[0], ret = itineraries[1];
  const segO = out?.segments || [], segR = ret?.segments || [];
  const stops = Math.max(0, segO.length - 1);
  const durationTotal = parseISODuration(out?.duration) + parseISODuration(ret?.duration);
  const airlines = Array.from(new Set([...segO.map(s=>s.carrierCode), ...segR.map(s=>s.carrierCode)])).join(", ");
  const flyFrom = segO[0]?.departure?.iataCode || "YUL";
  const flyTo = destCode;
  const local_departure = segO[0]?.departure?.at;
  const return_departure = segR[0]?.departure?.at;
  const depDate = (local_departure || "").slice(0, 10);
  const retDate = (return_departure || "").slice(0, 10);
  const deepLink = `https://www.google.com/flights?hl=en#flt=${flyFrom}.${flyTo}.${depDate}*${flyTo}.${flyFrom}.${retDate};c:${currency};e:1;sd:1;t:e`;
  return { price, currency, airlines, cityFrom: flyFrom, cityTo: flyTo, flyFrom, flyTo, durationTotal, stops, deepLink, local_departure, return_departure };
}
function parseISODuration(iso = "PT0S") {
  const m = /P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  const h = Number(m[1] || 0), min = Number(m[2] || 0), s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}
function json(status, obj) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}
function text(status, body) {
  return { statusCode: status, body };
}
const SAMPLE_RESULTS = [
  { price: 915, currency: "CAD", airlines: "TS", cityFrom: "YUL", cityTo: "LYS", flyFrom: "YUL", flyTo: "LYS", durationTotal: 24840, stops: 0, deepLink: null, local_departure: "2025-08-18T19:45:00-04:00", return_departure: "2025-08-28T12:10:00+02:00" },
  { price: 1045, currency: "CAD", airlines: "AF", cityFrom: "YUL", cityTo: "CDG", flyFrom: "YUL", flyTo: "CDG", durationTotal: 24480, stops: 0, deepLink: null, local_departure: "2025-08-18T21:15:00-04:00", return_departure: "2025-08-27T13:20:00+02:00" },
  { price: 745, currency: "CAD", airlines: "W4, U2", cityFrom: "YUL", cityTo: "GVA", flyFrom: "YUL", flyTo: "GVA", durationTotal: 41040, stops: 1, deepLink: null, local_departure: "2025-08-18T17:30:00-04:00", return_departure: "2025-08-30T08:45:00+02:00" }
];
