<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Project AI Knowledge Rule (Mandatory)

Every AI agent must update `AI_KNOWLEDGE_LOG.md` on each meaningful activity, including:
- analysis/investigation
- file changes
- dependency install/update
- bug fix decisions
- architecture or implementation decisions

Update policy:
- append-only (never delete prior history)
- include local timestamp (UTC+7)
- include task, action, impacted files, result, and next step
<!-- END:nextjs-agent-rules -->
