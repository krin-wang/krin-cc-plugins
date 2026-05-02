# krin-cc-plugins

Personal Claude Code plugins and skills.

## Plugins

| Plugin | Description |
|--------|-------------|
| [claude-learner](./claude-learner/) | Mines claude-mem observations for patterns and writes learned rules to CLAUDE.md |

## Install

In Claude Code, add the marketplace then install the plugin:

```
/plugin marketplace add krin-wang/krin-cc-plugins
/plugin install claude-learner@krin-cc-plugins
```

Or use `/plugin` to browse available plugins interactively.

## Development

For local development, load a plugin directly:

```bash
claude --plugin-dir /path/to/krin-cc-plugins/<plugin-name>
```

Use `/reload-plugins` inside a session to pick up changes.
