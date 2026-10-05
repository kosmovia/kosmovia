// Chequeo de SOLO LECTURA de la base de DATABASE_URL (modo "api").
//
//   npm run db:check
//
// Imprime unicamente: las tablas del esquema `public` y cuantas filas tiene
// cada tabla de Kosmovia. No lee ni muestra ningun dato de las filas.

import pg from "pg";
import { describeConnectionError, readDbConfig } from "../lib/core/db/config.ts";

const TABLES = ["profiles", "communities", "members", "channels", "messages", "schema_migrations"];

let config;
try {
  config = readDbConfig();
} catch (err) {
  console.error(`db:check  ${err instanceof Error ? err.message : "DATABASE_URL invalida."}`);
  process.exit(1);
}
if (!config) {
  console.error("db:check  Falta DATABASE_URL (en app/.env.local o en el entorno).");
  process.exit(1);
}

const client = new pg.Client(config);
let exitCode = 0;
try {
  await client.connect();
  // Sesion de solo lectura: cualquier escritura fallaria.
  await client.query("set default_transaction_read_only = on");

  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  console.log("tablas en public:");
  for (const row of tables.rows) console.log(`  ${row.table_name}`);

  console.log("filas por tabla:");
  const present = new Set(tables.rows.map((r) => r.table_name));
  for (const name of TABLES) {
    if (!present.has(name)) {
      console.log(`  ${name}: (no existe)`);
      continue;
    }
    // `name` sale de la lista fija de arriba, no de entrada externa.
    const count = await client.query(`select count(*)::int as n from public.${name}`);
    console.log(`  ${name}: ${count.rows[0].n}`);
  }
} catch (err) {
  console.error(`db:check  fallo: ${describeConnectionError(err)}`);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
