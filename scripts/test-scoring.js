const assert = require("node:assert/strict");
const {
  scoreStartup,
  monthlyVisitsToScore,
  parseGithubRepoUrl
} = require("../netlify/functions/lib/scoring.cjs");

assert.equal(monthlyVisitsToScore("under 10k"), 20);
assert.equal(monthlyVisitsToScore("50k-200k"), 60);
assert.deepEqual(parseGithubRepoUrl("https://github.com/example/project"), {
  owner: "example",
  repo: "project"
});

const withGithub = scoreStartup({
  name: "Example",
  website_domain: "example.com",
  github_repo_url: "https://github.com/example/project",
  search_terms: ["Example"],
  manual: {
    monthly_visits_band: "50k-200k",
    traffic_growth_score: 75,
    traffic_quality_score: 50,
    news_mentions_score: 40,
    reddit_mentions_score: 20,
    google_trends_score: 50,
    credibility_score: 50
  },
  github: {
    total_stars: 2500,
    recent_stars: 300,
    forks: 80,
    contributors: 12,
    releases: 5,
    archived: false,
    pushed_recently: true
  },
  mentions: {
    hn_hits: 12
  }
});

assert.equal(withGithub.github_score, 62);
assert.equal(withGithub.traffic_score, 63);
assert.equal(withGithub.mentions_score, 42);
assert.equal(withGithub.startup_score, 58);
assert.equal(withGithub.confidence, "high");

const withoutGithub = scoreStartup({
  name: "ManualCo",
  website_domain: "manual.example",
  search_terms: ["ManualCo"],
  manual: {
    monthly_visits_band: "10k-50k",
    traffic_growth_score: 50,
    traffic_quality_score: 50,
    news_mentions_score: 20,
    reddit_mentions_score: 20,
    google_trends_score: 25,
    credibility_score: 70
  }
});

assert.equal(withoutGithub.github_score, 0);
assert.equal(withoutGithub.startup_score, 40);
assert.equal(withoutGithub.confidence, "low");

console.log("Scoring tests passed");
