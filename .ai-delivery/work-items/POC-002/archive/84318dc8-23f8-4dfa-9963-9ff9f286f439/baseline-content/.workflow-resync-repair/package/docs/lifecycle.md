# Lifecycle

Every risk profile uses the same state machine:

```text
DISCOVERING -> SPEC_DRAFT -> SPEC_ACCEPTED -> PLANNING -> PLAN_APPROVED
  -> IMPLEMENTING -> VALIDATING -> READY_FOR_REVIEW -> COMPLETE
                         |
                         +-- CHANGES_REQUESTED -> IMPLEMENTING
```

Profiles change the depth of artifacts, isolation, confirmations, validation, and review. They never rename or skip lifecycle states.

## Phases

| State | Required result | Normal next action |
| --- | --- | --- |
| `DISCOVERING` | Discovery artifact describing the problem and constraints | Submit discovery |
| `SPEC_DRAFT` | Specification bound to the intended behavior | Submit and, when required, accept the specification |
| `SPEC_ACCEPTED` | Accepted specification ready for planning | Submit the plan |
| `PLANNING` | Implementation and validation plan | Approve the plan |
| `PLAN_APPROVED` | Approved work ready for a governed session | Start an implementation session |
| `IMPLEMENTING` | Candidate plus a current candidate-bound handoff | Run validation |
| `VALIDATING` | Current execution receipts and an independent review decision | Record the review |
| `READY_FOR_REVIEW` | Approved review already recorded; delivery remains | Promote when required, then complete |
| `COMPLETE` | Reviewed candidate delivered and human-confirmed | No further workflow mutation |

`READY_FOR_REVIEW` is retained for compatibility. The independent review is recorded during the transition into this state.

## Profiles

| Profile | Workspace | Typical use | Required gates |
| --- | --- | --- | --- |
| `LIGHTWEIGHT` | Governed host workspace | Documentation, isolated tests, small fixes, behavior-preserving refactors | Handoff, validation, independent review, completion confirmation |
| `STANDARD` | Isolated source copy | Ordinary product work | Specification and plan approval, handoff, validation, independent review, promotion, completion |
| `HIGH_RISK` | Digest-pinned isolated environment | Credentials, authorization, restricted data, migrations, governance/security changes | Architecture approval, offline validation, independent human review, promotion, completion |

The risk classifier establishes a minimum profile and records its reasons. New paths, dependencies, commands, network access, database migrations, authorization changes, credential handling, and architecture changes must be reassessed. Escalation invalidates affected approvals and evidence and can move work back to an earlier state.

## Candidate handoff

Before validation, the implementation provider calls the `handoff_submit` MCP tool. The controller stores `handoff.md` in the session control directory with hashes for:

- handoff content,
- candidate snapshot,
- governance,
- capability manifest,
- submission time.

Any candidate mutation invalidates and removes the active handoff. Validation, review creation, review submission, review recording, and completion verify the current binding. Historical session records remain readable even when they predate these optional schema fields, but new work must submit a fresh handoff.

## Validation and review

Validation runs only declared command IDs and the final diff check. Receipts bind command definitions, output, logs, session, candidate snapshot, governance, and capability manifest.

Review runs in a separate session over a read-only candidate. The reviewer receives the implementation handoff and submits findings plus `APPROVED` or `CHANGES_REQUESTED`. The confirmation hash binds both sessions, the candidate, governance, manifest, findings, handoff, and decision.

An approved review moves the item to `READY_FOR_REVIEW`. `CHANGES_REQUESTED` is the only review revision path: it returns the item to `IMPLEMENTING`, creates a new session epoch, and marks prior validation and review evidence stale.

## Invalidations

The controller fails closed when any bound input changes:

- Specification, plan, or architecture changes stale their confirmations.
- Candidate changes invalidate the handoff, validation, and review.
- Governance, registry, or capability changes stale the session.
- A replacement session revokes the previous epoch.
- Unexpected host or workspace changes suspend work until resynchronization.

Use `work next --id ID` after every phase. It calculates the next command without changing or revoking session state.
