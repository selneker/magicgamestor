"""Persistence models for chat and push; existing auth/order models stay unchanged."""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

PyObjectId = Annotated[str, BeforeValidator(str)]


def now():
    return datetime.now(timezone.utc).isoformat()


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: PyObjectId = Field(default_factory=lambda: str(uuid.uuid4()), alias="_id")

    def to_mongo(self):
        return self.model_dump(by_alias=True)

    @classmethod
    def from_mongo(cls, doc):
        return cls.model_validate(doc)


class Conversation(BaseDocument):
    user_id: str
    user_name: str
    user_email: str
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    last_message: str = ""


class Message(BaseDocument):
    conversation_id: str
    sender_id: str
    sender_role: Literal["customer", "admin"]
    text: str
    created_at: str = Field(default_factory=now)
    read: bool = False


class PushSubscription(BaseDocument):
    user_id: str
    endpoint: str
    keys: dict[str, str]
    updated_at: str = Field(default_factory=now)
