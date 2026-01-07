"""
Base Agent class with common functionality.
"""

import json
import uuid
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from datetime import datetime

import structlog
import httpx
from aiokafka import AIOKafkaProducer

from ..orchestrator.config import settings

logger = structlog.get_logger()


class BaseAgent(ABC):
    """Base class for all AI agents."""
    
    def __init__(self, agent_id: str, agent_type: str, capabilities: list):
        self.agent_id = agent_id
        self.agent_type = agent_type
        self.capabilities = capabilities
        self.producer: AIOKafkaProducer = None
        self.http_client: httpx.AsyncClient = None
        
    async def initialize(self, producer: AIOKafkaProducer):
        """Initialize the agent with dependencies."""
        self.producer = producer
        self.http_client = httpx.AsyncClient(timeout=30.0)
        logger.info(f"{self.agent_id} initialized")
        
    async def cleanup(self):
        """Cleanup resources."""
        if self.http_client:
            await self.http_client.aclose()
            
    async def check_policy(
        self,
        tenant_id: str,
        action: str,
        resource: Dict[str, Any],
        confidence: float,
    ) -> Dict[str, Any]:
        """Check OPA policy before taking action."""
        try:
            response = await self.http_client.post(
                f"{settings.OPA_URL}/v1/data/crm/agents",
                json={
                    "input": {
                        "actor_type": "agent",
                        "agent_id": self.agent_id,
                        "tenant_id": tenant_id,
                        "action": action,
                        "resource": resource,
                        "confidence": confidence,
                        "reasoning": "Policy check",
                    }
                },
            )
            result = response.json().get("result", {})
            return {
                "allowed": result.get("allow", False),
                "requires_approval": result.get("requires_human_approval", False),
                "deny_reasons": result.get("deny", []),
            }
        except Exception as e:
            logger.error("Policy check failed", error=str(e))
            # Fail closed - deny if policy engine unavailable
            return {"allowed": False, "requires_approval": True, "deny_reasons": ["Policy engine unavailable"]}
            
    async def emit_event(
        self,
        topic: str,
        event_type: str,
        tenant_id: str,
        data: Dict[str, Any],
        correlation_id: Optional[str] = None,
    ):
        """Emit an event to Kafka."""
        event = {
            "specversion": "1.0",
            "type": event_type,
            "source": f"/agents/{self.agent_id}",
            "id": str(uuid.uuid4()),
            "time": datetime.utcnow().isoformat() + "Z",
            "datacontenttype": "application/json",
            "tenantid": tenant_id,
            "correlationid": correlation_id or str(uuid.uuid4()),
            "data": data,
        }
        
        await self.producer.send(
            topic,
            value=json.dumps(event),
            key=tenant_id.encode() if tenant_id else None,
        )
        
        logger.debug("Event emitted", topic=topic, event_type=event_type)
        
    async def emit_reasoning(
        self,
        tenant_id: str,
        task_id: str,
        reasoning: str,
        confidence: float,
        factors: list,
    ):
        """Emit reasoning for transparency."""
        await self.emit_event(
            topic="crm.agents.reasoning",
            event_type="crm.agents.reasoning",
            tenant_id=tenant_id,
            data={
                "agentId": self.agent_id,
                "taskId": task_id,
                "reasoning": reasoning,
                "confidence": confidence,
                "factors": factors,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            },
        )
        
    async def request_approval(
        self,
        tenant_id: str,
        action_type: str,
        target_entity: str,
        target_id: str,
        context: Dict[str, Any],
        reasoning: str,
        confidence: float,
    ):
        """Request human approval for an action."""
        await self.emit_event(
            topic="crm.approvals.required",
            event_type="crm.approvals.required",
            tenant_id=tenant_id,
            data={
                "requestorType": "agent",
                "requestorId": self.agent_id,
                "actionType": action_type,
                "targetEntity": target_entity,
                "targetId": target_id,
                "context": context,
                "reasoning": reasoning,
                "confidence": confidence,
                "agentType": self.agent_type,
            },
        )
        
        logger.info(
            "Approval requested",
            agent=self.agent_id,
            action=action_type,
            target=f"{target_entity}:{target_id}",
        )
        
    async def call_llm(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Call the LLM for inference."""
        try:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            response = await self.http_client.post(
                f"{settings.OLLAMA_URL}/api/chat",
                json={
                    "model": settings.OLLAMA_MODEL,
                    "messages": messages,
                    "stream": False,
                },
            )
            
            result = response.json()
            return result.get("message", {}).get("content", "")
            
        except Exception as e:
            logger.error("LLM call failed", error=str(e))
            raise
            
    @abstractmethod
    async def process(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Process an event - must be implemented by subclasses."""
        pass
