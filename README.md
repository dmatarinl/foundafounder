# Found a Founder

Found a Founder is a small Netlify app for finding and ranking startups by public momentum.

It is not trying to predict which company will win. It is a lightweight signal tracker: it looks for signs that people are building, launching, starring, visiting, discussing, or searching for a startup.

Live app: https://foundafounder.netlify.app

## What The App Does

The app has two main jobs:

1. Discover possible startups to track.
2. Score and rank those startups using public momentum signals.

You can start in two ways:

- If you already know the startups, add their names, domains, GitHub repos, and manual signal estimates.
- If you do not know the startups yet, use Discover. It searches public sources and suggests candidate startups.

After you have a list, click Calculate scores. The app ranks the startups and shows why each one scored the way it did.

## Discovery In Plain English

Discovery is the part that helps when you do not know what startup names to enter.

You give the app a broad topic, such as:

```text
AI agents, developer tools, fintech APIs
```

The app then searches two public sources:

- Hacker News, especially recent `Launch HN` and `Show HN` posts.
- GitHub repositories that match the topic and have at least some traction.

The goal is to find startup-like projects with enough public evidence to become a candidate.

## How Discovery Finds Candidates

For Hacker News, the app searches recent stories through the Hacker News Algolia API. It looks for titles that start with:

```text
Launch HN:
Show HN:
```

Those posts often describe new startups, products, or developer tools. The app tries to infer:

- The startup name from the post title.
- The website domain from the post URL.
- The GitHub repo if the post links directly to GitHub.
- Evidence, such as the HN post title and URL.

For GitHub, the app searches repositories through the GitHub API. It looks for repositories that:

- Match the topic in the name or description.
- Have more than 50 stars.
- Were updated recently enough to look active.
- Have a homepage URL, so the app can connect the repo to a startup or product website.

The app skips obvious non-startup hosts such as Hacker News itself, GitHub docs, YouTube, X/Twitter, LinkedIn, Medium, and other generic content sites.

## Discovery Score

Each discovered candidate gets a discovery score. This is only used to sort the discovery results before you add them to the startup list.

For Hacker News candidates, the score is based mostly on:

- HN points.
- HN comments.
- Whether the post looks like a real Launch HN or Show HN post.

For GitHub candidates, the score is based mostly on:

- Star count.
- Fork count.
- Recent repository activity.

If the same candidate appears from more than one source, the app merges the evidence and adds the discovery signals together.

Discovery score is not the final startup score. It only answers: "Which candidates look most worth adding to the tracker?"

## What Happens When You Add A Candidate

When you add a discovered candidate, the app creates a normal startup row with:

- Name.
- Website domain.
- GitHub repo, if found.
- Search terms.
- Evidence from discovery.
- Neutral default assumptions for manual fields.

The manual defaults are intentionally conservative. For example, a new candidate starts with no visible traffic estimate unless you change it.

## Final Startup Score

The final score is a number from 0 to 100.

Higher means stronger visible public momentum. Lower means weaker or less visible public momentum.

The app combines three main signal groups:

- GitHub score: developer traction and repo activity.
- Traffic score: estimated website demand.
- Mentions score: public discussion and search interest.

If a startup has a meaningful public GitHub repo, GitHub is included heavily:

```text
startup_score = 0.45 * github_score
              + 0.35 * traffic_score
              + 0.20 * mentions_score
```

If a startup does not have a meaningful public GitHub repo, the app does not punish it as if it were an open-source project. Instead, it leans more on traffic, mentions, and credibility:

```text
startup_score = 0.50 * traffic_score
              + 0.35 * mentions_score
              + 0.15 * credibility_score
```

## GitHub Score

GitHub score is used when the startup has a public GitHub repository that the app can read.

It is made from:

```text
github_score = 0.60 * recent_star_growth_score
             + 0.25 * total_stars_score
             + 0.15 * repo_activity_score
```

Recent star growth matters most because it shows current momentum, not just old popularity.

The app fetches:

- Total stars.
- Recent stars from roughly the last 150 days.
- Forks.
- Contributors.
- Releases.
- Whether the repo was pushed recently.
- Whether the repo is archived.

### Total Stars Score

Total stars are converted into a 0-100 score:

| Total stars | Score |
| --- | ---: |
| Under 50 | 0 |
| 50-499 | 20 |
| 500-1,999 | 40 |
| 2,000-9,999 | 60 |
| 10,000-49,999 | 80 |
| 50,000+ | 100 |

### Recent Stars Score

Recent stars are also converted into a 0-100 score:

| Recent stars | Score |
| --- | ---: |
| 0 | 0 |
| 1-49 | 20 |
| 50-249 | 40 |
| 250-999 | 60 |
| 1,000-4,999 | 80 |
| 5,000+ | 100 |

### Repo Activity Score

Repo activity is a simple health check:

- Archived repos score 0.
- Recently pushed repos get activity credit.
- Repos with releases get more credit.
- Repos with several contributors or many forks get more credit.
- Very active repos with many contributors, releases, and forks can score 100.

## Traffic Score

Traffic score estimates whether the startup has demand on its website.

It is made from:

```text
traffic_score = 0.50 * monthly_visits_score
              + 0.30 * traffic_growth_score
              + 0.20 * traffic_quality_score
```

The app does not automatically fetch Similarweb, Semrush, or analytics data. Those fields are manual in this MVP.

### Monthly Visits Score

Monthly visits are entered as a band:

| Monthly visits band | Score |
| --- | ---: |
| No visible estimate | 0 |
| Under 10k | 20 |
| 10k-50k | 40 |
| 50k-200k | 60 |
| 200k-1M | 80 |
| 1M+ | 100 |

Traffic growth and traffic quality are manual 0-100 values.

Use traffic growth for whether visits appear to be increasing.

Use traffic quality for whether the traffic seems relevant, not just random clicks.

## Mentions Score

Mentions score estimates whether people are talking about the startup.

It is made from:

```text
mentions_score = 0.50 * news_mentions_score
               + 0.30 * community_mentions_score
               + 0.20 * search_interest_score
```

The app can automatically fetch Hacker News hit counts for the startup search terms. It compares that with the manual community score and uses whichever is higher.

Community score from Hacker News hit count:

| HN hits | Community score |
| --- | ---: |
| 0 | 0 |
| 1-9 | 20 |
| 10-49 | 40 |
| 50-199 | 60 |
| 200-999 | 80 |
| 1,000+ | 100 |

The rest is manual:

- News mentions score: how much press or public news coverage exists.
- Community score: Reddit, Hacker News, Discord, forums, or other community discussion.
- Search interest score: Google Trends or similar demand signals.

## Confidence

Confidence explains how much supporting data the score had.

- High: GitHub was fetched, there is some traffic signal, and there are at least two mention/search/community signals.
- Medium: there is at least one strong source, such as GitHub or traffic, plus at least one mention signal.
- Low: there is not enough supporting evidence, or there is no meaningful public GitHub signal.

Confidence is not a quality score. It is a warning label about how much data the app had.

## Important Caveats

This tool is intentionally simple.

It does not know revenue, retention, margins, team quality, customer love, fundraising terms, or private analytics.

It can overrate:

- Open-source projects with lots of stars but weak business traction.
- Companies with strong public visibility but weak fundamentals.
- Trendy topics with lots of discussion but little buying intent.

It can underrate:

- Quiet B2B companies.
- Closed-source products.
- Startups with strong revenue but little public footprint.
- Products with private communities or private customer channels.

Use the ranking as a first-pass research filter, not as investment advice.

## Data And Persistence

Local sample data lives in:

```text
data/startups.json
```

In Netlify, the `startups` function tries to use Netlify Database/Postgres for saved startup lists. If the database is not available to the Function runtime, it falls back to local sample data or sample fallback mode.

The scoring function does not need the database. It can score whatever startup list the frontend sends it.

## Environment Variables

Optional:

```text
GITHUB_TOKEN
```

Set `GITHUB_TOKEN` locally or in Netlify to increase GitHub API limits. Without it, GitHub requests can hit anonymous rate limits more quickly.

Do not commit secrets to git.

## Run Locally

Install dependencies:

```sh
npm install
```

Run the Netlify local dev server:

```sh
npm run dev
```

Open:

```text
http://localhost:8888
```

Build the static app:

```sh
npm run build
```

Run the scoring test:

```sh
npm test
```

## CLI Scoring

You can score the sample startup list from the command line:

```sh
npm run score
```

This writes:

```text
ranked_startups.json
ranked_startups.csv
```

## Deploy

This project deploys on Netlify.

Build settings:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

Production deploys come from the `main` branch.

Database migrations live in:

```text
netlify/database/migrations
```
