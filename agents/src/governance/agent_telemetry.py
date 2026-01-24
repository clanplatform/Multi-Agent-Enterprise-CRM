from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest


@dataclass(frozen=True)
class MetricsResponse:
    body: bytes
    content_type: str


decision_latency_ms = Histogram(
    "agent_decision_latency_ms",
    "Time spent producing a decision or action",
    labelnames=("agent_id", "action_type", "risk_level", "status"),
    buckets=(10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000),
)

tool_call_count = Counter(
    "agent_tool_call_count_total",
    "Number of tool calls executed by agents",
    labelnames=("agent_id", "tool_name"),
)

error_rate = Counter(
    "agent_error_total",
    "Agent errors",
    labelnames=("agent_id", "error_type"),
)

approval_denied_rate = Counter(
    "agent_approval_denied_total",
    "Approvals denied for agent actions",
    labelnames=("agent_id", "action_type"),
)

approval_required_total = Counter(
    "agent_approval_required_total",
    "Approvals required for agent actions",
    labelnames=("agent_id", "action_type"),
)

action_rollback_count = Counter(
    "agent_action_rollback_total",
    "Rollback requests issued for agent actions",
    labelnames=("agent_id", "action_type"),
)

policy_violation_flags = Counter(
    "agent_policy_violations_total",
    "OPA policy violations (denied actions)",
    labelnames=("agent_id", "action_type"),
)

kill_switch_activations = Counter(
    "agent_kill_switch_activations_total",
    "Kill switch blocks triggered",
    labelnames=("scope",),
)

data_governance_violations = Counter(
    "agent_data_governance_violations_total",
    "Agent data governance violations (deleted or forbidden subject access)",
    labelnames=("agent_id", "violation", "subject_type"),
)

agents_running = Gauge(
    "agent_runtime_running",
    "Agent runtime running state",
)


def observe_decision_latency(*, agent_id: str, action_type: str, risk_level: str, status: str, duration_ms: float) -> None:
    decision_latency_ms.labels(agent_id=agent_id, action_type=action_type, risk_level=risk_level, status=status).observe(duration_ms)


def inc_tool_call(*, agent_id: str, tool_name: str) -> None:
    tool_call_count.labels(agent_id=agent_id, tool_name=tool_name).inc()


def inc_error(*, agent_id: str, error_type: str) -> None:
    error_rate.labels(agent_id=agent_id, error_type=error_type).inc()


def inc_approval_required(*, agent_id: str, action_type: str) -> None:
    approval_required_total.labels(agent_id=agent_id, action_type=action_type).inc()


def inc_approval_denied(*, agent_id: str, action_type: str) -> None:
    approval_denied_rate.labels(agent_id=agent_id, action_type=action_type).inc()


def inc_policy_violation(*, agent_id: str, action_type: str) -> None:
    policy_violation_flags.labels(agent_id=agent_id, action_type=action_type).inc()


def inc_kill_switch_block(*, scope: Optional[str]) -> None:
    kill_switch_activations.labels(scope=scope or "unknown").inc()


def inc_data_governance_violation(*, agent_id: str, violation: str, subject_type: str) -> None:
    data_governance_violations.labels(agent_id=agent_id, violation=violation, subject_type=subject_type).inc()


def metrics_response() -> MetricsResponse:
    return MetricsResponse(body=generate_latest(), content_type=CONTENT_TYPE_LATEST)
