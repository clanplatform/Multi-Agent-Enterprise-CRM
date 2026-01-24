# Approval Workflow Governance Policy
package enterprise_crm.governance.approval

default decision = {
  "requires_approval": false,
  "levels": [],
  "ttl_seconds": 86400,
  "escalate_after_seconds": 1800,
  "delegation_allowed": true,
}

decision = out {
  requires := requires_approval
  out := {
    "requires_approval": requires,
    "levels": approval_levels,
    "ttl_seconds": ttl_seconds,
    "escalate_after_seconds": escalate_after_seconds,
    "delegation_allowed": delegation_allowed,
  }
}

default requires_approval = false

requires_approval {
  input.risk_level == "HIGH"
}

requires_approval {
  input.action_type == "customers:delete"
}

default approval_levels = []
approval_levels = [{"role": "admin", "min_count": 1}] {
  requires_approval
}

default ttl_seconds = 86400
ttl_seconds = 3600 {
  input.risk_level == "HIGH"
}

default escalate_after_seconds = 1800
escalate_after_seconds = 900 {
  input.risk_level == "HIGH"
}

default delegation_allowed = true
delegation_allowed = false {
  input.action_type == "customers:delete"
}

