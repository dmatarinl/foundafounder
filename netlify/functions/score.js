const { rankStartups } = require("./lib/scoring.cjs");
const sampleStartups = require("./lib/sample-startups.cjs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, "");
    }

    if (event.httpMethod === "GET") {
      const startups = sampleStartups;
      const ranked = await rankStartups(startups, { enrich: false });
      return response(200, { startups, ranked });
    }

    if (event.httpMethod !== "POST") {
      return response(405, { error: "Method not allowed" });
    }

    const payload = JSON.parse(event.body || "{}");
    const startups = Array.isArray(payload.startups) ? payload.startups : [];
    if (startups.length === 0) {
      return response(400, { error: "Provide a non-empty startups array." });
    }

    const ranked = await rankStartups(startups, {
      enrich: payload.enrich !== false,
      githubToken: process.env.GITHUB_TOKEN
    });
    return response(200, { ranked });
  } catch (error) {
    return response(500, {
      error: error.message || "Unexpected scoring error"
    });
  }
};

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
