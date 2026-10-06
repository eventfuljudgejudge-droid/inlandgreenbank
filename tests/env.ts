import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Load .env (if present) without a dotenv dependency, then point DATABASE_URL
 * at the dedicated test database so tests never touch development data.
 */
export function loadEnv(): void {
  if (process.env.TEST_DATABASE_URL) return;
  try {
    const raw = readFileSync(".env", "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (!process.env[key]) process.env[key] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // no .env file; rely on ambient environment
  }
  if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL.replace(/banksim\?/, "banksim_test?");
  }
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is required to run the test suite.");
  }
  process.env.DATABASE_URL = testUrl;
}

/**
 * Ensure the test database schema matches the migrations.
 */
export function migrateTestDatabase(): void {
  loadEnv();
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "inherit",
  });
}