# AGENTS.md

Guidance for AI coding agents working in this repository.

## Global instructions still apply

Your user-level configuration takes precedence over this file and applies on top of
everything below — this file is repository-specific, not a replacement for it. For
Claude Code that means `~/.claude/CLAUDE.md`.

## Start here

[`README.md`](README.md) is the source of truth for what this project tests, what the
test environment must look like, and how to run the tests. Read it first. This file
only adds testing conventions and collaboration rules.

## Test environment

- Tests run against vClusters created by hand beforehand (`team-a`, `team-b`, `iso`,
  see README) on a `kind` host cluster. Tests don't create or delete vClusters, and they
  never touch shared vCluster settings (quotas, policies).
- Clients are built from explicitly named kubeconfig contexts. Never read or change
  the current context — `vcluster connect` switches it, and the tests must not depend
  on that.
- Derive names from the vCluster name (`vcluster-${name}`, `vc-${name}`,
  `vc-work-${name}`) instead of hardcoding them.

## Testing conventions

- "Not found" counts only on a 404 response. A connection error, a 403 or a wrong
  context fails the test; it never means "the resource is absent".
- Wait by polling, never by fixed sleeps. While polling, an expected intermediate state
  (404, `Pending`) keeps polling; any other error fails immediately. A timeout message
  includes the last observed state.
- Every created resource gets a random suffix and is cleaned up in a hook that also
  runs when the test fails. Delete only what the current run created.
- Test files run sequentially (`fileParallelism: false`): they share the same clusters.
- Assert on typed fields first (status code, `reason`, `phase`). Where the error
  message is the only thing that distinguishes one failure from another (an admission
  denial, a sync error), assert a message fragment *after* the typed fields, never
  instead of them.
- When an assertion is meant to catch a specific regression, break the expectation
  (wrong vCluster name, wrong label, wrong namespace) and confirm the test goes red
  before trusting it green.
- Run tests through the npm scripts in `package.json`, not by invoking tools directly.

## Collaboration conventions

- Prefer separate, independently green commits per logical change over one large
  commit; verify each commit's tree state passes tests before committing it.
- Ask before committing or pushing — don't do either automatically.
- When multiple options are open, list them explicitly rather than picking silently.
  When a decision is deliberately deferred ("later"), keep it as an open item instead
  of dropping it or implementing it unprompted.

## Comments and docs

- A comment (code or doc-comment) states the current mechanism or behaviour, never its
  history. No "X replaced Y because...", no "this used to...", no "no longer needed
  since...". A future reader has no prior state to compare against, and phrasing tied
  to a past change rots the moment the code changes again without a rewrite.
- Before committing, re-read every comment in each changed file, and every changed
  `.md` file, against the code as it now stands: nothing stale, nothing contradicting a
  sibling comment or the current behaviour.

## Git

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), title
only — one line, no body: `<type>: <description>`, no `(<scope>)`. This repo is small
enough (a handful of test files against one test environment) that a scope wouldn't
disambiguate anything worth naming.

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`. Dropped from
the standard Conventional Commits set as not applicable here: `style` (no formatting
tool wired into CI), `perf` (not that kind of project), `revert` (a plain `fix`/`chore`
covers it — no revert workflow to name).

End with the AI co-authorship trailer the harness appends by default
(`Co-Authored-By: <model> <email>`). Drop any `Claude-Session:` line some sessions
add — this repo doesn't keep it.
