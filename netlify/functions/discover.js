const DEFAULT_QUERIES = [
  "Launch HN",
  "Launch HN AI",
  "Launch HN developer tools",
  "Launch HN fintech",
  "Launch HN climate"
];

const SKIP_HOSTS = new Set([
  "news.ycombinator.com",
  "hn.algolia.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "medium.com",
  "github.com",
  "docs.github.com",
  "developer.chrome.com",
  "developers.google.com",
  "npmjs.org",
  "chromium.googlesource.com",
  "docs.flutter.dev"
]);

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, "");
    }

    const payload = event.httpMethod === "POST"
      ? JSON.parse(event.body || "{}")
      : Object.fromEntries(new URLSearchParams(event.rawQuery || ""));
    const queries = normalizeQueries(payload.queries || payload.query);
    const limit = clamp(Number(payload.limit || 20), 5, 50);
    const days = clamp(Number(payload.days || 180), 30, 365);

    const candidates = await discoverCandidates({ queries, limit, days });
    return response(200, {
      queries,
      candidates: candidates.slice(0, limit)
    });
  } catch (error) {
    return response(500, {
      error: error.message || "Unexpected discovery error"
    });
  }
};

async function discoverCandidates({ queries, limit, days }) {
  const [hnCandidates, githubCandidates] = await Promise.all([
    discoverFromHackerNews(queries, limit, days),
    discoverFromGithub(queries, limit)
  ]);
  return mergeCandidates([...hnCandidates, ...githubCandidates])
    .sort((a, b) => b.discovery_score - a.discovery_score);
}

async function discoverFromHackerNews(queries, limit, days) {
  const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const searches = buildHnQueries(queries).map(async (query) => {
    const url = new URL("https://hn.algolia.com/api/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", String(Math.min(limit, 50)));
    url.searchParams.set("numericFilters", `created_at_i>${since}`);

    try {
      const result = await fetchJson(url);
      return (result.hits || []).map((hit) => candidateFromHnHit(hit, query)).filter(Boolean);
    } catch (_error) {
      return [];
    }
  });

  return (await Promise.all(searches)).flat();
}

async function discoverFromGithub(queries, limit) {
  const searches = queries.slice(0, 4).map(async (query) => {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", `${query} in:name,description stars:>50`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("order", "desc");
    url.searchParams.set("per_page", String(Math.min(limit, 20)));

    try {
      const result = await fetchJson(url, githubHeaders());
      return (result.items || []).map((repo) => candidateFromGithubRepo(repo, query)).filter(Boolean);
    } catch (_error) {
      return [];
    }
  });

  return (await Promise.all(searches)).flat();
}

function candidateFromHnHit(hit, query) {
  const title = hit.title || hit.story_title || "";
  const url = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
  if (!/^(Launch HN|Show HN):/i.test(title)) {
    return null;
  }

  const name = inferName(title, url);
  const domain = inferDomain(url);
  const githubRepo = inferGithubRepo(url);

  if (!name || wordCount(name) > 5 || (!domain && !githubRepo)) {
    return null;
  }

  return makeStartupCandidate({
    name,
    website_domain: domain || "",
    github_repo_url: githubRepo || "",
    source: "Hacker News",
    source_query: query,
    evidence_url: url,
    evidence_title: title,
    discovery_score: 40 + Math.min(30, Number(hit.points || 0) / 5) + Math.min(30, Number(hit.num_comments || 0) / 3),
    hn_hits: Math.max(1, Number(hit.num_comments || 0), Math.round(Number(hit.points || 0) / 5))
  });
}

function candidateFromGithubRepo(repo, query) {
  const domain = repo.homepage ? inferDomain(repo.homepage) : "";
  const name = humanizeRepoName(repo.name || repo.full_name || "");
  if (!domain || !name || isLikelyLibraryOnly(name, repo.description || "")) {
    return null;
  }

  return makeStartupCandidate({
    name,
    website_domain: domain,
    github_repo_url: repo.html_url || "",
    source: "GitHub",
    source_query: query,
    evidence_url: repo.html_url || "",
    evidence_title: repo.description || repo.full_name,
    discovery_score: 35 + Math.min(45, Math.log10((repo.stargazers_count || 0) + 1) * 12) + Math.min(20, (repo.forks_count || 0) / 25),
    github: {
      fetched: true,
      total_stars: repo.stargazers_count || 0,
      recent_stars: null,
      forks: repo.forks_count || 0,
      contributors: null,
      releases: null,
      archived: Boolean(repo.archived),
      pushed_recently: isRecent(repo.pushed_at, 120),
      pushed_at: repo.pushed_at || null
    }
  });
}

function makeStartupCandidate(input) {
  const terms = [input.name, input.website_domain, input.source_query].filter(Boolean);
  const discoveryScore = Math.round(input.discovery_score || 0);
  const communityScore = clamp(Math.round(discoveryScore * 0.8), 0, 80);
  const credibilityScore = /\bYC\s+[A-Z]?\d{2}\b/i.test(`${input.name} ${input.evidence_title}`)
    ? 65
    : 50;
  return {
    name: input.name,
    website_domain: input.website_domain || "",
    github_repo_url: input.github_repo_url || "",
    search_terms: [...new Set(terms)],
    manual: {
      monthly_visits_band: "no visible estimate",
      traffic_growth_score: 25,
      traffic_quality_score: 25,
      news_mentions_score: input.source === "Hacker News" ? 20 : 0,
      reddit_mentions_score: communityScore,
      google_trends_score: 25,
      credibility_score: credibilityScore
    },
    mentions: {
      hn_hits: input.hn_hits || null
    },
    github: input.github || undefined,
    discovery: {
      score: discoveryScore,
      sources: [input.source],
      queries: [input.source_query].filter(Boolean),
      evidence: [
        {
          source: input.source,
          title: input.evidence_title || input.name,
          url: input.evidence_url || ""
        }
      ]
    }
  };
}

function mergeCandidates(candidates) {
  const merged = new Map();
  for (const candidate of candidates) {
    const key = candidate.website_domain || candidate.github_repo_url || candidate.name.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...candidate,
        discovery_score: candidate.discovery.score
      });
      continue;
    }

    existing.github_repo_url ||= candidate.github_repo_url;
    existing.website_domain ||= candidate.website_domain;
    existing.search_terms = [...new Set([...existing.search_terms, ...candidate.search_terms])];
    existing.discovery.sources = [...new Set([...existing.discovery.sources, ...candidate.discovery.sources])];
    existing.discovery.queries = [...new Set([...existing.discovery.queries, ...candidate.discovery.queries])];
    existing.discovery.evidence.push(...candidate.discovery.evidence);
    existing.discovery.score += candidate.discovery.score;
    existing.discovery_score = existing.discovery.score;
    if (!existing.github && candidate.github) {
      existing.github = candidate.github;
    }
    if (!existing.mentions?.hn_hits && candidate.mentions?.hn_hits) {
      existing.mentions = candidate.mentions;
    }
  }
  return [...merged.values()].map((candidate) => ({
    ...candidate,
    discovery_score: Math.round(candidate.discovery_score)
  }));
}

function inferName(title, url) {
  const cleanedTitle = cleanTitle(title);
  const launchMatch = cleanedTitle.match(/^(?:Launch HN|Show HN):\s*([^:–—-]+)(?:[:–—-]|\(|$)/i);
  if (launchMatch) {
    return titleCase(launchMatch[1].trim());
  }

  const domain = inferDomain(url);
  if (domain) {
    return titleCase(domain.split(".")[0].replaceAll("-", " "));
  }

  return titleCase(cleanedTitle.split(/[:–—-]/)[0].trim()).slice(0, 60);
}

function inferDomain(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    if (SKIP_HOSTS.has(host) || host.endsWith(".github.io")) {
      return "";
    }
    return host;
  } catch (_error) {
    return "";
  }
}

function inferGithubRepo(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "github.com") {
      return "";
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return "";
    }
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
  } catch (_error) {
    return "";
  }
}

function normalizeQueries(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8);
  }
  return DEFAULT_QUERIES;
}

function buildHnQueries(queries) {
  const expanded = [];
  for (const query of queries) {
    if (/^(Launch HN|Show HN)/i.test(query)) {
      expanded.push(query);
    } else {
      expanded.push(`Launch HN ${query}`);
    }
  }
  return [...new Set(expanded)].slice(0, 12);
}

function wordCount(value) {
  return String(value || "").split(/\s+/).filter(Boolean).length;
}

function humanizeRepoName(value) {
  return titleCase(String(value).replace(/[-_]/g, " ").replace(/\b(ai|api|sdk|cli)\b/gi, (match) => match.toUpperCase()));
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.length <= 3 && part === part.toUpperCase()
      ? part
      : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isLikelyLibraryOnly(name, description) {
  const text = `${name} ${description}`.toLowerCase();
  return /\b(awesome|list|template|example|boilerplate|tutorial)\b/.test(text);
}

function isRecent(value, days) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= days * 24 * 60 * 60 * 1000;
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "foundafounder-startup-discovery"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }
  return response.json();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Content-Type": "application/json"
    },
    body: body === "" ? "" : JSON.stringify(body)
  };
}
