import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import { MIGRATIONS } from "./migrations.js";

export interface Db {
  client: Client;
  db: LibSQLDatabase<typeof schema>;
  file: string;
}

async function ensureMigrations(client: Client): Promise<void> {
  await client.executeMultiple(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const applied = new Set<string>();
  const rs = await client.execute("SELECT name FROM _migrations");
  for (const row of rs.rows) applied.add(String(row["name"]));

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await client.executeMultiple(m.sql);
    await client.execute({
      sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
      args: [m.name, new Date().toISOString()],
    });
  }
}

export async function createDb(file: string): Promise<Db> {
  const client = createClient({ url: `file:${file}` });
  await ensureMigrations(client);
  const db = drizzle(client, { schema });
  return { client, db, file };
}

export async function closeDb(db: Db): Promise<void> {
  db.client.close();
}
