// Aplica db/migrations/*.sql a la base de DATABASE_URL (modo "api", Postgres plano).
//
//   npm run db:migrate
//
// - Lleva la cuenta en la tabla `schema_migrations` y salta lo ya aplicado.
// - Cada migracion corre en su propia transaccion; un lock de sesion evita que
//   dos corridas a la vez apliquen lo mismo.
// - TLS: por defecto verifica el certificado (rejectUnauthorized: true). Si la
//   cadena de la base no se pudiera verificar, el error lo dice y se puede
//   forzar DATABASE_SSL=no-verify (cifrado, sin verificar la cadena) o
//   DATABASE_SSL=off. Ver db/README.md.
// - Nunca imprime la URL ni el mensaje de errores de red (pueden contener el host).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describeConnectionError, readDbConfig } from "../lib/core/db/config.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
// Clave de pg_advisory_lock: solo para esta herramienta.
const LOCK_KEY = 7_452_001;

let config;
try {
  config = readDbConfig();
} catch (err) {
  console.error(`db:migrate  ${err instanceof Error ? err.message : "DATABASE_URL invalida."}`);
  process.exit(1);
}
if (!config) {
  console.error("db:migrate  Falta DATABASE_URL (en app/.env.local o en el entorno).");
  process.exit(1);
}

const client = new pg.Client({ ...config, statement_timeout: 0 });
let exitCode = 0;

try {
  await client.connect();
  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  await client.query(
    "create table if not exists public.schema_migrations (" +
      "version text primary key, applied_at timestamptz not null default now())",
  );
  const applied = new Set((await client.query("select version from public.schema_migrations")).rows.map((r) => r.version));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`  ya aplicada  ${version}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public.schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
      console.log(`  aplicada     ${version}`);
      ran += 1;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    }
  }
  console.log(ran === 0 ? "db:migrate  nada que aplicar." : `db:migrate  ${ran} migracion(es) aplicada(s).`);
} catch (err) {
  console.error(`db:migrate  fallo: ${describeConnectionError(err)}`);
  exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
process.exit(exitCode);
