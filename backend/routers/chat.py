from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

from core.db import db
from core.security import get_current_user, has_permission
from models.messaging import Conversation, Message
from services.push import notify_new_message

router = APIRouter(prefix="/chat", tags=["chat"])


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("Le message ne peut pas être vide.")
        return value.strip()


class ReadIn(BaseModel):
    message_ids: list[str] = Field(min_length=1, max_length=100)


def is_chat_staff(user) -> bool:
    """Staff side of the chat = super admin, or delegated admin holding chat.manage."""
    return has_permission(user, "chat.manage")


def incoming_role(user):
    return "customer" if is_chat_staff(user) else "admin"


async def allowed_conversation(cid, user):
    query = {"_id": cid}
    if not is_chat_staff(user):
        query["user_id"] = user["user_id"]
    doc = await db.chat_conversations.find_one(query)
    if not doc:
        raise HTTPException(404, "Conversation introuvable.")
    return Conversation.from_mongo(doc)


@router.get("/unread")
async def unread(user=Depends(get_current_user)):
    query = {"sender_role": incoming_role(user), "read": False}
    if not is_chat_staff(user):
        conversation = await db.chat_conversations.find_one({"user_id": user["user_id"]}, {"_id": 1})
        if not conversation:
            return {"count": 0}
        query["conversation_id"] = str(conversation["_id"])
    return {"count": await db.chat_messages.count_documents(query)}


@router.post("/conversations", status_code=201)
async def start_conversation(user=Depends(get_current_user)):
    if is_chat_staff(user):
        raise HTTPException(403, "Ouvrez une conversation client pour répondre.")
    conversation = Conversation(user_id=user["user_id"], user_name=user.get("name") or user["email"], user_email=user["email"])
    doc = conversation.to_mongo()
    try:
        await db.chat_conversations.update_one({"user_id": user["user_id"]}, {"$setOnInsert": doc}, upsert=True)
    except DuplicateKeyError:
        pass  # Concurrent first visits must share the same private conversation.
    return Conversation.from_mongo(await db.chat_conversations.find_one({"user_id": user["user_id"]})).model_dump()


@router.get("/conversations")
async def conversations(before: str | None = Query(default=None, max_length=64), user=Depends(get_current_user)):
    query = {} if is_chat_staff(user) else {"user_id": user["user_id"]}
    if before:
        cursor = await allowed_conversation(before, user)
        query["$or"] = [{"updated_at": {"$lt": cursor.updated_at}}, {"updated_at": cursor.updated_at, "_id": {"$lt": cursor.id}}]
    docs = await db.chat_conversations.find(query).sort([("updated_at", -1), ("_id", -1)]).to_list(51)
    items = [Conversation.from_mongo(doc).model_dump() for doc in docs[:50]]
    counts = await db.chat_messages.aggregate([
        {"$match": {"conversation_id": {"$in": [c["id"] for c in items]}, "read": False, "sender_role": incoming_role(user)}},
        {"$group": {"_id": "$conversation_id", "count": {"$sum": 1}}},
    ]).to_list(50)
    unread_by_id = {str(c["_id"]): c["count"] for c in counts}
    for item in items:
        item["unread_count"] = unread_by_id.get(item["id"], 0)
    return {"items": items, "has_more": len(docs) > 50}


@router.get("/conversations/{cid}/messages")
async def messages(cid: str, before: str | None = Query(default=None, max_length=64), user=Depends(get_current_user)):
    conversation = await allowed_conversation(cid, user)
    query = {"conversation_id": cid}
    if before:
        cursor = await db.chat_messages.find_one({"_id": before, "conversation_id": cid})
        if not cursor:
            raise HTTPException(404, "Message introuvable.")
        query["$or"] = [{"created_at": {"$lt": cursor["created_at"]}}, {"created_at": cursor["created_at"], "_id": {"$lt": before}}]
    docs = await db.chat_messages.find(query).sort([("created_at", -1), ("_id", -1)]).to_list(51)
    return {"conversation": conversation.model_dump(), "messages": [Message.from_mongo(d).model_dump() for d in reversed(docs[:50])], "has_more": len(docs) > 50}


@router.post("/conversations/{cid}/messages", status_code=201)
async def send_message(cid: str, body: MessageIn, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    conversation = await allowed_conversation(cid, user)
    role = "admin" if is_chat_staff(user) else "customer"
    message = Message(conversation_id=cid, sender_id=user["user_id"], sender_role=role, text=body.text)
    await db.chat_messages.insert_one(message.to_mongo())
    await db.chat_conversations.update_one({"_id": cid, "updated_at": {"$lte": message.created_at}},
                                           {"$set": {"last_message": message.text[:160], "updated_at": message.created_at}})
    if role == "customer":
        background_tasks.add_task(notify_new_message, cid, conversation.user_name, message.text)
    return message.model_dump()


@router.post("/conversations/{cid}/read")
async def mark_read(cid: str, body: ReadIn, user=Depends(get_current_user)):
    await allowed_conversation(cid, user)
    # Mark only messages actually returned to this viewer, never a concurrent unseen message.
    result = await db.chat_messages.update_many({"conversation_id": cid, "_id": {"$in": body.message_ids},
                                                 "sender_role": incoming_role(user), "read": False}, {"$set": {"read": True}})
    return {"marked": result.modified_count}
