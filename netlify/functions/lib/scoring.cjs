const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CUTOFF_DAYS = 150;

const MONTHLY_VISIT_SCORES = new Map([
  ["none", 0],
  ["no visible estimate", 0],
  ["under 10k", 20],
  ["<10k", 20],
  ["10k-50k", 40],
  ["50k-200k", 60],
  ["200k-1m", 80],
  ["200k-1M", 80],
  ["1m+", 100],
  ["1M+", 100]
]);

async function rankStartups(startups, options = {}) {
  const enriched = options.enrich === false
    ? startups
    : await Promise.all(startups.map((startup) => enrichStartup(startup, options)));

  return enriched
    .map(scoreStartup)
    .sort((a, b) => b.startup_score - a.startup_score)
    .map((startup, index) => ({ rank: index + 1, ...startup }));
}

function scoreStartup(startup) {
  const manual = startup.manual || {};
  const github = startup.github || {};
  const mentions = startup.mentions || {};
  const hasGithub = Boolean(
    startup.github_repo_url &&
    github.fetched !== false &&
    (github.fetched === true || github.total_stars != null || github.recent_stars != null)
  );

  const monthlyVisitsScore = monthlyVisitsToScore(manual.monthly_visits_band);
  const trafficGrowthScore = normalizeScore(manual.traffic_growth_score, 25);
  const trafficQualityScore = normalizeScore(manual.traffic_quality_score, 25);
  const trafficScore = Math.round(
    0.5 * monthlyVisitsScore +
    0.3 * trafficGrowthScore +
    0.2 * trafficQualityScore
  );

  const newsMentionsScore = normalizeScore(manual.news_mentions_score, 0);
  const hnMentionsScore = hnHitsToCommunityScore(mentions.hn_hits);
  const manualCommunityScore = normalizeScore(manual.reddit_mentions_score, 0);
  const communityMentionsScore = Math.max(hnMentionsScore, manualCommunityScore);
  const searchInterestScore = normalizeScore(manual.google_trends_score, 0);
  const mentionsScore = Math.round(
    0.5 * newsMentionsScore +
    0.3 * communityMentionsScore +
    0.2 * searchInterestScore
  );

  const totalStarsScore = totalStarsToScore(github.total_stars);
  const starGrowthScore = starGrowthToScore(github.recent_stars);
  const repoActivityScore = repoActivityToScore(github);
  const githubScore = hasGithub
    ? Math.round(0.6 * starGrowthScore + 0.25 * totalStarsScore + 0.15 * repoActivityScore)
    : 0;

  const credibilityScore = normalizeScore(manual.credibility_score, 50);
  const finalScore = hasGithub
    ? Math.round(0.45 * githubScore + 0.35 * trafficScore + 0.2 * mentionsScore)
    : Math.round(0.5 * trafficScore + 0.35 * mentionsScore + 0.15 * credibilityScore);

  const confidence = confidenceFor({ startup, hasGithub, github, trafficScore, mentions });

  return {
    name: startup.name,
    website_domain: startup.website_domain,
    github_repo_url: startup.github_repo_url || "",
    search_terms: startup.search_terms || [],
    github_score: clamp(githubScore),
    traffic_score: clamp(trafficScore),
    mentions_score: clamp(mentionsScore),
    startup_score: clamp(finalScore),
    confidence,
    reason: reasonFor({
      hasGithub,
      githubScore,
      trafficScore,
      mentionsScore,
      confidence,
      github
    }),
    inputs: startup,
    breakdown: {
      github: {
        star_growth_score: starGrowthScore,
        total_stars_score: totalStarsScore,
        repo_activity_score: repoActivityScore,
        total_stars: github.total_stars ?? null,
        recent_stars: github.recent_stars ?? null,
        forks: github.forks ?? null,
        contributors: github.contributors ?? null,
        releases: github.releases ?? null
      },
      traffic: {
        monthly_visits_score: monthlyVisitsScore,
        traffic_growth_score: trafficGrowthScore,
        traffic_quality_score: trafficQualityScore
      },
      mentions: {
        news_mentions_score: newsMentionsScore,
        community_mentions_score: communityMentionsScore,
        search_interest_score: searchInterestScore,
        hn_hits: mentions.hn_hits ?? null
      },
      formula: hasGithub
        ? "0.45 * github_score + 0.35 * traffic_score + 0.20 * mentions_score"
        : "0.50 * traffic_score + 0.35 * mentions_score + 0.15 * credibility_score"
    }
  };
}

async function enrichStartup(startup, options = {}) {
  const [github, mentions] = await Promise.all([
    fetchGithubSignals(startup.github_repo_url, options),
    fetchMentionSignals(startup.search_terms || [startup.name], options)
  ]);

  return {
    ...startup,
    github: {
      ...(startup.github || {}),
      ...github
    },
    mentions: {
      ...(startup.mentions || {}),
      ...mentions
    }
  };
}

async function fetchGithubSignals(repoUrl, options = {}) {
  const repo = parseGithubRepoUrl(repoUrl);
  if (!repo) {
    return { fetched: false };
  }

  try {
    const metadata = await githubFetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, options);
    const [recentStars, contributors, releases] = await Promise.all([
      countRecentStargazers(repo, metadata.stargazers_count, options),
      countGithubList(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contributors?per_page=100`, options),
      countGithubList(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=100`, options)
    ]);

    return {
      fetched: true,
      owner: repo.owner,
      repo: repo.repo,
      total_stars: metadata.stargazers_count || 0,
      recent_stars: recentStars,
      forks: metadata.forks_count || 0,
      contributors,
      releases,
      archived: Boolean(metadata.archived),
      pushed_recently: isRecentDate(metadata.pushed_at, 120),
      pushed_at: metadata.pushed_at || null
    };
  } catch (error) {
    return {
      fetched: false,
      owner: repo.owner,
      repo: repo.repo,
      error: error.message
    };
  }
}

async function fetchMentionSignals(searchTerms, options = {}) {
  const query = Array.isArray(searchTerms) && searchTerms.length > 0
    ? searchTerms[0]
    : "";
  if (!query) {
    return {};
  }

  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story,comment`;
    const response = await fetchWithTimeout(url, options.timeoutMs || 9000);
    if (!response.ok) {
      throw new Error(`HN API returned ${response.status}`);
    }
    const payload = await response.json();
    return {
      hn_hits: Number(payload.nbHits || 0),
      hn_query: query
    };
  } catch (error) {
    return {
      hn_error: error.message
    };
  }
}

async function githubFetch(url, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "foundafounder-startup-signal-tracker"
  };
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(url, options.timeoutMs || 9000, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${url}`);
  }
  return response.json();
}

async function countGithubList(url, options = {}) {
  try {
    const items = await githubFetch(url, options);
    return Array.isArray(items) ? items.length : 0;
  } catch (_error) {
    return null;
  }
}

async function countRecentStargazers(repo, totalStars, options = {}) {
  if (!totalStars) {
    return 0;
  }

  const cutoff = new Date(Date.now() - (options.cutoffDays || DEFAULT_CUTOFF_DAYS) * DAY_MS);
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github.v3.star+json",
    "User-Agent": "foundafounder-startup-signal-tracker"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const firstUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/stargazers?per_page=100`;
    const first = await fetchWithTimeout(firstUrl, options.timeoutMs || 9000, { headers });
    if (!first.ok) {
      throw new Error(`GitHub stargazers returned ${first.status}`);
    }
    const lastPage = parseLastPage(first.headers.get("link")) || Math.ceil(totalStars / 100);
    const maxPages = Math.min(lastPage, options.maxStarPages || 30);
    const firstStargazers = await first.json();
    if (!Array.isArray(firstStargazers) || firstStargazers.length === 0) {
      return 0;
    }

    let lastStargazers = firstStargazers;
    if (lastPage > 1) {
      const lastUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/stargazers?per_page=100&page=${lastPage}`;
      const response = await fetchWithTimeout(lastUrl, options.timeoutMs || 9000, { headers });
      if (!response.ok) {
        throw new Error(`GitHub stargazers returned ${response.status}`);
      }
      lastStargazers = await response.json();
      if (!Array.isArray(lastStargazers) || lastStargazers.length === 0) {
        return null;
      }
    }

    const firstLatest = latestStarDate(firstStargazers);
    const lastLatest = latestStarDate(lastStargazers);
    if (!firstLatest && !lastLatest) {
      return null;
    }

    const newestFirst = firstLatest && (!lastLatest || firstLatest >= lastLatest);
    const cachedPages = new Map([
      [1, firstStargazers],
      [lastPage, lastStargazers]
    ]);
    let recentStars = 0;
    let sawStarTimestamp = false;

    for (let offset = 0; offset < maxPages; offset += 1) {
      const page = newestFirst ? 1 + offset : lastPage - offset;
      if (page < 1 || page > lastPage) break;

      const stargazers = cachedPages.get(page) || await fetchStargazerPage(repo, page, headers, options);
      const pageScore = countRecentStarsInPage(stargazers, cutoff);
      if (!pageScore.sawStarTimestamp) return null;

      sawStarTimestamp = true;
      recentStars += pageScore.recentStars;
      if (pageScore.hasOlderStar) {
        break;
      }
    }

    return sawStarTimestamp ? recentStars : null;
  } catch (_error) {
    return null;
  }
}

async function fetchStargazerPage(repo, page, headers, options = {}) {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/stargazers?per_page=100&page=${page}`;
  const response = await fetchWithTimeout(url, options.timeoutMs || 9000, { headers });
  if (!response.ok) {
    throw new Error(`GitHub stargazers returned ${response.status}`);
  }
  const stargazers = await response.json();
  if (!Array.isArray(stargazers)) {
    throw new Error("GitHub stargazers returned an unexpected response");
  }
  return stargazers;
}

function latestStarDate(stargazers) {
  let latest = null;
  for (const item of stargazers) {
    if (!item.starred_at) continue;
    const date = new Date(item.starred_at);
    if (!latest || date > latest) {
      latest = date;
    }
  }
  return latest;
}

function countRecentStarsInPage(stargazers, cutoff) {
  let recentStars = 0;
  let hasOlderStar = false;
  let sawStarTimestamp = false;

  for (const item of stargazers) {
    if (!item.starred_at) continue;
    sawStarTimestamp = true;
    const starredAt = new Date(item.starred_at);
    if (starredAt >= cutoff) {
      recentStars += 1;
    } else {
      hasOlderStar = true;
    }
  }

  return { recentStars, hasOlderStar, sawStarTimestamp };
}

function monthlyVisitsToScore(value) {
  if (!value) {
    return 0;
  }
  const normalized = String(value).trim();
  return MONTHLY_VISIT_SCORES.get(normalized) ?? MONTHLY_VISIT_SCORES.get(normalized.toLowerCase()) ?? 0;
}

function totalStarsToScore(stars) {
  const count = Number(stars || 0);
  if (count < 50) return 0;
  if (count < 500) return 20;
  if (count < 2000) return 40;
  if (count < 10000) return 60;
  if (count < 50000) return 80;
  return 100;
}

function starGrowthToScore(stars) {
  if (stars == null) return 0;
  const count = Number(stars || 0);
  if (count <= 0) return 0;
  if (count < 50) return 20;
  if (count < 250) return 40;
  if (count < 1000) return 60;
  if (count < 5000) return 80;
  return 100;
}

function repoActivityToScore(github) {
  if (!github || github.fetched === false || github.archived) {
    return 0;
  }

  let score = github.pushed_recently ? 25 : 0;
  if ((github.releases || 0) > 0 || github.pushed_recently) {
    score = Math.max(score, 50);
  }
  if ((github.contributors || 0) >= 5 || (github.forks || 0) >= 50) {
    score = Math.max(score, 75);
  }
  if ((github.contributors || 0) >= 25 && (github.releases || 0) >= 10 && (github.forks || 0) >= 500) {
    score = 100;
  }
  return score;
}

function hnHitsToCommunityScore(hits) {
  if (hits == null) {
    return 0;
  }
  const count = Number(hits || 0);
  if (count === 0) return 0;
  if (count < 10) return 20;
  if (count < 50) return 40;
  if (count < 200) return 60;
  if (count < 1000) return 80;
  return 100;
}

function normalizeScore(value, fallback) {
  if (value == null || value === "") {
    return clamp(fallback);
  }
  return clamp(Math.round(Number(value)));
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function confidenceFor({ startup, hasGithub, github, trafficScore, mentions }) {
  const manual = startup.manual || {};
  const hasTraffic = trafficScore > 0;
  const mentionSources = [
    manual.news_mentions_score,
    manual.reddit_mentions_score,
    manual.google_trends_score,
    mentions.hn_hits
  ].filter((value) => value != null && value !== "").length;

  if (!hasGithub) {
    return "low";
  }
  if (hasGithub && github.fetched !== false && hasTraffic && mentionSources >= 2) {
    return "high";
  }
  if ((hasGithub || hasTraffic) && mentionSources >= 1) {
    return "medium";
  }
  return "low";
}

function reasonFor({ hasGithub, githubScore, trafficScore, mentionsScore, confidence, github }) {
  const strongest = [
    ["GitHub", githubScore],
    ["traffic", trafficScore],
    ["mentions", mentionsScore]
  ].sort((a, b) => b[1] - a[1])[0];

  const weakest = [
    ["GitHub", githubScore],
    ["traffic", trafficScore],
    ["mentions", mentionsScore]
  ].sort((a, b) => a[1] - b[1])[0];

  if (!hasGithub) {
    return `No meaningful public GitHub signal, so the score leans on traffic, mentions, and credibility. Strongest signal is ${strongest[0].toLowerCase()}; confidence is ${confidence}.`;
  }

  const githubNote = github.recent_stars == null
    ? github.total_stars
      ? `GitHub has about ${formatCount(github.total_stars)} total stars, but recent growth could not be fully fetched`
      : "GitHub growth could not be fully fetched"
    : github.total_stars
      ? `GitHub has about ${formatCount(github.total_stars)} total stars and added about ${github.recent_stars} in the recent window`
      : `GitHub added about ${github.recent_stars} stars in the recent window`;

  const dragNote = weakest[0] === "GitHub"
    ? "GitHub score trails because recent star growth carries the most weight"
    : `${weakest[0].toLowerCase()} is the main drag`;

  return `${githubNote}. Strongest signal is ${strongest[0].toLowerCase()}, while ${dragNote}; confidence is ${confidence}.`;
}

function formatCount(value) {
  const count = Number(value || 0);
  if (count >= 1000000) {
    return `${trimFixed(count / 1000000, count >= 10000000 ? 0 : 1)}M`;
  }
  if (count >= 1000) {
    return `${trimFixed(count / 1000, count >= 10000 ? 0 : 1)}k`;
  }
  return String(Math.round(count));
}

function trimFixed(value, digits) {
  return value.toFixed(digits).replace(/\.0$/, "");
}

function parseGithubRepoUrl(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/github\.com[:/]+([^/\s]+)\/([^/#?\s]+)(?:[/?#].*)?$/i);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, "")
  };
}

function parseLastPage(linkHeader) {
  if (!linkHeader) {
    return null;
  }
  const match = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

function isRecentDate(value, days) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return Date.now() - date.getTime() <= days * DAY_MS;
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  rankStartups,
  scoreStartup,
  enrichStartup,
  fetchGithubSignals,
  fetchMentionSignals,
  monthlyVisitsToScore,
  totalStarsToScore,
  starGrowthToScore,
  repoActivityToScore,
  hnHitsToCommunityScore,
  countRecentStargazers,
  parseGithubRepoUrl
};
