# Tenant Isolation Policy
package enterprise_crm.tenant

default allow = false

# Allow tenant access
allow {
    input.user.tenant_id == input.resource.tenant_id
}

# Super admin can access all tenants  
allow {
    input.user.roles[_] == "super_admin"
}
