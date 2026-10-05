/**
 * Static review of supabase/migrations/0002_hardening.sql. There is no database
 * in the test environment, so this only checks structure and the properties the
 * review asked for: it cannot prove the SQL runs. Run the migration on a
 * Supabase branch/project and walk supabase/tests/README.md before trusting it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const sql = read("0002_hardening.sql");
/** Code only: comments and string literals removed. */
const code = sql
  .replace(/--[^\n]*/g, "")
  .replace(/'(?:[^']|'')*'/g, "''");

test("0002 is syntactically balanced: quotes, parentheses, $$ blocks, terminated statements", () => {
  assert.equal(((sql.replace(/--[^\n]*/g, "")).match(/'/g) ?? []).length % 2, 0, "unbalanced quotes");
  assert.equal((code.match(/\(/g) ?? []).length, (code.match(/\)/g) ?? []).length, "unbalanced parentheses");
  assert.equal((code.match(/\$\$/g) ?? []).length % 2, 0, "unbalanced $$");
  // Outside $$ bodies every statement ends with ";".
  const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "$$$$").trim();
  assert.ok(outside.endsWith(";"));
  for (const statement of outside.split(";")) {
    const text = statement.trim();
    if (!text) continue;
    assert.match(
      text,
      /^(create|alter|grant|revoke|do|drop|comment)\b/i,
      `unexpected statement start: ${text.slice(0, 40)}`,
    );
  }
});

test("0002 leaves 0001 alone: no DROP of anything, no edit of its objects' definitions", () => {
  assert.ok(!/\bdrop\s+(table|trigger|policy|function|index|column)\b/i.test(code));
  assert.ok(!/create\s+table/i.test(code));
});

test("quotas: BEFORE INSERT triggers, SECURITY DEFINER, empty search_path, indexed counts, locked per key", () => {
  for (const [table, fn] of [
    ["communities", "enforce_community_quota"],
    ["messages", "enforce_message_quota"],
    ["channels", "enforce_channel_quota"],
  ]) {
    assert.match(code, new RegExp(`create trigger \\w+\\s+before insert on public\\.${table}\\s+for each row execute function public\\.${fn}\\(\\)`, "i"), table);
    const body = new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$;`, "i").exec(sql);
    assert.ok(body, `function ${fn}`);
    assert.match(body![0], /security definer/i);
    assert.match(body![0], /set search_path = ''/i);
    assert.match(body![0], /pg_advisory_xact_lock/i, "atomic: serialised per key");
    assert.match(body![0], /raise exception 'quota_exceeded:/i);
  }
  assert.match(code, /create index if not exists communities_owner_created_idx on public\.communities \(owner_id, created_at\)/i);
  assert.match(code, /create index if not exists messages_author_created_idx on public\.messages \(author_id, created_at\)/i);
});

test("quota numbers are the ones asked for", () => {
  assert.match(sql, /v_total >= 10/);
  assert.match(sql, /v_day >= 3/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /v_minute >= 20/);
  assert.match(sql, /v_hour >= 500/);
  assert.match(sql, /interval '1 minute'/);
  assert.match(sql, /interval '1 hour'/);
  assert.match(sql, /v_count >= 50/);
});

test("avatar and text CHECKs", () => {
  assert.match(code, /add constraint profiles_avatar_seed_safe\s+check \(avatar_seed is null or \(char_length\(avatar_seed\) between 1 and 64 and avatar_seed ~ ''\)\)/i);
  assert.match(sql, /avatar_seed ~ '\^\[A-Za-z0-9:_\.-\]\+\$'/);
  assert.match(code, /add constraint profiles_avatar_style_known/i);
  assert.match(code, /add constraint profiles_x_handle_format/i);
  // display_name <= 40 and bio <= 280 already exist in 0001: not duplicated.
  const first = read("0001_stage_a.sql");
  assert.match(first, /profiles_display_name_len check \(char_length\(display_name\) <= 40\)/);
  assert.match(first, /profiles_bio_len check \(bio is null or char_length\(bio\) <= 280\)/);
  assert.ok(!/profiles_display_name_len|profiles_bio_len/.test(sql.replace(/--[^\n]*/g, "")));
});

test("one X account, one profile: unique partial index on lower(x_handle)", () => {
  assert.match(
    code,
    /create unique index if not exists profiles_x_handle_lower_key\s+on public\.profiles \(lower\(x_handle\)\)\s+where x_handle is not null/i,
  );
});

test("kosmovia_verifier: NOLOGIN, granted to authenticator, column-level privileges only, never level 2", () => {
  assert.match(sql, /create role kosmovia_verifier nologin/i);
  assert.match(sql, /grant kosmovia_verifier to authenticator/i);
  assert.match(code, /grant usage on schema public to kosmovia_verifier/i);
  assert.match(code, /revoke all on public\.profiles from kosmovia_verifier/i);
  assert.match(code, /grant select \(id, wallet\) on public\.profiles to kosmovia_verifier/i);
  assert.match(code, /grant update \(x_handle, x_verified_at, trust_level\) on public\.profiles to kosmovia_verifier/i);

  // Every GRANT that names the role is one of the three above: nothing broader.
  const grants = code.split(";").filter((s) => /to kosmovia_verifier/i.test(s) && /^\s*grant/i.test(s));
  assert.equal(grants.length, 3);
  assert.ok(!/(grant\s+(all|insert|delete|truncate|references|trigger))[^;]*kosmovia_verifier/i.test(code));
  assert.ok(!/service_role/i.test(code));

  const policy = /create policy profiles_verifier_update on public\.profiles[\s\S]*?;/i.exec(code);
  assert.ok(policy);
  assert.match(policy![0], /for update to kosmovia_verifier/i);
  assert.match(policy![0], /with check \(trust_level <= 1\)/i);

  const guard = /create or replace function public\.profiles_verifier_guard\(\)[\s\S]*?\$\$;/i.exec(sql);
  assert.ok(guard);
  assert.match(guard![0], /current_user = 'kosmovia_verifier'/);
  assert.match(guard![0], /old\.trust_level >= 2/);
  assert.match(guard![0], /new\.trust_level > 1/);
  assert.match(code, /create trigger profiles_before_update_verifier_guard\s+before update on public\.profiles/i);
});

test("the creating grants of 0001 still keep trust_level and X columns out of reach of `authenticated`", () => {
  const first = read("0001_stage_a.sql");
  const insert = /grant insert \(([^)]*)\)\s+on public\.profiles to authenticated/i.exec(first);
  const update = /grant update \(([^)]*)\)\s+on public\.profiles to authenticated/i.exec(first);
  assert.ok(insert && update);
  for (const columns of [insert![1], update![1]]) {
    assert.ok(!/trust_level|x_handle|x_verified_at/.test(columns));
  }
});
