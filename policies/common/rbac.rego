# Role-Based Access Control Policy
package enterprise_crm.rbac

# Role definitions with permissions
role_permissions = {
    "admin": ["*"],
    "sales_manager": [
        "leads:read", "leads:write", "leads:delete", "leads:assign",
        "deals:read", "deals:write", "deals:delete", "deals:assign",
        "customers:read", "customers:write"
    ],
    "sales_rep": [
        "leads:read", "leads:write",
        "deals:read", "deals:write",
        "customers:read"
    ],
    "support_manager": [
        "tickets:read", "tickets:write", "tickets:delete", "tickets:assign",
        "customers:read", "customers:write"
    ],
    "support_agent": [
        "tickets:read", "tickets:write",
        "customers:read"
    ],
    "analyst": [
        "leads:read", "deals:read", "tickets:read", "customers:read",
        "aggregates:read", "replay:read", "replay:write"
    ],
    "viewer": [
        "leads:read", "deals:read", "tickets:read", "customers:read",
        "aggregates:read", "replay:read"
    ]
}

default allow = false

# Allow if admin
allow {
    input.user.roles[_] == "admin"
}

# Allow if role has permission
allow {
    role := input.user.roles[_]
    perms := role_permissions[role]
    perms[_] == input.action
}
