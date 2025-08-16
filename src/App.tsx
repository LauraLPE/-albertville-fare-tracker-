import React, { useEffect, useMemo, useState } from "react"

const secondsToHMM = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return `${h}h ${m}m`
}

const AIRPORTS = [
  { code: "LYS", name: "Lyon" },
  { code: "GVA", name: "Geneva" },
  { code: "GNB", name: "Grenoble" },
  { code: "CMF", name: "Chambéry" },
  { code: "TRN", name: "Turin" },
  { code: "MXP", name: "Milan Malpensa" },
  { code: "CDG", name: "Paris CDG" },
  { code: "ORY", name: "Paris Orly" },
]

export default function App() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<any[]>([])

  const [excludeAC, setExcludeAC] = useState(true)
  const [maxStops, setMaxStops] = useState(1)
  const [cabin, setCabin] = useState<"M" | "W" | "C">("M")
  const [returnFrom, setReturnFrom] = useState("2025-08-27")
  const [returnTo, setReturnTo] = useState("2025-08-31")
  const [selectedAirports, setSelectedAirports] = useState<string[]>(AIRPORTS.map(a => a.code))

  const fly_to = useMemo(() => selectedAirports.join(","), [selectedAirports])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        fly_from: "YUL",
        dateFrom: "2025-08-18",
        returnFrom,
        returnTo,
        curr: "CAD",
        max_stopovers: String(maxStops),
        excludeAC: excludeAC ? "1" : "0",
        cabin,
        fly_to,
      })
      const res = await fetch(`/api/search?${qs.toString()}`)
      const json = await res.json()
      if (!json?.ok) throw new Error("Search failed")
      setResults(json.results || [])
    } catch (e: any) {
      setError(e?.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => (a.price - b.price) || (a.durationTotal - b.durationTotal))
  }, [results])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Albertville Fare Tracker</h1>
          <p className="text-gray-600">YUL → Alps (≤4h by car/train): Lyon, Geneva, Grenoble, Chambéry, Turin, Milan, Paris</p>
        </header>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">Return Window</h2>
            <label className="block text-sm text-gray-600">Return From</label>
            <input type="date" value={returnFrom} onChange={e => setReturnFrom(e.target.value)} className="w-full border rounded p-2 mb-2" />
            <label className="block text-sm text-gray-600">Return To</label>
            <input type="date" value={returnTo} onChange={e => setReturnTo(e.target.value)} className="w-full border rounded p-2" />
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">Filters</h2>
            <div className="flex items-center justify-between mb-2">
              <span>Exclude Air Canada (AC)</span>
              <input type="checkbox" checked={excludeAC} onChange={e => setExcludeAC(e.target.checked)} />
            </div>
            <div className="mb-2">
              <label className="block text-sm text-gray-600">Max Stops</label>
              <select className="w-full border rounded p-2" value={maxStops} onChange={e => setMaxStops(Number(e.target.value))}>
                <option value={0}>Direct only</option>
                <option value={1}>Up to 1 stop</option>
                <option value={2}>Up to 2 stops</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600">Cabin</label>
              <select className="w-full border rounded p-2" value={cabin} onChange={e => setCabin(e.target.value as any)}>
                <option value="M">Economy</option>
                <option value="W">Premium Economy</option>
                <option value="C">Business</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">Target Airports</h2>
            <div className="grid grid-cols-2 gap-2">
              {AIRPORTS.map(a => (
                <label key={a.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedAirports.includes(a.code)}
                    onChange={e => {
                      setSelectedAirports(prev =>
                        e.target.checked ? [...prev, a.code] : prev.filter(x => x !== a.code)
                      )
                    }}
                  />
                  {a.name} ({a.code})
                </label>
              ))}
            </div>
            <button onClick={fetchData} className="mt-4 w-full rounded-2xl px-4 py-2 bg-black text-white">Refresh Results</button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Results (sorted by price, then time)</h3>
            {loading ? <span className="text-sm text-gray-500">Loading…</span> : null}
          </div>

          {error ? (
            <div className="p-4 text-red-600">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-3">Price (CAD)</th>
                    <th className="p-3">Route</th>
                    <th className="p-3">Stops</th>
                    <th className="p-3">Total Time</th>
                    <th className="p-3">Airlines</th>
                    <th className="p-3">Depart</th>
                    <th className="p-3">Return</th>
                    <th className="p-3">Book</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={i} className={i % 2 ? "bg-white" : "bg-gray-50"}>
                      <td className="p-3 font-semibold">${r.price}</td>
                      <td className="p-3">{r.flyFrom} → {r.flyTo}</td>
                      <td className="p-3">{r.stops}</td>
                      <td className="p-3">{secondsToHMM(r.durationTotal)}</td>
                      <td className="p-3">{r.airlines}</td>
                      <td className="p-3">{r.local_departure ? new Date(r.local_departure).toLocaleString() : "—"}</td>
                      <td className="p-3">{r.return_departure ? new Date(r.return_departure).toLocaleString() : "—"}</td>
                      <td className="p-3">
                        {r.deepLink ? (
                          <a className="underline text-blue-600" href={r.deepLink} target="_blank" rel="noreferrer">Open</a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="text-xs text-gray-500 mt-4">
          Data by Amadeus Self-Service API. Driving/train to Albertville: LYS≈1.5h, GVA≈1.3h, CMF≈0.75h, GNB≈1h, TRN≈2h, MXP≈3.5h, Paris≈3.5–4h by TGV.
        </footer>
      </div>
    </div>
  )
}
