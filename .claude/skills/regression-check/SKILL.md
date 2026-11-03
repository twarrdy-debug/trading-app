---
name: regression-check
description: Stops a change in AlphaLogFX from breaking something else. Use for every change to this app that touches code, before the work is called finished and again before and after a deploy, whenever adding a feature, fixing a bug, refactoring, updating dependencies, changing the database, or deploying, even if the change looks small or isolated and even if nobody asks for testing. Also use when the owner says "sprawdź czy działa", "czy coś się nie popsuło", "znowu nie działa", "dodaj", "popraw", "napraw", "wdrażaj" or "wrzuć na produkcję". Not needed for changes that touch only text documents or questions that change no code.
---

# Regression check

The owner's complaint: "często poprawiasz jedną rzecz, a psujesz inną". The cause is usually that only the changed spot gets checked. Green tests do not settle it here: the tests cover the API and shared logic, and **nothing automated covers the web screens**, which is where most of the repeat bugs appeared (chart line dragging, the date picker, layouts on phones). So a screen counts as working only once it has been used in a browser.

Scale the effort to what `impact.mjs` reports, not to how small the diff feels. A one-line change in `trade-math.ts` or `components/ui/` reaches more screens than a new feature on its own page.

## 1. Before editing

- Run the baseline: `npm test` and `npm run typecheck`. A failure that already exists must be known now, or it will look like your regression later (or yours will look like an old one).
- For a bug, reproduce it first and see it fail. If it cannot be reproduced, say so instead of shipping a guess.
- See what the file reaches with `impact.mjs --files <path>,<path>`, read the callers of what you are about to change, and search for the same pattern elsewhere. A bug fixed in one place often lives in its siblings too.

## 2. While editing

- Fix the cause, in the fewest places. Leave unrelated code alone: every extra edit widens what has to be rechecked.
- For a bug in logic that a test can reach (`packages/shared`, API), add a test that failed before the fix. It stops this bug coming back.
- If a change has to alter behaviour other screens rely on, stop and name those screens before continuing.

## 3. After editing: find what it reaches

```sh
node .claude/skills/regression-check/scripts/impact.mjs            # working tree against HEAD
node .claude/skills/regression-check/scripts/impact.mjs main       # the whole branch
```

It follows imports backwards. "Check first" is what uses the changed files directly, and always gets checked. "Further" overstates, because importing a file does not mean using the changed part: go through it whenever the changed behaviour can travel that far (a calculation, a shared component, access rules), and say what you skipped. It cannot see runtime links, so also read `references/screens.md`, which has what must work on each screen and the links between features (a trade feeds statistics, the dashboard, the monitor, balances and more).

## 4. Check, in this order

Stop at a failure, fix it, then **start again from step 3**, because a fix is a change too.

1. **Automated:** `npm run typecheck`, `npm test`, `npm run build`. Read the results, and check the exit codes rather than a piped tail.
2. **The change itself:** use it in a browser (Playwright) on http://localhost:5173, the way a user would, including the awkward paths: empty fields, wrong values, cancel, reload.
3. **Everything in scope from the impact list:** for each screen, do what `references/screens.md` says, and read the browser console and failed network requests. A page that renders can still have a dead button, so click, do not just look.
4. **Variations the change could affect:**
   - width 390, 768, 1024, 1280, 1920, 2560 for layout changes, with no sideways page scroll;
   - touch as well as mouse for anything dragged or tapped;
   - light and dark theme, Polish and English (new strings in both `i18n` files);
   - plans: Standard, Pro, admin and the demo, when gating, limits or a menu item changed.
5. **Conditional, when the impact list flags it:**
   - migration: it applies on the existing data, the tests' fresh database does not prove that;
   - outside resource: the production CSP in `deploy/docker/Caddyfile` allows it, because development does not enforce it;
   - new environment variable: in `.env.example`, `deploy/docker/env.example` and the docs;
   - new route: its rate limit if it calls outside services, sends mail or parses files, and its plan and demo gating.

Local test data is fine; remove what you created. Tests fake outside services (Stripe, Capital.com, FX, mail), so real behaviour of those has not been verified unless you say how you exercised it.

## 5. Report honestly

End with this, in Polish, in the owner's words rather than code terms:

```
Sprawdziłem i działa: <what, and how: test / clicked in the browser / on which widths>
Znalazłem i naprawiłem po drodze: <regressions found, or "nic">
Nie sprawdziłem: <what, and why>
```

"Nie sprawdziłem" is never left out to look better, and if it is empty, that was actually verified. Say "działa" only about what was seen working. A bug found outside this change gets reported, not silently fixed or ignored.

## 6. Deploying

Only on the owner's explicit word for this change (see the deploy memory). A request to build something is not that word. The procedure is in the production memory; this skill adds the checks around it.

**Before:** steps 3–5 against everything going out (`impact.mjs <deployed commit>`, the deployed one is in `/opt/trading-app/VERSION`), and a fresh database backup.

**After**, on https://www.alphalogfx.com, without writing anything:
- `VERSION` and Admin → System status show the new commit, the containers are healthy, migrations applied;
- `docker compose logs api --since 5m` has no new errors;
- the landing page and sign-in load; the screens the change reached work, using "See the demo" (read-only) with the console open.

Real users' data is there, so never create test records on production, and say what could only be checked locally. If something broke, tell the owner at once and offer the rollback (`/opt/trading-app-old`, plus the backup if a migration ran). Do not stack hurried fixes on production.
