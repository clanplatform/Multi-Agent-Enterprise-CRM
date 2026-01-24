CREATE TABLE IF NOT EXISTS agent_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  agent_id text NOT NULL,
  action_type text NOT NULL,
  risk_level text NOT NULL,
  status text NOT NULL,
  confidence numeric(4, 3),
  input_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_tenant_time ON agent_decisions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_tenant_agent_time ON agent_decisions (tenant_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_tenant_approval ON agent_decisions (tenant_id, approval_id);

