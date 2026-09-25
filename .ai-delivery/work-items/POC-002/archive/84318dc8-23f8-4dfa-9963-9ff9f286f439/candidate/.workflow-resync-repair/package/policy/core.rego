package ai_delivery

import rego.v1

default decision := {"decision": "DENY", "reason": "CORE_OR_LOCAL_DENY"}

eligible if {
    input.schemaVersion == 1
    input.action in {"file.read", "file.write", "file.delete", "command.execute", "network.access", "mcp.invoke", "tool.invoke", "governance.change", "promotion.apply", "workflow.submit", "validation.execute"}
    input.fresh == true
    input.suspended == false
    input.coreAllow == true
    input.projectAllow == true
    input.workItemAllow == true
    input.stageAllow == true
    input.riskAllow == true
}

decision := {"decision": "ALLOW", "reason": "ALL_LAYERS_ALLOW"} if {
    eligible
    input.confirmationRequired == false
}

decision := {"decision": "ASK", "reason": "HUMAN_CONFIRMATION_REQUIRED"} if {
    eligible
    input.confirmationRequired == true
}
