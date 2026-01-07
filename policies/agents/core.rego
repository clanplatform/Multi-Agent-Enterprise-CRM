# AI Agent Core Governance Policy
package enterprise_crm.agents

# Agent capability definitions
agent_capabilities = {
    "sales-agent": [
        "leads:qualify", "leads:score", "leads:analyze",
        "deals:analyze", "deals:recommend"
    ],
    "support-agent": [
        "tickets:triage", "tickets:categorize", "tickets:suggest_resolution"
    ],
    "compliance-agent": [
        "audit:validate", "policy:check", "risk:assess"
    ],
    "analytics-agent": [
        "reports:generate", "trends:analyze", "anomalies:detect"
    ]
}

default allow = false

# Allow if agent has capability
allow {
    caps := agent_capabilities[input.agent.type]
    caps[_] == input.action
}

# Check if approval required
default requires_approval = false

requires_approval {
    input.confidence < 0.7
}

requires_approval {
    input.action == "deals:close"
    input.context.amount > 50000
}
