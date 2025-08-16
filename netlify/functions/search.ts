// /netlify/functions/search.ts — Amadeus Flight Offers Search
export const handler = async (event: any) => {
  try {
    const { AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET, AMADEUS_ENV } = process.env as any;
    const params = event.queryStringParameters || {};

    const fly_from = params.fly_from || "YUL";
    const dateFrom = params.dateFrom || "2025-08-18";
    const returnFrom = params.returnFrom || "2025-08-27";
    const returnTo = params.returnTo || "2025-08-31";
    const fly_to = (params.fly_to || "LYS,GVA,GNB,CMF,TRN,MXP,CDG,ORY").toUpperCase().split(",");
    const curr = params.curr || "CAD";
    const max_stopovers = Number(params.max_stopovers ?? 2);
    const excludeAC = (params.excludeAC ?? "1") === "1";
    const cabin = (params.cabin || "M").toUpperCase();

    if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
      return json(200, { ok: true, simulated: true, results: SAMPLE_RESULTS });
    }

    const base = (AMADEUS_ENV || "live") === "test"
      ? "https://test.api.amadeus.com"
      : "https://api.amadeus.com";

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

    const headers = { Authorization: `Bearer ${access_token}` } as any;
    const returnDates = enumerateDates(returnFrom, returnTo);

    const cabinMap: Record<string, string> = { M: "ECONOMY", W: "PREMIUM_ECONOMY", C: "BUSINESS" };
    const travelClass = cabinMap[cabin] || "ECONOMY";

    const results: any[] = [];

    for (const to of fly_to) {
      for (const rdate of returnDates) {
        const url = new URL(base + "/v2/shopping/flight-offers");
        url.searchParams.set("originLocationCode", fly_from);
        url.searchParams.set("destinationLocationCode", to);
        url.searchParams.set("departureDate", dateFrom);
        url.searchParams.set("returnDate", rdate);
        url.searchParams.set("adults", "1");
        url.searchParams.set("currencyCode", curr);
        url.searchParams.set("max", "5");
        url.searchParams.set("nonStop", String(max_stopovers === 0));
        url.searchParams.set("travelClass", travelClass);
        if (excludeAC) url.searchParams.set("excludeAirlineCodes", "AC");

        const res = await fetch(url.toString(), { headers } as any);
        if (!res.ok) continue;
        const data = await res.json();
        const offers = (data?.data || []).slice(0, 5);
        for (const o of offers) results.push(normalizeAmadeus(o, curr, to));
      }
    }

    results.sort((a, b) => (a.price - b.price) || (a.durationTotal - b.durationTotal));
    return json(200, { ok: true, simulated: false, results });
  } catch (e: any) {
    return text(500, e?.message || "Server error");
  }
};

function enumerateDates(start: string, end: string) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const out: string[] = [];
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
function normalizeAmadeus(o: any, currency: string, destCode: string) {
  const price = Number(o.price?.grandTotal || o.price?.total || 0);
  const itineraries = o.itineraries || [];
  const out = itineraries[0], ret = itineraries[1];
  const segmentsOut = out?.segments || [], segmentsRet = ret?.segments || [];
  const stops = Math.max(0, segmentsOut.length - 1);
  const durationTotal = parseISODuration(out?.duration) + parseISODuration(ret?.duration);
  const airlines = Array.from(new Set([...segmentsOut.map((s:any)=>s.carrierCode), ...segmentsRet.map((s:any)=>s.carrierCode)])).join(", ");
  const flyFrom = segmentsOut[0]?.departure?.iataCode || "YUL";
  const flyTo = destCode;
  const local_departure = segmentsOut[0]?.departure?.at;
  const return_departure = segmentsRet[0]?.departure?.at;
  const depDate = (local_departure || "").slice(0,10);
  const retDate = (return_departure || "").slice(0,10);
  const deepLink = `https://www.google.com/flights?hl=en#flt=${flyFrom}.${flyTo}.${depDate}*${flyTo}.${flyFrom}.${retDate};c:${currency};e:1;sd:1;t:e`;
  return { price, currency, airlines, cityFrom: flyFrom, cityTo: flyTo, flyFrom, flyTo, durationTotal, stops, deepLink, local_departure, return_departure };
}
function parseISODuration(iso: string = "PT0S") {
  const m = /P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  const h = Number(m[1] || 0), min = Number(m[2] || 0), s = Number(m[3] || 0);
  return h * 3600 + min * 60 + s;
}
function json(status: number, obj: any) {
  return { statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}
function text(status: number, body: string) {
  return { statusCode: status, body };
}
const SAMPLE_RESULTS = [
  { price: 915, currency: "CAD", airlines: "TS", cityFrom: "YUL", cityTo: "LYS", flyFrom: "YUL", flyTo: "LYS", durationTotal: 24840, stops: 0, deepLink: null, local_departure: "2025-08-18T19:45:00-04:00", return_departure: "2025-08-28T12:10:00+02:00" },
  { price: 1045, currency: "CAD", airlines: "AF", cityFrom: "YUL", cityTo: "CDG", flyFrom: "YUL", flyTo: "CDG", durationTotal: 24480, stops: 0, deepLink: null, local_departure: "2025-08-18T21:15:00-04:00", return_departure: "2025-08-27T13:20:00+02:00" },
  { price: 745, currency: "CAD", airlines: "W4, U2", cityFrom: "YUL", cityTo: "GVA", flyFrom: "YUL", flyTo: "GVA", durationTotal: 41040, stops: 1, deepLink: null, local_departure: "2025-08-18T17:30:00-04:00", return_departure: "2025-08-30T08:45:00+02:00" }
];
