const fs = require("node:fs");
const path = require("node:path");
const { rankStartups } = require("../netlify/functions/lib/scoring.cjs");

async function main() {
  const inputPath = process.argv[2] || "data/startups.json";
  const absolutePath = path.resolve(process.cwd(), inputPath);
  const startups = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const ranked = await rankStartups(startups, { enrich: true });

  const jsonPath = path.resolve(process.cwd(), "ranked_startups.json");
  const csvPath = path.resolve(process.cwd(), "ranked_startups.csv");
  fs.writeFileSync(jsonPath, JSON.stringify(ranked, null, 2));
  fs.writeFileSync(csvPath, toCsv(ranked));

  console.table(
    ranked.slice(0, 3).map((startup) => ({
      rank: startup.rank,
      startup: startup.name,
      score: startup.startup_score,
      confidence: startup.confidence
    }))
  );
  console.log(`Wrote ${path.basename(jsonPath)} and ${path.basename(csvPath)}`);
}

function toCsv(rows) {
  const headers = [
    "Rank",
    "Startup",
    "Website domain",
    "GitHub repo",
    "GitHub score",
    "Traffic score",
    "Mentions score",
    "Final score",
    "Confidence",
    "Notes/reason"
  ];
  const body = rows.map((row) =>
    [
      row.rank,
      row.name,
      row.website_domain,
      row.github_repo_url || "",
      row.github_score,
      row.traffic_score,
      row.mentions_score,
      row.startup_score,
      row.confidence,
      row.reason
    ].map(csvCell).join(",")
  );
  return `${headers.join(",")}\n${body.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
