#!/usr/bin/env node
// Lists what a change can reach, by following imports backwards.
//   impact.mjs            working tree (with new files) against HEAD
//   impact.mjs <base>     working tree against <base>
//   impact.mjs <a> <b>    commit <a> against commit <b>
//   impact.mjs --files a.ts,b.tsx   what editing these would reach, before touching them
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const root = git('rev-parse', '--show-toplevel');
process.chdir(root);

const [base, head] = process.argv.slice(2);
const lines = (text) => text.split('\n').filter(Boolean);
const changed = base === '--files'
  ? (head ?? '').split(',').filter(Boolean)
  : head
  ? lines(git('diff', '--name-only', base, head))
  : [...new Set([...lines(git('diff', '--name-only', base ?? 'HEAD')), ...lines(git('ls-files', '--others', '--exclude-standard'))])];

const SHARED = 'packages/shared/src';
const SOURCE_DIRS = ['apps/web/src', 'apps/api/src', SHARED];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const files = SOURCE_DIRS.filter(existsSync).flatMap(walk);

function resolveImport(from, spec) {
  const path = resolve(dirname(from), spec);
  const candidates = extname(spec) ? [path] : [`${path}.ts`, `${path}.tsx`, join(path, 'index.ts'), join(path, 'index.tsx')];
  const hit = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  return hit ? relative(root, hit) : null;
}

// Which shared file defines each exported name, since everyone imports them through the index.
const definedIn = new Map();
for (const file of files.filter((f) => f.startsWith(SHARED))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    definedIn.set(m[1], file);
  }
}

const importers = new Map();
const link = (target, file) => {
  if (!importers.has(target)) importers.set(target, new Set());
  importers.get(target).add(file);
};
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
    if (m[1].startsWith('.')) {
      const target = resolveImport(file, m[1]);
      if (target) link(target, file);
    }
  }
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@trading\/shared['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (definedIn.has(name)) link(definedIn.get(name), file);
    }
  }
}

// Routes are where the API side stops: past them is the whole app, which says nothing.
const isApiRoute = (f) => f.startsWith('apps/api/src/routes/');
const reached = new Map(); // file -> steps from a changed file
let ring = changed.filter((f) => files.includes(f));
for (let depth = 0; ring.length; depth++) {
  const next = [];
  for (const file of ring) {
    if (reached.has(file)) continue;
    reached.set(file, depth);
    if (!isApiRoute(file)) next.push(...(importers.get(file) ?? []));
  }
  ring = next;
}

// Whole-file imports overstate how far a change really goes, so the files using a changed one
// directly come first; the rest only matter if the changed behaviour can travel that far.
const groupBy = (list, pattern) => [...new Set(list.map((f) => f.match(pattern)?.[1]).filter(Boolean))].sort();
const near = [...reached.keys()].filter((f) => reached.get(f) <= 1);
const all = [...reached.keys()];
const pick = (list) => ({
  screens: groupBy(list, /^apps\/web\/src\/features\/([^/]+)\//),
  routes: groupBy(list, /^apps\/api\/src\/routes\/([^/.]+)/),
  services: groupBy(list, /^apps\/api\/src\/services\/([^/.]+)/),
});
const direct = pick(near);
const { screens, routes, services } = pick(all);
const without = (list, shown) => list.filter((x) => !shown.includes(x));
const has = (pattern) => changed.some((f) => pattern.test(f));

const flags = [
  [has(/^apps\/api\/drizzle\/|db\/schema\.ts$/), 'Database: check the migration on existing data, not only on a fresh one.'],
  [has(/^apps\/web\/src\/styles\.css$/), 'Design tokens changed: every screen, both themes, 1x and Retina.'],
  [has(/^apps\/web\/src\/i18n\//), 'UI strings changed: check both languages on the screens using them.'],
  [has(/^apps\/web\/src\/layout\//) || near.includes('apps/web/src/layout/AppShell.tsx'), 'App shell affected: menu, phone drawer and clock appear on every screen.'],
  [has(/^apps\/web\/src\/api\/hooks\.ts$/), 'hooks.ts changed: the import list is wide; look at which hooks actually changed.'],
  [has(/^apps\/api\/src\/types\.ts$/) || routes.length > 0 || services.length > 0, 'API changed: imports do not lead to screens, use "Route file to screens" in references/screens.md.'],
  [has(/plans\.ts$|current-user\.ts$/), 'Plans or access changed: check Standard, Pro, admin and the demo.'],
  [has(/auth\.ts$|features\/auth\//), 'Sign-in changed: sign-up, activation, sign-in, reset, 2FA.'],
  [has(/billing/), 'Billing changed: Checkout, portal and webhook in Stripe test mode.'],
  [has(/^(docker-compose\.yml|Dockerfile|deploy\/)|\.env\.example$|env\.example$/), 'Deployment files changed: compare with the production .env and procedure.'],
  [has(/Caddyfile$/), 'Caddy changed: CSP and headers apply only in production.'],
  [has(/package(-lock)?\.json$/), 'Dependencies changed: treat as reaching everything; build and open the main screens.'],
].filter(([on]) => on).map(([, text]) => text);

const section = (title, list) => console.log(`\n${title}:\n${list.length ? list.map((x) => `  ${x}`).join('\n') : '  (none)'}`);
console.log(`Changed files: ${changed.length}`);
section('Changed', changed);
section('Check first: screens using it directly', direct.screens);
section('Check first: API routes using it directly', direct.routes);
section('Check first: API services using it directly', direct.services);
section('Further: screens reached indirectly', without(screens, direct.screens));
section('Further: API routes reached indirectly', without(routes, direct.routes));
section('Also check', flags);
if (changed.length && reached.size === 0) console.log('\nNo source file among these: nothing in the import graph is reached.');
