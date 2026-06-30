const startupRows = document.querySelector("#startup-rows");
const resultsRows = document.querySelector("#results-rows");
const rowTemplate = document.querySelector("#startup-row-template");
const statusEl = document.querySelector("#status");
const resultCount = document.querySelector("#result-count");
const persistenceMode = document.querySelector("#persistence-mode");
const breakdown = document.querySelector("#breakdown");
const discoveryRows = document.querySelector("#discovery-rows");
const discoveryCount = document.querySelector("#discovery-count");

let startups = [];
let ranked = [];
let discovered = [];
let selectedRank = null;

const manualFields = new Set([
  "monthly_visits_band",
  "traffic_growth_score",
  "traffic_quality_score",
  "news_mentions_score",
  "reddit_mentions_score",
  "google_trends_score",
  "credibility_score"
]);

document.querySelector("#add-row").addEventListener("click", () => {
  startups.push(blankStartup());
  renderStartupRows();
});

document.querySelector("#load-sample").addEventListener("click", loadStartups);
document.querySelector("#save-startups").addEventListener("click", saveStartups);
document.querySelector("#calculate").addEventListener("click", calculateScores);
document.querySelector("#export-csv").addEventListener("click", exportCsv);
document.querySelector("#discover").addEventListener("click", discoverStartups);
document.querySelector("#add-discovered").addEventListener("click", addSelectedDiscovered);

startupRows.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  const row = event.target.closest("tr");
  if (!field || !row) return;
  const index = Number(row.dataset.index);
  updateStartup(index, field, event.target.value);
});

startupRows.addEventListener("click", (event) => {
  if (!event.target.classList.contains("remove-row")) return;
  const row = event.target.closest("tr");
  const index = Number(row.dataset.index);
  startups.splice(index, 1);
  renderStartupRows();
});

resultsRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr");
  if (!row) return;
  selectedRank = Number(row.dataset.rank);
  renderResults();
  renderBreakdown(ranked.find((startup) => startup.rank === selectedRank));
});

discoveryRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr");
  if (!row || event.target.matches("input")) return;
  const checkbox = row.querySelector("input[type='checkbox']");
  checkbox.checked = !checkbox.checked;
});

loadStartups();

async function loadStartups() {
  setStatus("Loading saved list...", "busy");
  try {
    const response = await fetch("/.netlify/functions/startups");
    if (!response.ok) throw new Error(`Startup API returned ${response.status}`);
    const payload = await response.json();
    startups = payload.startups;
    persistenceMode.textContent = `Persistence: ${payload.persistence}`;
    renderStartupRows();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function saveStartups() {
  setStatus("Saving startup list...", "busy");
  try {
    const response = await fetch("/.netlify/functions/startups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startups })
    });
    if (!response.ok) throw new Error(`Save returned ${response.status}`);
    const payload = await response.json();
    persistenceMode.textContent = `Persistence: ${payload.persistence}`;
    setStatus("Saved");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function calculateScores() {
  if (startups.length === 0) {
    setStatus("Add at least one startup.", "error");
    return;
  }

  setStatus("Calculating scores...", "busy");
  try {
    const response = await fetch("/.netlify/functions/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startups,
        enrich: document.querySelector("#enrich-public-data").checked
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Score API returned ${response.status}`);
    ranked = payload.ranked;
    selectedRank = ranked[0]?.rank || null;
    renderResults();
    renderBreakdown(ranked[0]);
    setStatus(`Calculated ${ranked.length} startup${ranked.length === 1 ? "" : "s"}`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function discoverStartups() {
  setStatus("Discovering candidate startups...", "busy");
  try {
    const response = await fetch("/.netlify/functions/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: document.querySelector("#discovery-query").value,
        days: document.querySelector("#discovery-days").value,
        limit: document.querySelector("#discovery-limit").value
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Discovery returned ${response.status}`);
    discovered = payload.candidates || [];
    renderDiscoveryRows();
    setStatus(`Discovered ${discovered.length} candidate${discovered.length === 1 ? "" : "s"}`);
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function addSelectedDiscovered() {
  const selected = [...discoveryRows.querySelectorAll("input[type='checkbox']:checked")]
    .map((checkbox) => discovered[Number(checkbox.value)])
    .filter(Boolean);

  if (selected.length === 0) {
    setStatus("Select at least one discovered candidate.", "error");
    return;
  }

  let added = 0;
  for (const candidate of selected) {
    if (hasStartup(candidate)) {
      continue;
    }
    startups.push(candidate);
    added += 1;
  }
  renderStartupRows();
  setStatus(`Added ${added} new candidate${added === 1 ? "" : "s"} to startup inputs`);
}

function renderStartupRows() {
  startupRows.innerHTML = "";
  startups.forEach((startup, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.index = index;

    row.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      if (key === "search_terms") {
        field.value = (startup.search_terms || []).join(", ");
      } else if (manualFields.has(key)) {
        field.value = startup.manual?.[key] ?? defaultManualValue(key);
      } else {
        field.value = startup[key] || "";
      }
    });

    startupRows.appendChild(row);
  });
}

function renderDiscoveryRows() {
  discoveryRows.innerHTML = "";
  discoveryCount.textContent = discovered.length ? `${discovered.length} candidates` : "";

  discovered.forEach((candidate, index) => {
    const firstEvidence = candidate.discovery?.evidence?.[0];
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" value="${index}" aria-label="Select ${escapeAttribute(candidate.name)}"></td>
      <td>${escapeHtml(candidate.name)}</td>
      <td>${escapeHtml(candidate.website_domain || "")}</td>
      <td>${candidate.github_repo_url ? `<a href="${escapeAttribute(candidate.github_repo_url)}" target="_blank" rel="noreferrer">Repo</a>` : ""}</td>
      <td class="score">${escapeHtml(candidate.discovery_score || candidate.discovery?.score || 0)}</td>
      <td>${firstEvidence?.url ? `<a href="${escapeAttribute(firstEvidence.url)}" target="_blank" rel="noreferrer">${escapeHtml(firstEvidence.title || firstEvidence.url)}</a>` : escapeHtml(firstEvidence?.title || "")}</td>
    `;
    discoveryRows.appendChild(row);
  });
}

function renderResults() {
  resultsRows.innerHTML = "";
  resultCount.textContent = ranked.length ? `${ranked.length} ranked` : "";

  ranked.forEach((startup) => {
    const row = document.createElement("tr");
    row.dataset.rank = startup.rank;
    if (startup.rank === selectedRank) {
      row.classList.add("selected");
    }

    row.innerHTML = `
      <td>${startup.rank}</td>
      <td>${escapeHtml(startup.name)}</td>
      <td>${escapeHtml(startup.website_domain)}</td>
      <td>${startup.github_repo_url ? `<a href="${escapeAttribute(startup.github_repo_url)}" target="_blank" rel="noreferrer">Repo</a>` : ""}</td>
      <td class="score">${startup.github_score}</td>
      <td class="score">${startup.traffic_score}</td>
      <td class="score">${startup.mentions_score}</td>
      <td class="score final">${startup.startup_score}</td>
      <td><span class="badge ${escapeAttribute(startup.confidence)}">${escapeHtml(startup.confidence)}</span></td>
      <td>${escapeHtml(startup.reason)}</td>
    `;
    resultsRows.appendChild(row);
  });
}

function renderBreakdown(startup) {
  if (!startup) {
    breakdown.innerHTML = `<h2>Breakdown</h2><p class="muted">Select a ranked startup.</p>`;
    return;
  }

  const github = startup.breakdown.github;
  const traffic = startup.breakdown.traffic;
  const mentions = startup.breakdown.mentions;
  breakdown.innerHTML = `
    <h2>${escapeHtml(startup.name)}</h2>
    <div class="metric-grid">
      <div class="metric"><span>GitHub</span><strong>${startup.github_score}</strong></div>
      <div class="metric"><span>Traffic</span><strong>${startup.traffic_score}</strong></div>
      <div class="metric"><span>Mentions</span><strong>${startup.mentions_score}</strong></div>
    </div>
    <dl class="breakdown-list">
      ${breakdownRow("Recent stars score", github.star_growth_score)}
      ${breakdownRow("Total stars score", github.total_stars_score)}
      ${breakdownRow("Repo activity score", github.repo_activity_score)}
      ${breakdownRow("Monthly visits score", traffic.monthly_visits_score)}
      ${breakdownRow("Traffic growth score", traffic.traffic_growth_score)}
      ${breakdownRow("Traffic quality score", traffic.traffic_quality_score)}
      ${breakdownRow("News mentions score", mentions.news_mentions_score)}
      ${breakdownRow("Community score", mentions.community_mentions_score)}
      ${breakdownRow("Search interest score", mentions.search_interest_score)}
      ${breakdownRow("HN hits", mentions.hn_hits ?? "n/a")}
    </dl>
  `;
}

function updateStartup(index, field, value) {
  const startup = startups[index];
  if (!startup) return;

  if (field === "search_terms") {
    startup.search_terms = value.split(",").map((term) => term.trim()).filter(Boolean);
    return;
  }

  if (manualFields.has(field)) {
    startup.manual ||= {};
    startup.manual[field] = field === "monthly_visits_band" ? value : numberOrEmpty(value);
    return;
  }

  startup[field] = value.trim();
}

function exportCsv() {
  if (!ranked.length) {
    setStatus("Calculate scores before exporting.", "error");
    return;
  }

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
  const lines = ranked.map((startup) => [
    startup.rank,
    startup.name,
    startup.website_domain,
    startup.github_repo_url || "",
    startup.github_score,
    startup.traffic_score,
    startup.mentions_score,
    startup.startup_score,
    startup.confidence,
    startup.reason
  ].map(csvCell).join(","));

  const blob = new Blob([`${headers.join(",")}\n${lines.join("\n")}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ranked_startups.csv";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("CSV exported");
}

function blankStartup() {
  return {
    name: "",
    website_domain: "",
    github_repo_url: "",
    search_terms: [],
    manual: {
      monthly_visits_band: "no visible estimate",
      traffic_growth_score: 25,
      traffic_quality_score: 25,
      news_mentions_score: 0,
      reddit_mentions_score: 0,
      google_trends_score: 0,
      credibility_score: 50
    }
  };
}

function hasStartup(candidate) {
  const candidateKeys = [
    candidate.website_domain,
    candidate.github_repo_url,
    candidate.name?.toLowerCase()
  ].filter(Boolean);
  return startups.some((startup) => {
    const startupKeys = [
      startup.website_domain,
      startup.github_repo_url,
      startup.name?.toLowerCase()
    ].filter(Boolean);
    return candidateKeys.some((key) => startupKeys.includes(key));
  });
}

function defaultManualValue(field) {
  return blankStartup().manual[field];
}

function numberOrEmpty(value) {
  return value === "" ? "" : Number(value);
}

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

function breakdownRow(label, value) {
  return `<div class="breakdown-row"><dt>${escapeHtml(label)}</dt><dd><strong>${escapeHtml(value)}</strong></dd></div>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
