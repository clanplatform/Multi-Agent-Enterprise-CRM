"""
Agent Router

Routes incoming events to the appropriate agent based on event type.
"""

import json
from typing import Dict, Callable, Any
import structlog
from aiokafka import AIOKafkaProducer

from agents.sales import SalesAgent
from agents.support import SupportAgent
from agents.compliance import ComplianceAgent
from agents.analytics import AnalyticsAgent
from governance.guard import GovernanceBlocked, GovernanceGuard
from governance.approval_service import ApprovalService
from governance.data_guard import DataGuard, DataGovernanceBlocked
from governance.explainability import ExplainabilityEngine
from governance.kill_switch import AgentKillSwitch
from .config import settings

logger = structlog.get_logger()


class AgentRouter:
    """Routes events to appropriate agents."""
    
    def __init__(self):
        self.producer: AIOKafkaProducer = None
        self.sales_agent = SalesAgent()
        self.support_agent = SupportAgent()
        self.compliance_agent = ComplianceAgent()
        self.analytics_agent = AnalyticsAgent()
        self.kill_switch = AgentKillSwitch(settings.REDIS_URL)
        self.guard = GovernanceGuard(self.kill_switch)
        self.approval_service = ApprovalService(settings.REDIS_URL)
        self.explainability = ExplainabilityEngine(settings.DATABASE_URL)
        self.data_guard = DataGuard(settings.DATABASE_URL)
        
        # Topic to agent mapping
        self.routes: Dict[str, Callable] = {
            "crm.leads.created": self._handle_lead_created,
            "crm.leads.updated": self._handle_lead_updated,
            "crm.deals.created": self._handle_deal_created,
            "crm.deals.stage-changed": self._handle_deal_stage_changed,
            "crm.tickets.created": self._handle_ticket_created,
            "crm.tickets.updated": self._handle_ticket_updated,
            "crm.approvals.decision": self._handle_approval_decision,
        }
        
    async def initialize(self, producer: AIOKafkaProducer):
        """Initialize the router with dependencies."""
        self.producer = producer
        await self.sales_agent.initialize(producer)
        await self.support_agent.initialize(producer)
        await self.compliance_agent.initialize(producer)
        await self.analytics_agent.initialize(producer)
        await self.kill_switch.start()
        await self.approval_service.start()
        await self.explainability.start()
        await self.data_guard.start()
        self.sales_agent.set_governance_guard(self.guard)
        self.support_agent.set_governance_guard(self.guard)
        self.compliance_agent.set_governance_guard(self.guard)
        self.analytics_agent.set_governance_guard(self.guard)
        self.sales_agent.set_data_guard(self.data_guard)
        self.support_agent.set_data_guard(self.data_guard)
        self.compliance_agent.set_data_guard(self.data_guard)
        self.analytics_agent.set_data_guard(self.data_guard)
        self.sales_agent.set_approval_service(self.approval_service)
        self.support_agent.set_approval_service(self.approval_service)
        self.compliance_agent.set_approval_service(self.approval_service)
        self.analytics_agent.set_approval_service(self.approval_service)
        self.sales_agent.set_explainability_engine(self.explainability)
        self.support_agent.set_explainability_engine(self.explainability)
        self.compliance_agent.set_explainability_engine(self.explainability)
        self.analytics_agent.set_explainability_engine(self.explainability)
        logger.info("Agent router initialized")
        
    async def route(self, topic: str, message: str):
        """Route a message to the appropriate handler."""
        handler = self.routes.get(topic)
        
        if not handler:
            logger.warning("No handler for topic", topic=topic)
            return
            
        try:
            event = json.loads(message)
            await handler(event)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON message", topic=topic, error=str(e))
            
    async def _handle_lead_created(self, event: Dict[str, Any]):
        """Handle new lead - trigger qualification."""
        logger.info("Routing lead.created to Sales Agent", lead_id=event.get("data", {}).get("leadId"))

        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.leads.created")
            return

        if await _blocked_data(self.data_guard, tenant_id, self.sales_agent.agent_id, event):
            return
        
        # Sales agent qualifies the lead
        if await _blocked(self.guard, tenant_id, self.sales_agent.agent_id):
            return
        await self.sales_agent.qualify_lead(event)
        
        # Compliance agent validates the lead data
        if await _blocked(self.guard, tenant_id, self.compliance_agent.agent_id):
            return
        await self.compliance_agent.validate_data(event, entity_type="lead")
        
    async def _handle_lead_updated(self, event: Dict[str, Any]):
        """Handle lead update - re-score if needed."""
        data = event.get("data", {})
        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.leads.updated")
            return

        if await _blocked_data(self.data_guard, tenant_id, self.analytics_agent.agent_id, event):
            return
        
        # If status changed, analytics might care
        if data.get("previousStatus") != data.get("newStatus"):
            if await _blocked(self.guard, tenant_id, self.analytics_agent.agent_id):
                return
            await self.analytics_agent.track_lead_progression(event)
            
    async def _handle_deal_created(self, event: Dict[str, Any]):
        """Handle new deal - analyze and provide insights."""
        logger.info("Routing deal.created to Sales Agent", deal_id=event.get("data", {}).get("dealId"))
        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.deals.created")
            return

        if await _blocked_data(self.data_guard, tenant_id, self.sales_agent.agent_id, event):
            return
        
        if await _blocked(self.guard, tenant_id, self.sales_agent.agent_id):
            return
        await self.sales_agent.analyze_deal(event)
        if await _blocked(self.guard, tenant_id, self.compliance_agent.agent_id):
            return
        await self.compliance_agent.validate_data(event, entity_type="deal")
        
    async def _handle_deal_stage_changed(self, event: Dict[str, Any]):
        """Handle deal stage change - provide recommendations."""
        data = event.get("data", {})
        logger.info(
            "Routing deal.stage-changed",
            deal_id=data.get("dealId"),
            old_stage=data.get("previousStage"),
            new_stage=data.get("newStage"),
        )
        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.deals.stage-changed")
            return

        if await _blocked_data(self.data_guard, tenant_id, self.sales_agent.agent_id, event):
            return
        
        # Sales agent provides next-best-action
        if await _blocked(self.guard, tenant_id, self.sales_agent.agent_id):
            return
        await self.sales_agent.recommend_next_action(event)
        
        # Analytics tracks pipeline metrics
        if await _blocked(self.guard, tenant_id, self.analytics_agent.agent_id):
            return
        await self.analytics_agent.track_pipeline_movement(event)
        
    async def _handle_ticket_created(self, event: Dict[str, Any]):
        """Handle new ticket - triage and suggest resolution."""
        logger.info("Routing ticket.created to Support Agent", ticket_id=event.get("data", {}).get("ticketId"))
        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.tickets.created")
            return

        if await _blocked_data(self.data_guard, tenant_id, self.support_agent.agent_id, event):
            return
        
        # Support agent triages and suggests resolution
        if await _blocked(self.guard, tenant_id, self.support_agent.agent_id):
            return
        await self.support_agent.triage_ticket(event)
        
        # Compliance validates (e.g., PII detection)
        if await _blocked(self.guard, tenant_id, self.compliance_agent.agent_id):
            return
        await self.compliance_agent.validate_data(event, entity_type="ticket")
        
    async def _handle_ticket_updated(self, event: Dict[str, Any]):
        """Handle ticket update."""
        tenant_id = _tenant_id(event)
        if not tenant_id:
            logger.error("Missing tenant id on event", topic="crm.tickets.updated")
            return
        if await _blocked_data(self.data_guard, tenant_id, self.analytics_agent.agent_id, event):
            return
        if await _blocked(self.guard, tenant_id, self.analytics_agent.agent_id):
            return
        await self.analytics_agent.track_ticket_metrics(event)
        
    async def _handle_approval_decision(self, event: Dict[str, Any]):
        """Handle approval decision - execute or cancel pending action."""
        data = event.get("data", {})
        decision = data.get("decision")
        approval_id = data.get("approvalId")
        tenant_id = _tenant_id(event)
        
        logger.info(
            "Handling approval decision",
            approval_id=approval_id,
            decision=decision,
        )

        if not approval_id or not tenant_id:
            return

        pending = await self.approval_service.pop_pending(str(approval_id))
        if not pending:
            return

        if pending.tenant_id != tenant_id:
            return

        if decision != "approved":
            return

        agent = {
            self.sales_agent.agent_id: self.sales_agent,
            self.support_agent.agent_id: self.support_agent,
            self.compliance_agent.agent_id: self.compliance_agent,
            self.analytics_agent.agent_id: self.analytics_agent,
        }.get(pending.agent_id)

        if not agent:
            return

        if await _blocked_data(self.data_guard, tenant_id, agent.agent_id, pending.data):
            return

        if await _blocked(self.guard, tenant_id, agent.agent_id):
            return

        await agent.emit_event(
            topic=pending.topic,
            event_type=pending.event_type,
            tenant_id=pending.tenant_id,
            data=pending.data,
            correlation_id=pending.correlation_id or event.get("correlationid"),
        )


async def _blocked_data(guard: DataGuard, tenant_id: str, agent_id: str, event: Dict[str, Any]) -> bool:
    customer_id, user_id = _extract_subjects(event)
    if not customer_id and not user_id:
        return False
    try:
        await guard.ensure_allowed(tenant_id=tenant_id, agent_id=agent_id, customer_id=customer_id, user_id=user_id)
        return False
    except DataGovernanceBlocked as e:
        logger.warning("Data governance blocked agent execution", tenant_id=tenant_id, agent_id=agent_id, reason=e.block.reason)
        return True


def _extract_subjects(event: Dict[str, Any]) -> tuple[str | None, str | None]:
    data = event.get("data", event)
    customer_id = data.get("customerId") or data.get("customer_id")
    user_id = data.get("userId") or data.get("user_id") or data.get("createdBy") or data.get("assignedTo")
    return (str(customer_id) if customer_id else None, str(user_id) if user_id else None)


def _tenant_id(event: Dict[str, Any]) -> str | None:
    tenant = event.get("tenantid") or event.get("tenantId")
    if tenant:
        return str(tenant)
    data = event.get("data", {})
    tenant = data.get("tenantId") or data.get("tenantid")
    return str(tenant) if tenant else None


async def _blocked(guard: GovernanceGuard, tenant_id: str, agent_id: str) -> bool:
    try:
        await guard.ensure_allowed(tenant_id=tenant_id, agent_id=agent_id)
        return False
    except GovernanceBlocked as e:
        decision = e.block.kill_switch
        logger.warning(
            "Governance blocked execution",
            tenant_id=tenant_id,
            agent_id=agent_id,
            reason=e.block.reason,
            scope_key=decision.scope_key if decision else None,
            state=decision.status.state.value if decision and decision.status else None,
        )
        return True
