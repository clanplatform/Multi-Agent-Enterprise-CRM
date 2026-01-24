# Human-in-Loop Approval Policy
package enterprise_crm.agents.approval

# Thresholds
amount_threshold = 50000
confidence_threshold = 0.85

default requires_approval = false
default ttl_seconds = 86400
default escalate_after_seconds = 1800
default delegation_allowed = true
default approval_levels = [{"role": "admin", "min_count": 1}]

# Large deal closures require approval
requires_approval {
    input.action == "deals:close"
    input.context.amount > amount_threshold
}

# Low confidence decisions require approval  
requires_approval {
    input.confidence < confidence_threshold
}

# Customer deletion requires approval
requires_approval {
    input.action == "customers:delete"
}

# Default priority
default priority = "normal"

priority = "critical" {
    input.context.amount > 100000
}

priority = "high" {
    input.context.amount > 50000
    input.context.amount <= 100000
}

# Default approvers
default approvers = ["admin"]

approvers = ["admin", "sales_manager"] {
    startswith(input.action, "deals:")
}

approvers = ["admin", "support_manager"] {
    startswith(input.action, "tickets:")
}

approval_levels = [{"role": "sales_manager", "min_count": 1}, {"role": "admin", "min_count": 1}] {
    startswith(input.action, "deals:")
    input.context.amount > 50000
}

approval_levels = [{"role": "support_manager", "min_count": 1}, {"role": "admin", "min_count": 1}] {
    startswith(input.action, "tickets:")
    input.context.urgency == "critical"
}

ttl_seconds = 3600 {
    priority == "critical"
}

escalate_after_seconds = 900 {
    priority == "critical"
}
