import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// tb-platform-grant-audit-001: on-demand audit that diffs every public table's LIVE
// authenticated/anon grants against the checked-in expected-grants.json manifest, so a future
// accidental table-wide grant (the profiles/workspaces bug's root cause -- see
// 20260810170000_profiles_grant_lockdown.sql) gets caught by running this script instead of
// sitting unnoticed for six weeks like it did the first time.
//
// This is detection only -- it never writes to the database. It shells out to the Supabase CLI
// (`supabase db query --linked`, same tool this repo already uses for read-only live-state
// checks -- see the "Supabase secrets list masking" precedent of querying live state instead of
// trusting what a migration file claims) to read two things:
//   1. table-level DELETE/TRUNCATE privileges, via has_table_privilege() -- Postgres has no
//      column-level grant for either verb, so a plain boolean is authoritative.
//   2. SELECT/INSERT/UPDATE privileges, via information_schema.column_privileges -- this view
//      expands a table-wide grant (`grant select on t to authenticated`) into a row per column
//      just as faithfully as an explicit column-scoped grant (`grant insert (a, b) on t to
///     authenticated`), so it's a reliable way to detect either "some extra column snuck in" or
//      "the whole table got re-opened" without needing two different code paths.
//
// Run via (from application/backend, project must be linked -- `supabase link --project-ref
// skfnrcwqvmurnpwrmixj` once per checkout/worktree if `supabase status`/`supabase db query
// --linked` reports "Cannot find project ref"):
//   npx tsx src/scripts/verify-grants.ts
//
// Exit code 0 + a clean report means live grants match the manifest exactly. Exit code 1 means
// at least one table/role/verb pair holds more (or less) than expected -- the per-line detail
// tells you exactly which table, which verb, and which columns, which is what you need to know
// to write the fixing migration (same revoke/re-grant pattern as tb-platform-grant-lockdown-001).
// This script does not fix anything, and it is not wired into CI -- see this tracer bullet's
// "What Happens Next" for why that's a deliberately separate, deferred decision.

type Role = 'authenticated' | 'anon';
const ROLES: Role[] = ['authenticated', 'anon'];

interface TableGrantSpec {
  select: boolean;
  insert: string[];
  update: string[];
  delete: boolean;
  truncate: boolean;
}

interface Manifest {
  anonBaseline: TableGrantSpec;
  tables: Record<string, Partial<Record<Role, TableGrantSpec>>>;
}

interface ActualGrantState {
  select: Set<string>; // columns with SELECT
  insert: Set<string>;
  update: Set<string>;
  delete: boolean;
  truncate: boolean;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// application/backend/src/scripts -> repo root is four levels up.
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
const MANIFEST_PATH = resolve(SCRIPT_DIR, 'expected-grants.json');

function runSql(sql: string): any[] {
  let stdout: string;
  try {
    stdout = execFileSync('supabase', ['db', 'query', '--linked', sql, '--output-format', 'json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() ?? '';
    console.error('supabase db query --linked failed.');
    if (stderr) console.error(stderr);
    console.error(
      'If this says "Cannot find project ref", link this checkout/worktree first:\n' +
        '  supabase link --project-ref skfnrcwqvmurnpwrmixj',
    );
    process.exit(1);
  }
  const parsed = JSON.parse(stdout);
  return parsed.rows ?? [];
}

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as Manifest;
}

async function main() {
  const manifest = loadManifest();

  // 1. Table-level DELETE/TRUNCATE booleans, and the authoritative list of live public tables.
  const tableRoleRows = runSql(`
    select
      c.relname as table_name,
      r.rolname as grantee,
      has_table_privilege(r.rolname, c.oid, 'DELETE') as delete_priv,
      has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as truncate_priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('authenticated'), ('anon')) as r(rolname)
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname, r.rolname;
  `);

  // 2. Column-level SELECT/INSERT/UPDATE grants (this also fully captures table-wide grants --
  //    Postgres/PostgREST expand those into a row per column here too).
  const columnRows = runSql(`
    select table_name, grantee, privilege_type, column_name
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('authenticated', 'anon')
    order by table_name, grantee, privilege_type, column_name;
  `);

  const liveTables = new Set<string>();
  const actual = new Map<string, Map<Role, ActualGrantState>>();

  function getActual(table: string, role: Role): ActualGrantState {
    let byRole = actual.get(table);
    if (!byRole) {
      byRole = new Map();
      actual.set(table, byRole);
    }
    let state = byRole.get(role);
    if (!state) {
      state = { select: new Set(), insert: new Set(), update: new Set(), delete: false, truncate: false };
      byRole.set(role, state);
    }
    return state;
  }

  for (const row of tableRoleRows) {
    liveTables.add(row.table_name);
    const state = getActual(row.table_name, row.grantee as Role);
    state.delete = !!row.delete_priv;
    state.truncate = !!row.truncate_priv;
  }

  for (const row of columnRows) {
    const state = getActual(row.table_name, row.grantee as Role);
    const verb = (row.privilege_type as string).toUpperCase();
    if (verb === 'SELECT') state.select.add(row.column_name);
    else if (verb === 'INSERT') state.insert.add(row.column_name);
    else if (verb === 'UPDATE') state.update.add(row.column_name);
    // REFERENCES and any other column-grantable privilege type is out of scope -- nothing in
    // this codebase grants it, and the manifest has no field for it.
  }

  const issues: string[] = [];
  const manifestTables = Object.keys(manifest.tables).sort();

  // New tables live but not yet in the manifest -- the exact recurrence this script exists to
  // catch: a table added after this doc was written, never audited.
  for (const table of [...liveTables].sort()) {
    if (!manifest.tables[table]) {
      issues.push(`UNKNOWN TABLE '${table}' exists live but has no entry in expected-grants.json -- add one.`);
    }
  }
  // Manifest entries for tables that no longer exist -- stale, but not a security risk; flagged
  // so the manifest stays a true reflection of the schema.
  for (const table of manifestTables) {
    if (!liveTables.has(table)) {
      issues.push(`STALE MANIFEST ENTRY '${table}' is in expected-grants.json but no longer exists live -- remove it.`);
    }
  }

  function diffColumnSet(label: string, table: string, role: Role, expected: string[], actualSet: Set<string>) {
    const expectedSet = new Set(expected);
    const extra = [...actualSet].filter((c) => !expectedSet.has(c)).sort();
    const missing = expected.filter((c) => !actualSet.has(c)).sort();
    if (extra.length > 0) {
      issues.push(`${table} / ${role} / ${label}: OVER-GRANTED -- live has extra column(s) not in the manifest: [${extra.join(', ')}]`);
    }
    if (missing.length > 0) {
      issues.push(`${table} / ${role} / ${label}: UNDER-GRANTED -- manifest expects column(s) live is missing: [${missing.join(', ')}]`);
    }
  }

  let checkedTablePairs = 0;
  for (const table of manifestTables) {
    if (!liveTables.has(table)) continue; // already reported as stale above
    for (const role of ROLES) {
      const expected: TableGrantSpec = manifest.tables[table]?.[role] ?? manifest.anonBaseline;
      const state = getActual(table, role);
      checkedTablePairs += 1;

      const actualSelect = state.select.size > 0;
      if (actualSelect !== expected.select) {
        issues.push(
          `${table} / ${role} / SELECT: expected ${expected.select}, live ${actualSelect}` +
            (actualSelect && !expected.select ? ' -- OVER-GRANTED' : ''),
        );
      }
      diffColumnSet('INSERT', table, role, expected.insert, state.insert);
      diffColumnSet('UPDATE', table, role, expected.update, state.update);
      if (state.delete !== expected.delete) {
        issues.push(
          `${table} / ${role} / DELETE: expected ${expected.delete}, live ${state.delete}` +
            (state.delete && !expected.delete ? ' -- OVER-GRANTED' : ''),
        );
      }
      if (state.truncate !== expected.truncate) {
        issues.push(
          `${table} / ${role} / TRUNCATE: expected ${expected.truncate}, live ${state.truncate}` +
            (state.truncate && !expected.truncate ? ' -- OVER-GRANTED' : ''),
        );
      }
    }
  }

  console.log(`Checked ${manifestTables.length} manifest table(s) x ${ROLES.length} role(s) (${checkedTablePairs} pairs) against live grants.\n`);

  if (issues.length === 0) {
    console.log('PASS -- live grants match expected-grants.json exactly. No drift found.');
    process.exit(0);
  }

  for (const issue of issues) console.log(`FAIL - ${issue}`);
  console.log(`\n${issues.length} issue(s) found. Fix by writing a migration that revokes the extra grant (same revoke/re-grant pattern as tb-platform-grant-lockdown-001), then re-run this script.`);
  process.exit(1);
}

main();
