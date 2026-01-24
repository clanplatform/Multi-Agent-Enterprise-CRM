"""
AI Agent Orchestrator

Main entry point for the AI agent layer.
Consumes events from Kafka and routes them to appropriate agents.
"""

import asyncio
import json
import signal
import os
from contextlib import asynccontextmanager

import structlog
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.structs import OffsetAndMetadata, TopicPartition
import httpx
from aiohttp import web

from .router import AgentRouter
from .config import settings
from governance.agent_telemetry import agents_running, metrics_response

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger()


class AgentOrchestrator:
    """Main orchestrator that routes events to agents."""
    
    def __init__(self):
        self.consumer: AIOKafkaConsumer = None
        self.producer: AIOKafkaProducer = None
        self.router = AgentRouter()
        self.running = False
        self._paused_partitions: dict[TopicPartition, str] = {}
        self._resume_task: asyncio.Task | None = None
        
    async def start(self):
        """Start the orchestrator."""
        logger.info("Starting Agent Orchestrator")
        
        # Initialize Kafka consumer
        self.consumer = AIOKafkaConsumer(
            *settings.CONSUME_TOPICS,
            bootstrap_servers=settings.KAFKA_BROKERS,
            group_id=settings.KAFKA_GROUP_ID,
            auto_offset_reset="latest",
            enable_auto_commit=False,
            value_deserializer=lambda m: m.decode("utf-8"),
        )
        
        # Initialize Kafka producer
        self.producer = AIOKafkaProducer(
            bootstrap_servers=settings.KAFKA_BROKERS,
            value_serializer=lambda v: v.encode("utf-8"),
        )
        
        await self.consumer.start()
        await self.producer.start()
        await self.router.initialize(self.producer)
        
        self.running = True
        agents_running.set(1)
        logger.info("Agent Orchestrator started", topics=settings.CONSUME_TOPICS)

        self._resume_task = asyncio.create_task(self._resume_loop())
        
        # Start consuming
        await self._consume_loop()
        
    async def _consume_loop(self):
        """Main consumption loop."""
        try:
            async for message in self.consumer:
                if not self.running:
                    break
                    
                try:
                    processed = await self._process_message(message)
                    if processed:
                        tp = TopicPartition(message.topic, message.partition)
                        await self.consumer.commit({tp: OffsetAndMetadata(message.offset + 1, "")})
                except Exception as e:
                    logger.error(
                        "Failed to process message",
                        topic=message.topic,
                        offset=message.offset,
                        error=str(e),
                    )
                    # TODO: Send to DLQ
                    
        except asyncio.CancelledError:
            logger.info("Consumer loop cancelled")
            
    async def _process_message(self, message):
        """Process a single message."""
        logger.debug(
            "Received message",
            topic=message.topic,
            partition=message.partition,
            offset=message.offset,
        )

        tenant_id = None
        try:
            event = json.loads(message.value)
            tenant_id = event.get("tenantid") or event.get("tenantId") or event.get("data", {}).get("tenantId")
        except Exception:
            tenant_id = None

        if tenant_id:
            decision = await self.router.kill_switch.decision(tenant_id=str(tenant_id), agent_id="agent-orchestrator")
            if decision.blocked:
                tp = TopicPartition(message.topic, message.partition)
                self.consumer.pause([tp])
                await self.consumer.seek(tp, message.offset)
                self._paused_partitions[tp] = str(tenant_id)
                logger.warning(
                    "Paused partition due to kill switch",
                    tenant_id=str(tenant_id),
                    topic=message.topic,
                    partition=message.partition,
                    scope_key=decision.scope_key,
                    state=decision.status.state.value if decision.status else None,
                )
                return False

        await self.router.route(message.topic, message.value)
        return True
        
    async def stop(self):
        """Stop the orchestrator."""
        logger.info("Stopping Agent Orchestrator")
        self.running = False
        agents_running.set(0)

        if self._resume_task:
            self._resume_task.cancel()
            self._resume_task = None
        
        if self.consumer:
            await self.consumer.stop()
            
        if self.producer:
            await self.producer.stop()
            
        logger.info("Agent Orchestrator stopped")

    async def _resume_loop(self) -> None:
        while self.running:
            if not self._paused_partitions:
                await asyncio.sleep(0.2)
                continue

            items = list(self._paused_partitions.items())
            for tp, tenant_id in items:
                decision = await self.router.kill_switch.decision(tenant_id=tenant_id, agent_id="agent-orchestrator")
                if not decision.blocked:
                    self.consumer.resume([tp])
                    self._paused_partitions.pop(tp, None)
                    logger.info(
                        "Resumed partition after kill switch cleared",
                        tenant_id=tenant_id,
                        topic=tp.topic,
                        partition=tp.partition,
                    )
            await asyncio.sleep(0.2)


# Health check server
async def health_handler(request):
    """Health check endpoint."""
    return web.json_response({"status": "healthy"})

async def metrics_handler(request):
    resp = metrics_response()
    return web.Response(body=resp.body, content_type=resp.content_type)

async def run_health_server():
    """Run the health check HTTP server."""
    app = web.Application()
    app.router.add_get("/health", health_handler)
    app.router.add_get("/metrics", metrics_handler)
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, "0.0.0.0", settings.HEALTH_PORT)
    await site.start()
    
    logger.info("Health server started", port=settings.HEALTH_PORT)
    return runner


async def main():
    """Main entry point."""
    orchestrator = AgentOrchestrator()
    health_runner = None
    
    # Setup signal handlers (platform-specific)
    loop = asyncio.get_event_loop()
    
    def signal_handler(*args):
        logger.info("Received shutdown signal")
        loop.create_task(orchestrator.stop())
    
    # Windows doesn't support add_signal_handler, use signal.signal instead
    if os.name == 'nt':  # Windows
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    else:  # Unix
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, signal_handler)
    
    try:
        # Start health check server
        health_runner = await run_health_server()
        
        # Start orchestrator
        await orchestrator.start()
        
    except Exception as e:
        logger.error("Orchestrator failed", error=str(e))
        raise
        
    finally:
        if health_runner:
            await health_runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
