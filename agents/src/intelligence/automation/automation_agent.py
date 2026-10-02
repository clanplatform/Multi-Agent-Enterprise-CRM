from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog
from langchain_ollama import ChatOllama
from opentelemetry import trace

from orchestrator.config import settings

from .graph import AutomationDeps, AutomationState, build_automation_graph


logger = structlog.get_logger()
tracer = trace.get_tracer(__name__)


@dataclass
class AutomationParseResponse:
    trigger_type: str
    workflow: dict[str, Any]
    compiled: dict[str, Any]
    warnings: list[str]


class AutomationAgent:
    def __init__(self):
        self._llm = ChatOllama(base_url=settings.OLLAMA_URL, model=settings.OLLAMA_MODEL, temperature=0)
        self._graph = build_automation_graph(deps=AutomationDeps(llm=self._llm))

    async def parse(self, *, tenant_id: str, user_id: str, roles: list[str], nl_rule_text: str) -> dict[str, Any]:
        with tracer.start_as_current_span("rule_parse") as span:
            span.set_attribute("tenant_id", tenant_id)
            span.set_attribute("user_id", user_id)
            span.set_attribute("rule_len", len(nl_rule_text or ""))

            state = AutomationState(nl_rule_text=nl_rule_text)
            out: Any = await self._graph.ainvoke(state)

            # LangGraph returns the final state as a MAPPING in current versions.
            # This code was written against the <0.1 line, where ainvoke handed
            # back the state object itself -- hence "'dict' object has no
            # attribute 'workflow'". requirements.txt only pins langgraph>=0.0.50,
            # so the installed version drifted past that behaviour. Read both.
            def _field(key: str) -> Any:
                if isinstance(out, dict):
                    return out.get(key)
                return getattr(out, key, None)

            raw_workflow = _field("workflow")
            raw_compiled = _field("compiled")

            if raw_workflow is None:
                workflow = {"trigger": "customer_updated", "conditions": [], "actions": []}
            elif isinstance(raw_workflow, dict):
                workflow = raw_workflow
            else:
                workflow = raw_workflow.model_dump()

            if raw_compiled is None:
                compiled = {"trigger_type": "customer_updated", "trigger_topics": [], "conditions": [], "actions": [], "warnings": ["missing_compiled"]}
            elif isinstance(raw_compiled, dict):
                compiled = raw_compiled
            else:
                compiled = raw_compiled.to_dict()

            warnings = _field("warnings") or []
            return AutomationParseResponse(
                trigger_type=str(compiled.get("trigger_type") or workflow.get("trigger") or "customer_updated"),
                workflow=workflow,
                compiled=compiled,
                warnings=warnings,
            ).__dict__

