#!/usr/bin/env bash
# One-command setup: clone -> running app.
#
#   ./scripts/bootstrap.sh            # full stack incl. AI agents + Ollama models
#   ./scripts/bootstrap.sh --no-ai    # skip Ollama/agents (no ~5GB model pull)
#
# Safe to re-run: every step is idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_AI=1
[[ "${1:-}" == "--no-ai" ]] && WITH_AI=0

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
dc() { docker compose "$@"; }

# ---------------------------------------------------------------- env
say "Environment"
if [[ ! -f .env ]]; then cp .env.example .env; echo "created .env from .env.example"; else echo ".env already present"; fi
if [[ ! -f docker-compose.override.yml && -f docker-compose.override.yml.example ]]; then
  echo "note: no docker-compose.override.yml. If port 5432 is taken, or you have no"
  echo "      NVIDIA GPU, copy docker-compose.override.yml.example and edit it."
fi

# ---------------------------------------------- infrastructure first
say "Starting infrastructure (postgres, redis, kafka, opa)"
dc up -d postgres redis kafka opa

say "Waiting for postgres and kafka"
until dc exec -T postgres pg_isready -U crm_user -d enterprise_crm >/dev/null 2>&1; do sleep 2; done
echo "postgres ready"
until dc exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1; do sleep 3; done
echo "kafka ready"

# ------------------------------------------------------------ topics
# The gateway and agents subscribe on startup and exit on
# UNKNOWN_TOPIC_OR_PARTITION if a topic is auto-created mid-subscribe, so create
# them up front.
say "Creating Kafka topics"
TOPICS="
crm.agents.action-executed crm.agents.action-proposed crm.agents.anomaly-detected crm.agents.data-validated
crm.agents.deal-analyzed crm.agents.metric-recorded crm.agents.next-action-recommended crm.agents.reasoning
crm.agents.task-assigned crm.agents.ticket-triaged crm.analytics.prediction-generated crm.approvals.decision
crm.approvals.required crm.audit.accessed crm.audit.events crm.automation.action.requested crm.automation.executed
crm.automation.policy-created crm.automation.policy-updated crm.automation.simulation.requested
crm.automation.simulation.result crm.conversations.closed crm.customers.created crm.customers.updated
crm.deals.closed crm.deals.created crm.deals.stage-changed crm.deals.updated crm.dlq.agents crm.dlq.approvals
crm.dlq.leads crm.events crm.gdpr.forget crm.intelligence.agent-decision crm.intelligence.automation-parsed
crm.intelligence.chat-response crm.intelligence.dev-anomaly-detected crm.intelligence.dev-insight-generated
crm.intelligence.language-detected crm.intelligence.search-abandoned crm.intelligence.search-clicked
crm.intelligence.search-performed crm.intelligence.tool-called crm.intelligence.twin-profile-updated
crm.intelligence.twin-simulation-executed crm.intelligence.user-query crm.intelligence.voice-received
crm.journey.updated crm.killswitch.activated crm.knowledge.draft.created crm.knowledge.published
crm.leads.created crm.leads.events crm.leads.qualified crm.leads.updated crm.payments.recorded
crm.productivity.action-approved crm.productivity.action-rejected crm.productivity.action-suggested
crm.productivity.signal crm.security.events crm.security.risk-detected crm.tasks.updated crm.tickets.created
crm.tickets.escalate crm.tickets.events crm.tickets.resolved crm.tickets.sla-breached crm.tickets.updated
crm.user.activity
"
for t in $TOPICS; do
  dc exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
    --create --if-not-exists --topic "$t" --partitions 1 --replication-factor 1 >/dev/null 2>&1 || true
done
echo "topics: $(dc exec -T kafka kafka-topics --bootstrap-server localhost:9092 --list 2>/dev/null | grep -c '^crm\.')"

# -------------------------------------------------------- migrations
# The runner image installs production deps only, so it has no prisma CLI. The
# builder stage does.
say "Running database migrations"
docker build --target builder -t crm-gateway-builder ./gateway >/dev/null
NET="$(docker network ls --format '{{.Name}}' | grep crm-network | head -1)"
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql://crm_user:crm_password@postgres:5432/enterprise_crm" \
  crm-gateway-builder npx prisma migrate deploy

say "Applying row-level security policies"
# NOTE: the README points at /docker-entrypoint-initdb.d/02-rls-policies.sql,
# but only database/init is mounted there and it holds no such file. The real
# one lives in database/migrations and must run AFTER the migrations above.
dc exec -T postgres psql -U crm_user -d enterprise_crm -q < database/migrations/02-rls-policies.sql

# ------------------------------------------------------------ agents
say "Registering AI agents"
dc exec -T postgres psql -U crm_user -d enterprise_crm -q <<'SQL'
INSERT INTO ai_agents (id, name, type, description, capabilities, config, is_active, created_at, updated_at) VALUES
 (gen_random_uuid(),'Sales Agent','sales','Qualifies and scores leads, recommends next-best-action','["lead_qualification","lead_scoring","next_best_action"]','{"model":"llama3.1"}',true,now(),now()),
 (gen_random_uuid(),'Support Agent','support','Triages tickets, suggests KB articles, tracks SLA','["ticket_triage","kb_suggestion","sla_tracking"]','{"model":"llama3.1"}',true,now(),now()),
 (gen_random_uuid(),'Compliance Agent','compliance','Validates data handling policies and risk','["policy_validation","risk_assessment","audit_trail"]','{"model":"llama3.1"}',true,now(),now()),
 (gen_random_uuid(),'Analytics Agent','analytics','Detects trends and anomalies, generates insights','["trend_analysis","anomaly_detection","forecasting"]','{"model":"llama3.1"}',true,now(),now()),
 (gen_random_uuid(),'Knowledge Agent','knowledge','Drafts KB articles from resolved tickets','["draft_generation","summarization","semantic_search"]','{"model":"llama3.1"}',true,now(),now())
ON CONFLICT (name) DO NOTHING;
SQL
echo "ai_agents rows: $(dc exec -T postgres psql -U crm_user -d enterprise_crm -t -c 'select count(*) from ai_agents;' 2>/dev/null | tr -d ' \r')"

# --------------------------------------------------------- app + obs
say "Starting application and observability"
dc up -d gateway frontend kafka-ui prometheus grafana weaviate loki keycloak \
        postgres-exporter redis-exporter kafka-exporter

if [[ "$WITH_AI" == "1" ]]; then
  say "Starting Ollama and pulling models (llama3.1 ~4.9GB, first run is slow)"
  dc up -d ollama
  until curl -sf http://localhost:11434/ >/dev/null 2>&1; do sleep 3; done
  dc exec -T ollama ollama pull llama3.1
  dc exec -T ollama ollama pull nomic-embed-text   # embeddings for search/chat/KB
  dc up -d agents
else
  say "Skipping Ollama/agents (--no-ai). AI screens will be inactive."
fi

say "Waiting for the gateway"
until curl -sf http://localhost:4000/health >/dev/null 2>&1; do sleep 3; done

cat <<EOF

$(printf '\033[1;32mReady.\033[0m')

  Frontend     http://localhost:3000      <- sign in here
  API Gateway  http://localhost:4000/health
  Kafka UI     http://localhost:8080
  Grafana      http://localhost:3001      admin / admin
  Prometheus   http://localhost:9090
  Keycloak     http://localhost:8081      admin / admin
  Weaviate     http://localhost:8082
  Ollama       http://localhost:11434

  PostgreSQL   localhost:5432 (or 5433 if you overrode it)  crm_user / crm_password / enterprise_crm

The app has no seeded users. Create a tenant from the sign-in screen's API:

  curl -X POST http://localhost:4000/api/v1/auth/register \\
    -H "Content-Type: application/json" \\
    -d '{"tenantName":"Acme Corp","tenantSlug":"acme","email":"admin@acme.test","password":"SuperSecret123","name":"Acme Admin"}'

then sign in at http://localhost:3000/login with tenant "acme".
EOF
