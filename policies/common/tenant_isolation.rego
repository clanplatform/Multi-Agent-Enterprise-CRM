package enterprise_crm.tenant_isolation

default allow = false

allow_same_tenant {
  input.tenant_id != ""
  input.resource.tenant_id != ""
  input.tenant_id == input.resource.tenant_id
}

deny_cross_tenant {
  input.tenant_id != ""
  input.resource.tenant_id != ""
  input.tenant_id != input.resource.tenant_id
}

allow_super_admin_cross_tenant {
  input.user.roles[_] == "super_admin"
  endswith(input.action, ":read")
  input.tenant_id != ""
  input.resource.tenant_id != ""
}

allow {
  allow_same_tenant
}

allow {
  allow_super_admin_cross_tenant
}

deny[msg] {
  input.tenant_id == "" 
  msg := "MISSING_SUBJECT_TENANT"
}

deny[msg] {
  input.resource.tenant_id == "" 
  msg := "MISSING_RESOURCE_TENANT"
}

deny[msg] {
  not allow
  input.tenant_id != ""
  input.resource.tenant_id != ""
  msg := "CROSS_TENANT_DENY"
}

