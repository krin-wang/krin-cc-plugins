# krin-cc-plugins

Personal Claude Code plugins and skills.

## Plugins

| Plugin | Description |
|--------|-------------|
| [claude-learner](./claude-learner/) | Mines claude-mem observations for patterns and writes learned rules to CLAUDE.md |

## Setup

Each plugin is a standalone directory with its own `.claude-plugin/plugin.json`. To use a plugin:

```bash
# Install dependencies (if any)
cd <plugin-name> && npm install

# Register in Claude Code
/install-local /path/to/krin-cc-plugins/<plugin-name>
```
