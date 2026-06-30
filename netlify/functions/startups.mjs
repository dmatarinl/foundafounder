import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "@netlify/database";
import sampleStartups from "./lib/sample-startups.cjs";

const localPath = path.resolve(process.cwd(), "data/startups.json");
const STARTUPS_KEY = "startups";

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, "");
    }

    if (event.httpMethod === "GET") {
      const startups = await loadStartups();
      return response(200, { startups, persistence: await persistenceMode() });
    }

    if (event.httpMethod === "PUT") {
      const payload = JSON.parse(event.body || "{}");
      if (!Array.isArray(payload.startups)) {
        return response(400, { error: "Provide a startups array." });
      }
      await saveStartups(payload.startups);
      return response(200, { ok: true, persistence: await persistenceMode() });
    }

    return response(405, { error: "Method not allowed" });
  } catch (error) {
    return response(500, {
      error: error.message || "Unexpected startup storage error"
    });
  }
}

async function loadStartups() {
  const db = await getNetlifyDatabase();
  if (db) {
    await ensureSchema(db);
    const result = await db.pool.query("SELECT value FROM app_state WHERE key = $1", [STARTUPS_KEY]);
    const saved = result.rows[0]?.value;
    if (saved) {
      return saved;
    }
  }

  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf8"));
  }
  return sampleStartups;
}

async function saveStartups(startups) {
  const db = await getNetlifyDatabase();
  if (db) {
    await ensureSchema(db);
    await db.pool.query(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [STARTUPS_KEY, JSON.stringify(startups)]
    );
    return;
  }

  if (!canUseLocalFile()) {
    throw new Error("Hosted persistence is unavailable because NETLIFY_DB_URL is not available to this Function runtime.");
  }

  fs.writeFileSync(localPath, `${JSON.stringify(startups, null, 2)}\n`);
}

async function persistenceMode() {
  if (await getNetlifyDatabase()) {
    return "netlify-database";
  }
  return canUseLocalFile() ? "local-file" : "sample-fallback";
}

async function getNetlifyDatabase() {
  try {
    return getDatabase();
  } catch (_error) {
    return null;
  }
}

async function ensureSchema(db) {
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function canUseLocalFile() {
  try {
    return fs.existsSync(localPath) && fs.accessSync(path.dirname(localPath), fs.constants.W_OK) === undefined;
  } catch (_error) {
    return false;
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Content-Type": "application/json"
    },
    body: body === "" ? "" : JSON.stringify(body)
  };
}
