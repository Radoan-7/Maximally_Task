const fetch = require("node-fetch");
const cheerio = require("cheerio");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

// cache object to reduce API calls
let cache = { ts: 0, data: null };
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// --- Fetch hackathons from Unstop ---
async function fetchUnstop() {
  const MAX_SITEMAPS = 12;
  const base = "https://unstop.com/sitemaps/opportunity/sitemap";
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
  };

  const sitemapUrls = Array.from(
    { length: MAX_SITEMAPS },
    (_, i) => `${base}${i + 1}.xml`
  );
  const items = [];

  for (const url of sitemapUrls) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("url").each((_, el) => {
        const loc = $(el).find("loc").text().trim();
        if (!loc || !/\/hackathons\//i.test(loc)) return;

        const lastmod = $(el).find("lastmod").text().trim();
        const title = slugToTitle(
          (loc.split("/hackathons/")[1] || "").split("/")[0]
        );

        items.push({
          source: "unstop",
          title: title || "Untitled",
          link: loc,
          description: "",
          tags: [lastmod].filter(Boolean),
          prizeText: "", // sitemap doesn’t provide prize
        });
      });
    } catch (e) {
      console.error("Unstop fetch error:", e);
    }
  }

  // deduplicate by link
  const map = new Map();
  for (const it of items) if (!map.has(it.link)) map.set(it.link, it);
  const out = Array.from(map.values());

  // sort by last modified
  out.sort((a, b) => new Date(b.tags[0] || 0) - new Date(a.tags[0] || 0));
  return out;
}

function slugToTitle(slug) {
  if (!slug) return "";
  const cleaned = slug.replace(/-\d+$/, "");
  return cleaned
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ");
}

// --- Fetch hackathons from GitHub ---
async function fetchGithubHackathons() {
  const q = encodeURIComponent(
    "hackathon in:name,description pushed:>=" + getDateNDaysAgo(365)
  );

  const url = `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=30`;
  const headers = { "User-Agent": "hackathon-aggregator" };

  if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return [];

  const json = await res.json();
  const items = json.items || [];

  return items.map((it) => ({
    source: "github",
    title: it.full_name,
    link: it.html_url,
    description: it.description || "",
    tags: it.topics || [],
    prizeText: "", // repos don’t have prizes
  }));
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// --- Prize parser ---
function parsePrize(prizeText) {
  if (!prizeText) return 0;

  let txt = prizeText.toUpperCase().replace(/[,₹£€$]/g, "").trim();

  // Handle "10K", "5K", "2L" (lakhs), etc.
  if (/(\d+)\s*K/.test(txt)) {
    return parseInt(RegExp.$1, 10) * 1000;
  }
  if (/(\d+)\s*L/.test(txt)) {
    return parseInt(RegExp.$1, 10) * 100000;
  }

  const match = txt.match(/(\d{2,})/);
  return match ? Number(match[1]) : 0;
}

// --- Main API handler ---
module.exports = async (req, res) => {
  try {
    const { source = "all", filter = "", minPrize = 0 } = req.query;

    const now = Date.now();
    if (!cache.data || now - cache.ts > CACHE_TTL) {
      const [unstop, github] = await Promise.allSettled([
        fetchUnstop(),
        fetchGithubHackathons(),
      ]);

      cache = {
        ts: Date.now(),
        data: {
          unstop: unstop.status === "fulfilled" ? unstop.value : [],
          github: github.status === "fulfilled" ? github.value : [],
        },
      };
    }

    let combined = [];
    if (source === "unstop" || source === "all")
      combined = combined.concat(cache.data.unstop);
    if (source === "github" || source === "all")
      combined = combined.concat(cache.data.github);

    // --- Keyword filter ---
    const f = filter.toLowerCase();
    if (f) {
      combined = combined.filter((item) => {
        const text = (
          item.title +
          " " +
          item.description +
          " " +
          (item.tags || []).join(" ")
        ).toLowerCase();

        if (f === "ai")
          return text.includes("ai") || text.includes("machine learning");
        if (f === "student") return text.includes("student");
        return text.includes(f);
      });
    }

    // --- Prize filter ---
    const minP = Number(minPrize || 0);
    if (minP > 0) {
      combined = combined.filter((item) => parsePrize(item.prizeText) >= minP);
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ ok: true, count: combined.length, data: combined });
  } catch (err) {
    console.error("Hackathon API error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
};
