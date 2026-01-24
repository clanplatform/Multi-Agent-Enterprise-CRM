"""
Configuration settings for the AI Agent Layer.
"""

import os
from typing import List


class Settings:
    """Application settings loaded from environment."""
    
    # Kafka
    KAFKA_BROKERS: str = os.getenv("KAFKA_BROKERS", "localhost:9094")
    KAFKA_GROUP_ID: str = os.getenv("KAFKA_GROUP_ID", "ai-agents")
    
    # Topics to consume
    CONSUME_TOPICS: List[str] = [
        "crm.leads.created",
        "crm.leads.updated",
        "crm.deals.created",
        "crm.deals.stage-changed",
        "crm.tickets.created",
        "crm.tickets.updated",
        "crm.approvals.decision",
    ]
    
    # Ollama (LLM)
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "llama3.1")
    
    # Weaviate (Vector Store)
    WEAVIATE_URL: str = os.getenv("WEAVIATE_URL", "http://localhost:8080")
    
    # OPA (Policy Engine)
    OPA_URL: str = os.getenv("OPA_URL", "http://localhost:8181")
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://localhost:5432/enterprise_crm")

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    # Health check
    HEALTH_PORT: int = int(os.getenv("AGENTS_PORT", "5010"))
    
    # Agent settings
    DEFAULT_CONFIDENCE_THRESHOLD: float = 0.7
    HIGH_RISK_CONFIDENCE_THRESHOLD: float = 0.9
    MAX_RETRIES: int = 3
    TASK_TIMEOUT_SECONDS: int = 300


settings = Settings()
