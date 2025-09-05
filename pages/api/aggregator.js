const fetch = require("node-fetch");
const cheerio = require("cheerio");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

// cache object to reduce API calls
let cache = { ts: 0, data: null };
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// --- Fetch hackathons from Devpost ---
async function fetchDevpost() {
  const url = "https://devpost.com/hackathons";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const cards = [];

  $(".hackathon-tile, .project-card").each((i, el) => {
    const title =
      $(el).find("h3, .title, .block-title").first().text().trim() ||
      $(el).find("a").first().text().trim();

    const link = $(el).find("a").first().attr("href");
    const href = link?.startsWith("http")
      ? link
      : `https://devpost.com${link || ""}`;

    const desc = $(el).find(".blurb, .description, p").first().text().trim();

    const tags = [];
    $(el)
      .find(".tags a, .tag")
      .each((_, t) => tags.push($(t).text().trim()));

    const prizeText =
      $(el).find(".prize, .prizes, .category-list").text().trim() || "";

    cards.push({
      source: "devpost",
      title: title || "Untitled",
      link: href,
      description: desc || "",
      tags,
      prizeText,
    });
  });

  return cards;
}

// --- Fetch hackathons from GitHub repos ---
async function fetchGithubHackathons() {
  const q = encodeURIComponent(
    "hackathon in:name,description pushed:>=" + getDateNDaysAgo(365)
  );

  const url = `https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=30`;
  const headers = { "User-Agent": "hackathon-aggregator" };

  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }

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
    prizeText: "",
  }));
}

// --- Helper: Get date N days ago (for GitHub search) ---
function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// --- Main API handler ---
module.exports = async (req, res) => {
  try {
    const { source = "all", filter = "", minPrize = 0 } = req.query;

    const now = Date.now();
    if (!cache.data || now - cache.ts > CACHE_TTL) {
      const [devpost, github] = await Promise.allSettled([
        fetchDevpost(),
        fetchGithubHackathons(),
      ]);

      cache = {
        ts: Date.now(),
        data: {
          dev: devpost.status === "fulfilled" ? devpost.value : [],
          gh: github.status === "fulfilled" ? github.value : [],
        },
      };
    }

    let combined = [];
    if (source === "devpost" || source === "all") {
      combined = combined.concat(cache.data.dev);
    }
    if (source === "github" || source === "all") {
      combined = combined.concat(cache.data.gh);
    }

    // --- Filtering logic ---
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

        if (f === "ai") return text.includes("ai") || text.includes("machine learning");
        if (f === "student") return text.includes("student");
        return text.includes(f);
      });
    }

    // --- Prize filter ---
    const minP = Number(minPrize || 0);
    if (minP > 0) {
      combined = combined.filter((item) => {
        const clean = (item.prizeText || "").replace(/[,$₹£€]/g, "");
        const match = clean.match(/(\d{2,})/);
        return match ? Number(match[1]) >= minP : false;
      });
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ ok: true, count: combined.length, data: combined });
  } catch (err) {
    console.error("Hackathon API error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
};
