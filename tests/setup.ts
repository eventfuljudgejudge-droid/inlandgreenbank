import { beforeEach } from "vitest";
import { loadEnv } from "./env";
import { resetDatabase } from "./helpers";

loadEnv();

beforeEach(async () => {
  await resetDatabase();
});