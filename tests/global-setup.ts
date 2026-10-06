import { migrateTestDatabase } from "./env";

export default function globalSetup() {
  migrateTestDatabase();
}