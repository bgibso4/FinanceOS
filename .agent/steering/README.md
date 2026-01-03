---
# Steering Configuration for FinanceOS
# This file tells AI assistants which steering documents to include in their context
---

# Steering Documents

This directory contains steering documents that provide AI assistants with project context.

## Active Steering Files

- **project-context.md** - Comprehensive FinanceOS project documentation including architecture decisions, tech stack, database schema, and development patterns. Always included in AI context.

## Usage

Steering files use YAML frontmatter to control when they're included:

```yaml
---
inclusion: always
---
```

Options:
- `always` - Include in every AI interaction
- `on-request` - Only include when specifically requested
- `disabled` - Don't include (archived)
