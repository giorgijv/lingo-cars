---
name: pr-workflow
description: Use for the git/PR/CI/deploy loop on this repo — starting a new change, opening a PR, waiting for an explicit "merge" instruction, and confirming the GitHub Pages deploy actually went live after merging. Encodes the specific gotchas hit repeatedly in this project (merged-branch restart, huge Actions API responses, the Pages-deploy retry rule, and this sandbox's flaky Postgres).
---

# PR workflow for this repo

## Starting a new change

The designated feature branch gets reused across many separate tasks in
this repo. Before writing any code:

```bash
git fetch origin main
git merge-base --is-ancestor HEAD origin/main && echo "fully merged, safe to restart"
```

If it prints "fully merged" (i.e. the branch's last PR was already merged
into `main`), restart the branch from latest `main` rather than stacking
new commits on old merged history:

```bash
git checkout -B claude/phase-0-schema-fsrs-dxh261 origin/main
```

If it does *not* print that, the branch has unmerged commits — do not
restart; rebase/keep them instead.

## Before pushing

Always run, and fix anything red before committing:

```bash
npm run typecheck
npm run content:check   # only relevant if content/ changed
npm test
```

`npm test` DB-integration failures are frequently environmental, not a
regression — check `pg_lsclusters` first. If Postgres shows `down`:

```bash
sudo pg_ctlcluster 16 main start || pg_ctlcluster 16 main start
```

then re-run the full suite before concluding anything is actually broken.

## Opening the PR

- No PR template exists in this repo (`.github/pull_request_template.md`
  etc. — checked, absent) — write the body freely (Summary + Test plan).
- Never merge without the user explicitly saying "merge" — creating the PR
  and getting CI green is not the same as authorization to merge.
- After creating the PR, call `subscribe_pr_activity` so CI failures and
  review comments arrive as webhook events instead of needing to be polled.

## Reading Actions/CI state without blowing up the context window

`mcp__github__actions_list` / `actions_get` responses for this repo are
huge (200K+ characters) and get written to a
`tool-results/mcp-github-actions_list-*.txt` file instead of being returned
inline. Don't try to read that file directly — pipe it through Python to
extract just `id`/`head_sha`/`status`/`conclusion`/`created_at`:

```bash
cat <path-from-error>.txt | python3 -c "
import json,sys
data=json.load(sys.stdin)
for r in data.get('workflow_runs', [])[:5]:
    print(r.get('id'), r.get('head_sha'), r.get('status'), r.get('conclusion'), r.get('created_at'))
"
```

Then `mcp__github__actions_get` (`get_workflow_run`, by numeric `run_id`,
not `resource_id=owner/repo`) for a single run's live status.

## Merging (only on explicit "merge")

```
mcp__github__merge_pull_request
```

The PR-activity subscription auto-unsubscribes on merge/close — don't
reopen the same PR afterward unless explicitly asked to.

## After merging: verify the Pages deploy actually went live

A push to `main` that touches `docs/index.html` (or really any push to
`main`, since the workflow isn't path-filtered) triggers
`.github/workflows/pages.yml`. It is **known to fail transiently** with a
generic "Deployment failed, try again later." error roughly half the time
in this repo, even though the build/artifact step always succeeds — this
is not a real regression to chase down.

1. Find the run for the merge commit's SHA (`list_workflow_runs`,
   `resource_id: "pages.yml"`, `workflow_runs_filter: {branch: "main"}`,
   filtered through the Python snippet above).
2. If `conclusion` is `failure`: retry with a **fresh** dispatch —
   `mcp__github__actions_run_trigger` with `method: "run_workflow"`,
   `workflow_id: "pages.yml"`, `ref: "main"`. **Never use
   `rerun_failed_jobs`** — it collides with the previous run's already-
   uploaded artifact ("Multiple artifacts named github-pages").
3. Wait ~30–40s (a background `sleep` + wait for its completion
   notification, not a blocking foreground sleep), re-check, repeat if
   needed — it has taken up to 4 attempts in practice, though it often
   succeeds on the first retry or even the first push.
4. Only report the feature as "live" once you've confirmed
   `status: completed` / `conclusion: success` for that exact merge SHA.

## Long-lived PR monitoring

If asked to babysit/watch a PR past this session, and the `send_later` MCP
tool isn't available (check via `ToolSearch` — it's often not present),
fall back to `CronCreate` with a one-shot (`recurring: false`) job roughly
an hour out that re-checks CI/mergeability/comments and silently re-arms
itself if nothing changed, per the standing PR-activity instructions.
