"""
Agent Router

Routes incoming events to the appropriate agent based on event type.
"""

import json
from typing import Dict, Callable, Any
import structlog
from aiokafka import AIOKafkaProducer

from ..agents.sales import SalesAgent
from ..agents.support import SupportAgent
from ..agents.compliance import ComplianceAgent
from ..agents.analytics import AnalyticsAgent

logger = structlog.get_logger()


class AgentRouter:
    """Routes events to appropriate agents."""
    
    def __init__(self):
        self.producer: AIOKafkaProducer = None
        self.sales_agent = SalesAgent()
        self.support_agent = SupportAgent()
        self.compliance_agent = ComplianceAgent()
        self.analytics_agent = AnalyticsAgent()
        
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
        
        # Sales agent qualifies the lead
        await self.sales_agent.qualify_lead(event)
        
        # Compliance agent validates the lead data
        await self.compliance_agent.validate_data(event, entity_type="lead")
        
    async def _handle_lead_updated(self, event: Dict[str, Any]):
        """Handle lead update - re-score if needed."""
        data = event.get("data", {})
        
        # If status changed, analytics might care
        if data.get("previousStatus") != data.get("newStatus"):
            await self.analytics_agent.track_lead_progression(event)
            
    async def _handle_deal_created(self, event: Dict[str, Any]):
        """Handle new deal - analyze and provide insights."""
        logger.info("Routing deal.created to Sales Agent", deal_id=event.get("data", {}).get("dealId"))
        
        await self.sales_agent.analyze_deal(event)
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
        
        # Sales agent provides next-best-action
        await self.sales_agent.recommend_next_action(event)
        
        # Analytics tracks pipeline metrics
        await self.analytics_agent.track_pipeline_movement(event)
        
    async def _handle_ticket_created(self, event: Dict[str, Any]):
        """Handle new ticket - triage and suggest resolution."""
        logger.info("Routing ticket.created to Support Agent", ticket_id=event.get("data", {}).get("ticketId"))
        
        # Support agent triages and suggests resolution
        await self.support_agent.triage_ticket(event)
        
        # Compliance validates (e.g., PII detection)
        await self.compliance_agent.validate_data(event, entity_type="ticket")
        
    async def _handle_ticket_updated(self, event: Dict[str, Any]):
        """Handle ticket update."""
        await self.analytics_agent.track_ticket_metrics(event)
        
    async def _handle_approval_decision(self, event: Dict[str, Any]):
        """Handle approval decision - execute or cancel pending action."""
        data = event.get("data", {})
        decision = data.get("decision")
        
        logger.info(
            "Handling approval decision",
            approval_id=data.get("approvalId"),
            decision=decision,
        )
        
        if decision == "approved":
            # Notify the requesting agent that action can proceed
            # The agent will pick this up and complete its task
            pass
        elif decision == "rejected":
            # Log the rejection and cleanup
            pass
