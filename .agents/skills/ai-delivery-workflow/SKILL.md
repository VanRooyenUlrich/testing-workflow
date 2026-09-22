---
name: ai-delivery-workflow
description: Use the repository's governed AI delivery lifecycle, isolated sessions, fixed validation commands, independent review, and evidence trail. Use when planning, implementing, validating, reviewing, or promoting changes in a repository configured with .ai-delivery governance.
---

# AI Delivery Workflow

Treat `.ai-delivery/projects.json` and each application's `.ai-delivery/governance.json` as authoritative. Do not edit governance, provider hooks, session records, or evidence as part of ordinary feature work.

1. Read the repository `AGENTS.md`, project governance, and the work item before acting.
2. Create or resume the work item with the smallest accurate risk profile. A human must confirm specification, plan, architecture, risk reduction, high-risk review, and promotion when the workflow requires it.
3. Start the provider through `ai-delivery session start`. Use only the generated session configuration and advertised `ai-delivery` MCP tools.
4. Read within the governed project. Mutate only accepted affected paths through optimistic MCP create, replace, and delete operations. Use only command IDs declared by project governance.
5. Stop when policy is unavailable, state is stale, drift is detected, or a capability is absent. Report the exact denial; do not bypass it with native tools.
6. Validate the candidate, create a separate read-only review session, and require the configured checks. HIGH_RISK work requires policy validation and independent human review.
7. Preview the exact promotion hash. Apply it only after the matching interactive confirmation, then verify the append-only evidence chain.

Use `ai-delivery help` for command syntax. Keep application-specific build and architecture rules in that application's `AGENTS.md`; this skill only defines the shared delivery protocol.
