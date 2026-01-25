import sys
import os
from pathlib import Path
import asyncpg
import pytest
import pytest_asyncio

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

REPO_ROOT = ROOT.parent
CORE_SRC = REPO_ROOT / "core_services" / "src"
if str(CORE_SRC) not in sys.path:
    insert_at = 1 if sys.path and sys.path[0] == str(SRC) else 0
    sys.path.insert(insert_at, str(CORE_SRC))


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return "postgresql://crm_user:crm_password@localhost:5432/enterprise_crm"
    return url


@pytest.fixture(scope="session")
def admin_database_url() -> str:
    url = os.environ.get("ADMIN_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        return "postgresql://crm_user:crm_password@localhost:5432/enterprise_crm"
    return url

@pytest_asyncio.fixture(scope="session", autouse=True)
async def init_schema(admin_database_url: str):
    """
    Apply database migrations to the test database.
    This runs once per session.
    """
    # Create a connection to the database
    # Note: This assumes the database exists. 
    try:
        conn = await asyncpg.connect(admin_database_url)
    except Exception as e:
        print(f"Skipping schema initialization, could not connect to DB: {e}")
        return

    try:
        migrations_dir = REPO_ROOT / "database" / "migrations"
        if not migrations_dir.exists():
             print(f"Warning: Migrations directory not found at {migrations_dir}")
             return

        # Execute migrations in order
        sql_files = sorted(migrations_dir.glob("*.sql"))
        print(f"Applying {len(sql_files)} migrations from {migrations_dir}...")
        
        for sql_file in sql_files:
            print(f"Applying migration: {sql_file.name}")
            try:
                with open(sql_file, "r", encoding="utf-8") as f:
                    sql_content = f.read()
                    await conn.execute(sql_content)
            except Exception as e:
                # If table already exists, we might want to ignore or drop? 
                # For now, let's assume clean DB or idempotent scripts (if they have IF NOT EXISTS).
                # The provided scripts might not be idempotent. 
                # Given 'UndefinedTableError', the DB is likely empty or tables missing.
                # If we get 'DuplicateTableError', we can ignore.
                if "already exists" in str(e):
                    print(f"Migration {sql_file.name} might have been applied: {e}")
                else:
                    print(f"Error applying migration {sql_file.name}: {e}")
                    raise
    finally:
        await conn.close()
