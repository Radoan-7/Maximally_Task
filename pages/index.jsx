import React, { useEffect, useState } from "react";

export default function Home() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("all");
  const [filter, setFilter] = useState("");
  const [minPrize, setMinPrize] = useState("");

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (source) qs.set("source", source);
    if (filter) qs.set("filter", filter);
    if (minPrize) qs.set("minPrize", Number(minPrize));

    try {
      const res = await fetch(`/api/aggregator?${qs.toString()}`);
      const json = await res.json();
      setItems(json.ok ? json.data : []);
    } catch (e) {
      console.error("Failed to fetch hackathons:", e);
      setItems([]);
    }
    setLoading(false);
  }

  // Initial load and reload when filters change
  useEffect(() => {
    load();
  }, [source, filter, minPrize]);

  return (
    <div style={{ fontFamily: "Inter, system-ui", padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <h1>Hackathon Aggregator</h1>
      <p style={{ color: "#666" }}>
        Finds ongoing hackathons from <b>Unstop</b> and GitHub. Use the filters below.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          <option value="unstop">Unstop only</option>
          <option value="github">GitHub only</option>
        </select>

        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">No filter</option>
          <option value="ai">AI-only</option>
          <option value="student">Student-only</option>
        </select>

        <input
          placeholder="Min prize ($)"
          type="number"
          value={minPrize}
          onChange={(e) => setMinPrize(e.target.value)}
        />

        <button onClick={load}>Refresh</button>
      </div>

      {/* Loading indicator */}
      {loading && <p>Loading hackathons…</p>}

      {/* Hackathon list */}
      <div>
        {!loading && items.length === 0 && <p>No hackathons found. Try Refresh.</p>}
        {items.map((it, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid #eee",
              padding: 12,
              marginBottom: 8,
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <a
                  href={it.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 16, fontWeight: 600 }}
                >
                  {it.title}
                </a>
                <div style={{ fontSize: 13, color: "#666" }}>
                  {it.source} • {it.tags && it.tags.join(", ")}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13 }}>{it.prizeText || ""}</div>
              </div>
            </div>
            <p style={{ marginTop: 8 }}>{it.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
