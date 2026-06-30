# Startup Signal Tracker

Startup Signal Tracker ranks startups by public momentum signals: GitHub traction, estimated website traffic, and internet mentions.

## Run Locally

```sh
npm run build
netlify dev
```

The app runs at `http://localhost:8888` through Netlify Dev.

## Data

The editable startup list uses `data/startups.json` locally. On Netlify, the `startups` function uses Netlify Database/Postgres for persistence and falls back to the sample data only when no database connection is available.

Set `GITHUB_TOKEN` in Netlify or your local shell to increase GitHub API limits. Do not commit `.env`.

## Discovery

Use the discovery panel when you do not already know which startups to track. It searches recent Hacker News Launch/Show posts and GitHub repositories for broad themes, then creates candidate startup rows with inferred names, domains, repositories, evidence links, and neutral manual assumptions.

## Scoring

Final score with a meaningful public GitHub repo:

```text
startup_score = 0.45 * github_score + 0.35 * traffic_score + 0.20 * mentions_score
```

Final score without a meaningful public GitHub repo:

```text
startup_score = 0.50 * traffic_score + 0.35 * mentions_score + 0.15 * credibility_score
```

Website traffic remains manual in this MVP. GitHub data comes from the GitHub REST API, and community buzz uses the Hacker News Algolia API.

## CLI

```sh
npm run score
```

This writes `ranked_startups.json` and `ranked_startups.csv`.

## Deploy

This project deploys on Netlify.

- Build command: `npm run build`
- Publish directory: `dist`
- Local Netlify dev: `netlify dev`
- Functions directory: `netlify/functions`
- Database migrations: `netlify/database/migrations`
- Production deploys come from the main branch.

Add environment variables in Netlify, not in git.

## Caveats

- This score does not predict success; it ranks public momentum signals.
- GitHub signals are strongest for open-source or developer-focused startups.
- Similarweb, Semrush, Google Trends, Reddit, and news checks are intentionally manual in this fast MVP.
