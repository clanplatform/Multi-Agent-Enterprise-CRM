"""
Support Agent

Responsible for:
- Ticket triage and categorization
- Resolution suggestions
- Knowledge base search
"""

import json
import uuid
from typing import Dict, Any

import structlog

from .base import BaseAgent
from governance.approval_service import PendingAction

logger = structlog.get_logger()


class SupportAgent(BaseAgent):
    """AI agent for support-related tasks."""
    
    def __init__(self):
        super().__init__(
            agent_id="support-agent",
            agent_type="support",
            capabilities=[
                "tickets:triage",
                "tickets:suggest_resolution",
                "tickets:categorize",
            ],
        )
        
    async def process(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Process a generic event."""
        return await self.triage_ticket(event)
        
    async def triage_ticket(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Triage a support ticket."""
        tenant_id = event.get("tenantid", "")
        data = event.get("data", {})
        ticket_id = data.get("ticketId")
        
        logger.info("Triaging ticket", ticket_id=ticket_id, tenant_id=tenant_id)
        
        prompt = f"""Analyze this support ticket and provide triage information.

Ticket Information:
- Subject: {data.get('subject', 'No subject')}
- Description: {data.get('description', 'No description')[:500]}
- Priority: {data.get('priority', 'medium')}
- Customer: {data.get('customerId', 'Unknown')}

Provide your response in JSON format:
{{
    "category": "<technical|billing|general|feature_request>",
    "urgency": "low|medium|high|critical",
    "sentiment": "positive|neutral|negative|frustrated",
    "key_issues": ["<issue1>", "<issue2>"],
    "suggested_resolution": "<brief resolution suggestion>",
    "requires_escalation": true|false,
    "escalation_reason": "<reason if escalation needed>",
    "confidence": <0.0-1.0>,
    "reasoning": "<brief explanation>"
}}
"""

        system_prompt = """You are a customer support triage specialist. Analyze tickets for:
1. Category (technical issues, billing, general inquiries, feature requests)
2. Urgency based on impact and customer sentiment
3. Sentiment analysis
4. Quick resolution paths

Prioritize customer satisfaction. Flag escalation for complex or urgent issues."""

        try:
            response = await self.call_llm(prompt, system_prompt, tenant_id=tenant_id)
            result = self._parse_json_response(response)
            
            confidence = result.get("confidence", 0.7)
            
            # Check policy
            policy_result = await self.check_policy(
                tenant_id=tenant_id,
                action="tickets:triage",
                resource={"ticket_id": ticket_id},
                confidence=confidence,
            )
            
            if not policy_result["allowed"]:
                return {"status": "denied", "reasons": policy_result["deny_reasons"]}
                
            # Emit reasoning
            await self.emit_reasoning(
                tenant_id=tenant_id,
                task_id=str(uuid.uuid4()),
                reasoning=result.get("reasoning", "Triage completed"),
                confidence=confidence,
                factors=[
                    {"name": "category", "value": result.get("category")},
                    {"name": "urgency", "value": result.get("urgency")},
                    {"name": "sentiment", "value": result.get("sentiment")},
                ],
            )
            
            # If escalation needed, request approval
            if result.get("requires_escalation"):
                approval_id = str(uuid.uuid4())
                if self._approval_service:
                    await self._approval_service.request_approval(
                        PendingAction(
                            tenant_id=tenant_id,
                            agent_id=self.agent_id,
                            approval_id=approval_id,
                            action_type="tickets:escalate",
                            topic="crm.tickets.escalate",
                            event_type="crm.tickets.escalate",
                            data={
                                "ticketId": ticket_id,
                                "category": result.get("category"),
                                "urgency": result.get("urgency"),
                                "keyIssues": result.get("key_issues", []),
                                "escalationReason": result.get("escalation_reason"),
                                "requestedBy": self.agent_id,
                                "approvalId": approval_id,
                            },
                            correlation_id=event.get("correlationid"),
                        )
                    )

                await self.request_approval(
                    tenant_id=tenant_id,
                    action_type="tickets:escalate",
                    target_entity="ticket",
                    target_id=ticket_id,
                    context={
                        "category": result.get("category"),
                        "urgency": result.get("urgency"),
                        "key_issues": result.get("key_issues", []),
                        "escalation_reason": result.get("escalation_reason"),
                    },
                    reasoning=result.get("escalation_reason", "Escalation recommended"),
                    confidence=confidence,
                    approval_id=approval_id,
                )
                
            # Emit triage result
            await self.emit_event(
                topic="crm.agents.action-executed",
                event_type="crm.agents.ticket-triaged",
                tenant_id=tenant_id,
                data={
                    "ticketId": ticket_id,
                    "category": result.get("category"),
                    "urgency": result.get("urgency"),
                    "sentiment": result.get("sentiment"),
                    "keyIssues": result.get("key_issues", []),
                    "suggestedResolution": result.get("suggested_resolution"),
                    "requiresEscalation": result.get("requires_escalation", False),
                    "confidence": confidence,
                    "triagedBy": self.agent_id,
                },
                correlation_id=event.get("correlationid"),
            )
            
            logger.info(
                "Ticket triaged",
                ticket_id=ticket_id,
                category=result.get("category"),
                urgency=result.get("urgency"),
            )
            
            return {
                "status": "completed",
                "category": result.get("category"),
                "urgency": result.get("urgency"),
            }
            
        except Exception as e:
            logger.error("Ticket triage failed", ticket_id=ticket_id, error=str(e))
            return {"status": "failed", "error": str(e)}
            
    async def suggest_resolution(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Suggest resolution for a ticket."""
        # TODO: Search knowledge base for similar issues
        # TODO: Provide step-by-step resolution
        
        return {"status": "completed"}
        
    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """Parse JSON from LLM response."""
        try:
            start = response.find("{")
            end = response.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(response[start:end])
        except json.JSONDecodeError:
            pass
            
        return {
            "category": "general",
            "urgency": "medium",
            "sentiment": "neutral",
            "confidence": 0.5,
            "reasoning": response[:500] if response else "Unable to analyze",
        }
