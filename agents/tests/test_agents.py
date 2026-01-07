"""
Unit tests for AI Agents
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

# Test the sales agent
class TestSalesAgent:
    """Tests for the Sales Agent."""
    
    @pytest.fixture
    def sales_agent(self):
        from src.agents.sales import SalesAgent
        agent = SalesAgent()
        agent.producer = AsyncMock()
        agent.http_client = AsyncMock()
        return agent
    
    @pytest.mark.asyncio
    async def test_qualify_lead_success(self, sales_agent):
        """Test successful lead qualification."""
        # Mock LLM response
        sales_agent.call_llm = AsyncMock(return_value=json.dumps({
            "score": 85,
            "qualification_status": "qualified",
            "reasoning": "Strong corporate email domain and complete company info",
            "confidence": 0.9,
            "factors": [
                {"name": "email_domain", "impact": "positive", "weight": 0.8}
            ],
            "recommended_actions": ["Schedule discovery call"]
        }))
        
        # Mock OPA check
        sales_agent.check_policy = AsyncMock(return_value={
            "allowed": True,
            "requires_approval": False,
            "deny_reasons": []
        })
        
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {
                "leadId": "123",
                "name": "John Smith",
                "email": "john@acme.com",
                "company": "Acme Corp",
                "source": "website"
            }
        }
        
        result = await sales_agent.qualify_lead(event)
        
        assert result["status"] == "completed"
        assert result["score"] == 85
        assert result["qualification_status"] == "qualified"
        
    @pytest.mark.asyncio
    async def test_qualify_lead_requires_approval(self, sales_agent):
        """Test lead qualification requiring approval due to low confidence."""
        sales_agent.call_llm = AsyncMock(return_value=json.dumps({
            "score": 60,
            "qualification_status": "needs_info",
            "reasoning": "Insufficient information to qualify",
            "confidence": 0.5,
            "factors": [],
            "recommended_actions": []
        }))
        
        sales_agent.check_policy = AsyncMock(return_value={
            "allowed": True,
            "requires_approval": True,
            "deny_reasons": []
        })
        
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {
                "leadId": "123",
                "name": "Jane Doe",
            }
        }
        
        result = await sales_agent.qualify_lead(event)
        
        assert result["status"] == "pending_approval"
        
    @pytest.mark.asyncio
    async def test_qualify_lead_policy_denied(self, sales_agent):
        """Test lead qualification denied by policy."""
        sales_agent.check_policy = AsyncMock(return_value={
            "allowed": False,
            "requires_approval": False,
            "deny_reasons": ["Agent rate limit exceeded"]
        })
        
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {"leadId": "123", "name": "Test"}
        }
        
        result = await sales_agent.qualify_lead(event)
        
        assert result["status"] == "denied"


class TestSupportAgent:
    """Tests for the Support Agent."""
    
    @pytest.fixture
    def support_agent(self):
        from src.agents.support import SupportAgent
        agent = SupportAgent()
        agent.producer = AsyncMock()
        agent.http_client = AsyncMock()
        return agent
    
    @pytest.mark.asyncio
    async def test_triage_ticket(self, support_agent):
        """Test ticket triage."""
        support_agent.call_llm = AsyncMock(return_value=json.dumps({
            "category": "technical",
            "urgency": "high",
            "sentiment": "frustrated",
            "key_issues": ["Login failure", "Account locked"],
            "suggested_resolution": "Reset user account",
            "requires_escalation": False,
            "confidence": 0.85,
            "reasoning": "Clear technical issue affecting user access"
        }))
        
        support_agent.check_policy = AsyncMock(return_value={
            "allowed": True,
            "requires_approval": False,
            "deny_reasons": []
        })
        
        event = {
            "type": "crm.tickets.created",
            "tenantid": "test-tenant",
            "data": {
                "ticketId": "456",
                "subject": "Cannot login to dashboard",
                "description": "Getting error when trying to login",
                "priority": "high"
            }
        }
        
        result = await support_agent.triage_ticket(event)
        
        assert result["status"] == "completed"
        assert result["category"] == "technical"
        assert result["urgency"] == "high"


class TestComplianceAgent:
    """Tests for the Compliance Agent."""
    
    @pytest.fixture
    def compliance_agent(self):
        from src.agents.compliance import ComplianceAgent
        agent = ComplianceAgent()
        agent.producer = AsyncMock()
        return agent
    
    @pytest.mark.asyncio
    async def test_validate_clean_data(self, compliance_agent):
        """Test validation of clean data."""
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {
                "leadId": "123",
                "name": "John Smith",
                "email": "john@example.com",
                "company": "Acme Corp"
            }
        }
        
        result = await compliance_agent.validate_data(event, entity_type="lead")
        
        assert result["status"] == "completed"
        assert result["compliant"] is True
        assert len(result["issues"]) == 0
        
    @pytest.mark.asyncio
    async def test_detect_pii(self, compliance_agent):
        """Test PII detection."""
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {
                "leadId": "123",
                "name": "John Smith",
                "ssn": "123-45-6789",
                "credit_card": "4111111111111111"
            }
        }
        
        result = await compliance_agent.validate_data(event, entity_type="lead")
        
        assert result["status"] == "completed"
        assert result["compliant"] is False
        assert any(issue["type"] == "pii_detected" for issue in result["issues"])
        
    @pytest.mark.asyncio
    async def test_detect_suspicious_pattern(self, compliance_agent):
        """Test suspicious pattern detection."""
        event = {
            "type": "crm.leads.created",
            "tenantid": "test-tenant",
            "data": {
                "leadId": "123",
                "name": "Test User Fake",
                "email": "test@tempmail.com"
            }
        }
        
        result = await compliance_agent.validate_data(event, entity_type="lead")
        
        assert len(result["issues"]) > 0


class TestAnalyticsAgent:
    """Tests for the Analytics Agent."""
    
    @pytest.fixture
    def analytics_agent(self):
        from src.agents.analytics import AnalyticsAgent
        agent = AnalyticsAgent()
        agent.producer = AsyncMock()
        return agent
    
    @pytest.mark.asyncio
    async def test_track_pipeline_normal(self, analytics_agent):
        """Test normal pipeline movement tracking."""
        event = {
            "type": "crm.deals.stage-changed",
            "tenantid": "test-tenant",
            "data": {
                "dealId": "789",
                "previousStage": "prospecting",
                "newStage": "qualification",
                "amount": 50000
            }
        }
        
        result = await analytics_agent.track_pipeline_movement(event)
        
        assert result["status"] == "completed"
        assert result["anomaly"] is None
        
    @pytest.mark.asyncio
    async def test_detect_skipped_stages(self, analytics_agent):
        """Test detection of skipped stages."""
        event = {
            "type": "crm.deals.stage-changed",
            "tenantid": "test-tenant",
            "data": {
                "dealId": "789",
                "previousStage": "prospecting",
                "newStage": "negotiation",  # Skipped qualification and proposal
                "amount": 50000
            }
        }
        
        result = await analytics_agent.track_pipeline_movement(event)
        
        assert result["status"] == "completed"
        assert result["anomaly"] == "skipped_stages"
        
    @pytest.mark.asyncio
    async def test_detect_backwards_movement(self, analytics_agent):
        """Test detection of backwards pipeline movement."""
        event = {
            "type": "crm.deals.stage-changed",
            "tenantid": "test-tenant",
            "data": {
                "dealId": "789",
                "previousStage": "proposal",
                "newStage": "qualification",  # Moved backwards
                "amount": 50000
            }
        }
        
        result = await analytics_agent.track_pipeline_movement(event)
        
        assert result["status"] == "completed"
        assert result["anomaly"] == "backwards_movement"
