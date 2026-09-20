import uuid
from datetime import datetime, timezone

from core.db import db


async def audit(action: str, actor: str | None, target: str | None = None, meta: dict | None = None):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()), "action": action, "actor": actor or "system", "target": target,
        "meta": meta or {}, "created_at": datetime.now(timezone.utc).isoformat(),
    })
