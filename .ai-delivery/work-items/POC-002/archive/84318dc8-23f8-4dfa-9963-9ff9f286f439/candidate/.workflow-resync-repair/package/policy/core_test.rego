package ai_delivery_test

import rego.v1
import data.ai_delivery

base := {"schemaVersion": 1, "action": "file.read", "fresh": true, "suspended": false, "coreAllow": true, "projectAllow": true, "workItemAllow": true, "stageAllow": true, "riskAllow": true, "confirmationRequired": false}

test_allow if { ai_delivery.decision.decision == "ALLOW" with input as base }
test_core_deny_wins if { ai_delivery.decision.decision == "DENY" with input as object.union(base, {"coreAllow": false, "projectAllow": true}) }
test_project_deny if { ai_delivery.decision.decision == "DENY" with input as object.union(base, {"projectAllow": false}) }
test_stale if { ai_delivery.decision.decision == "DENY" with input as object.union(base, {"fresh": false}) }
test_suspended if { ai_delivery.decision.decision == "DENY" with input as object.union(base, {"suspended": true}) }
test_ask if { ai_delivery.decision.decision == "ASK" with input as object.union(base, {"confirmationRequired": true}) }
test_unknown_action if { ai_delivery.decision.decision == "DENY" with input as object.union(base, {"action": "shell.arbitrary"}) }
test_invalid_schema if { ai_delivery.decision.decision == "DENY" with input as {} }
