---
name: learn
description: Mine patterns from claude-mem observations, review and manage learned rules, and sync them to CLAUDE.md. Use when asked to "learn from past sessions", "show rules", "generate rules", "what should I remember", "rule stats", "sync rules", or anything about learned rules.
---

# Learn

Single entry point for mining, reviewing, and managing learned rules.

## Default Flow (no arguments)

When the user just says `/learn`, run the full workflow:

### Step 1: Mine new candidates

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --incremental
```

Use `--incremental` by default (only scans observations since last mining run). If the user says "rescan everything" or "full scan", use `--full` instead.

### Step 2: Show what's new + what's pending

List candidates awaiting review:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --list-candidates
```

If there are candidates, present them in a table:
| ID | Category | Rule | Confidence |
|----|----------|------|------------|

If no candidates, say so and show active rules instead (Step 4).

### Step 3: User review

Ask the user to accept or reject candidates. Support batch input like "accept 6,9,10 reject 1,2,3".

For each accepted ID:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --activate=ID
```

For each rejected ID:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --reject=ID
```

### Step 4: Write to CLAUDE.md

After review, sync all active rules into the project's CLAUDE.md:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --write-claude-md
```

Show the user what was written. Remind them the rules section is just markdown — they can edit it directly.

## Other Operations

If the user asks for something specific, use the matching command:

### "show rules" / "list rules"
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --list --status=active
```

### "rule details" / "show rule 5"
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --show=RULE_ID
```

### "pause rule 5" (removes from CLAUDE.md on next sync)
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --pause=RULE_ID
```
Then sync: `--write-claude-md`

### "stats"
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --stats
```

### "prune" (retire stale rules)
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-rules.js" --project="$(basename "$PWD")" --prune
```
Then sync: `--write-claude-md`
