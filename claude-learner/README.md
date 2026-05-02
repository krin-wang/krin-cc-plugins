# claude-learner

A Claude Code plugin that mines [claude-mem](https://github.com/thedotmack/claude-mem) observations for patterns and writes learned rules to your project's CLAUDE.md.

## The Problem

claude-mem captures structured observations of everything you do — gotchas, decisions, lessons, patterns. But it never uses that data to improve Claude's behavior. claude-learner closes that loop.

```
claude-mem captures observations → claude-learner mines patterns → rules written to CLAUDE.md → Claude follows them
```

## Requirements

- **claude-mem plugin** (thedotmack/claude-mem) — must be installed and have recorded observations
- **Node.js** 18+
- **better-sqlite3** (installed automatically via `npm install`)

## Install

In Claude Code:

```
/plugin marketplace add krin-wang/krin-cc-plugins
/plugin install claude-learner@krin-cc-plugins
```

## Usage

One command: `/learn`

```
/learn              Mine new candidates, review them, write approved rules to CLAUDE.md
/learn list         Show active rules
/learn stats        Show rule statistics
/learn prune        Retire stale rules
```

### Workflow

1. Run `/learn` — mines claude-mem observations for gotchas, decisions, lessons, and patterns
2. Review candidates — accept or reject each one
3. Approved rules are written to a `## Learned Rules (claude-learner)` section in CLAUDE.md
4. Next session — Claude reads CLAUDE.md and follows the rules

### What It Mines

| Category | Source | Confidence |
|----------|--------|------------|
| Gotchas | Observations tagged with `gotcha` concept | 0.8 |
| Decisions | Observations tagged with `decision` concept | 0.6 |
| Learned | `learned` field from session summaries | 0.5 |
| Patterns | Files changed 2+ times across observations | 0.4 |

## How It Works

- Reads claude-mem's SQLite database (`~/.claude-mem/claude-mem.db`) in **read-only** mode
- Stores rule candidates in its own database (`~/.claude-learner/learner.db`)
- Writes approved rules to CLAUDE.md between marker comments — existing content is preserved
- No hooks, no background processes, no API calls — everything is user-triggered

## File Structure

```
claude-learner/
├── .claude-plugin/plugin.json     # Plugin manifest
├── hooks/hooks.json               # Empty — no background hooks
├── scripts/
│   ├── shared/db.js               # Database layer
│   └── mine-rules.js              # All logic in one script
├── skills/
│   └── learn/SKILL.md             # /learn skill
└── package.json
```
