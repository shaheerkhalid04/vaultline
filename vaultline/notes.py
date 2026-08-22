"""Plain table CRUD, no storage involved.

The same four operations against a normal Postgres table, so the difference
between a table row and a stored object stays visible in one codebase.
"""

from __future__ import annotations

import uuid
from typing import Any

from .client import get_client, get_settings

Note = dict[str, Any]


class NotFound(LookupError):
    pass


class Ambiguous(LookupError):
    pass


def _table():
    return get_client().table(get_settings().notes_table)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def create_note(title: str, body: str = "", owner: str = "anonymous", pinned: bool = False) -> Note:
    result = _table().insert(
        {"title": title, "body": body, "owner": owner, "pinned": pinned}
    ).execute()
    return result.data[0]


def list_notes(owner: str | None = None, search: str | None = None, limit: int = 50) -> list[Note]:
    query = _table().select("*")

    if owner:
        query = query.eq("owner", owner)
    if search:
        query = query.ilike("title", f"%{search}%")

    result = query.order("pinned", desc=True).order("created_at", desc=True).limit(limit).execute()
    return result.data or []


def get_note(reference: str) -> Note:
    if _is_uuid(reference):
        rows = _table().select("*").eq("id", reference).execute().data or []
    else:
        rows = _table().select("*").ilike("title", f"%{reference}%").execute().data or []

    if not rows:
        raise NotFound(f"no note matches {reference!r}")
    if len(rows) > 1:
        titles = ", ".join(f"{r['title']} ({r['id'][:8]})" for r in rows[:5])
        raise Ambiguous(f"{reference!r} matches {len(rows)} notes: {titles}")

    return rows[0]


def update_note(
    reference: str,
    title: str | None = None,
    body: str | None = None,
    owner: str | None = None,
    pinned: bool | None = None,
) -> Note:
    note = get_note(reference)

    patch: dict[str, Any] = {}
    if title is not None:
        patch["title"] = title
    if body is not None:
        patch["body"] = body
    if owner is not None:
        patch["owner"] = owner
    if pinned is not None:
        patch["pinned"] = pinned

    if not patch:
        return note

    result = _table().update(patch).eq("id", note["id"]).execute()
    return result.data[0]


def delete_note(reference: str) -> Note:
    note = get_note(reference)
    _table().delete().eq("id", note["id"]).execute()
    return note
