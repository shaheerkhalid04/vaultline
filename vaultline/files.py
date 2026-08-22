"""CRUD over Supabase Storage objects and their metadata rows.

Writes to the metadata table go through the Edge Function, never from here.
This module only moves bytes and reads rows back, so the validation rules live
in exactly one place.
"""

from __future__ import annotations

import hashlib
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Any, Iterable

from .client import get_client, get_settings, invoke_edge

Record = dict[str, Any]

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class NotFound(LookupError):
    """No metadata row matched the reference given on the command line."""


class Ambiguous(LookupError):
    """More than one row matched a non-id reference."""


def _slugify(name: str) -> str:
    cleaned = _SAFE_NAME.sub("-", name).strip("-")
    return cleaned or "file"


def _object_path(owner: str, file_name: str) -> str:
    return f"{_slugify(owner)}/{uuid.uuid4().hex[:8]}-{_slugify(file_name)}"


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
def upload_file(
    local_path: str | Path,
    owner: str = "anonymous",
    tags: Iterable[str] = (),
    object_path: str | None = None,
    replace: bool = False,
) -> Record:
    """Put the object in Storage, then let the Edge Function judge it.

    If the function rejects the file it also removes the object, so a failed
    upload leaves nothing behind.
    """
    settings = get_settings()
    client = get_client()
    path = Path(local_path).expanduser().resolve()

    if not path.is_file():
        raise FileNotFoundError(f"{path} is not a file")

    target = object_path or _object_path(owner, path.name)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    client.storage.from_(settings.bucket).upload(
        path=target,
        file=path.read_bytes(),
        file_options={
            "content-type": content_type,
            "upsert": "true" if replace else "false",
        },
    )

    response = invoke_edge(
        {
            "action": "revalidate" if replace else "register",
            "bucket": settings.bucket,
            "object_path": target,
            "file_name": path.name,
            "owner": owner,
            "tags": list(tags),
        }
    )
    return response["record"]


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------
def list_files(
    owner: str | None = None,
    category: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> list[Record]:
    settings = get_settings()
    query = get_client().table(settings.files_table).select("*")

    if owner:
        query = query.eq("owner", owner)
    if category:
        query = query.eq("category", category)
    if search:
        query = query.ilike("file_name", f"%{search}%")

    result = query.order("created_at", desc=True).limit(limit).execute()
    return result.data or []


def get_file(reference: str) -> Record:
    """Look a record up by id, exact object path, or a unique file name match."""
    settings = get_settings()
    table = get_client().table(settings.files_table)

    if _is_uuid(reference):
        rows = table.select("*").eq("id", reference).execute().data or []
    else:
        rows = table.select("*").eq("object_path", reference).execute().data or []
        if not rows:
            rows = table.select("*").ilike("file_name", f"%{reference}%").execute().data or []

    if not rows:
        raise NotFound(f"no file record matches {reference!r}")
    if len(rows) > 1:
        names = ", ".join(f"{r['file_name']} ({r['id'][:8]})" for r in rows[:5])
        raise Ambiguous(f"{reference!r} matches {len(rows)} records: {names}")

    return rows[0]


def download_file(reference: str, out_dir: str | Path = "downloads") -> tuple[Path, bool]:
    """Fetch the object and confirm it still hashes to the stored checksum."""
    settings = get_settings()
    record = get_file(reference)

    destination = Path(out_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / record["file_name"]

    payload = get_client().storage.from_(settings.bucket).download(record["object_path"])
    target.write_bytes(payload)

    return target, sha256_of(target) == record["checksum"]


def signed_url(reference: str, expires_in: int = 3600) -> str:
    settings = get_settings()
    record = get_file(reference)
    response = get_client().storage.from_(settings.bucket).create_signed_url(
        record["object_path"], expires_in
    )
    return response["signedURL"]


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------
def update_metadata(
    reference: str,
    owner: str | None = None,
    tags: Iterable[str] | None = None,
    file_name: str | None = None,
) -> Record:
    settings = get_settings()
    record = get_file(reference)

    patch: dict[str, Any] = {}
    if owner is not None:
        patch["owner"] = owner
    if tags is not None:
        patch["tags"] = list(tags)
    if file_name is not None:
        patch["file_name"] = file_name

    if not patch:
        return record

    result = (
        get_client()
        .table(settings.files_table)
        .update(patch)
        .eq("id", record["id"])
        .execute()
    )
    return result.data[0]


def replace_file(reference: str, local_path: str | Path) -> Record:
    """Overwrite the stored object in place and re-run server side validation.

    The object path stays the same, so any signed URL handed out earlier keeps
    pointing at the same slot, and the row is updated rather than duplicated.
    """
    record = get_file(reference)
    return upload_file(
        local_path,
        owner=record["owner"],
        tags=record.get("tags") or [],
        object_path=record["object_path"],
        replace=True,
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------
def delete_file(reference: str) -> Record:
    """Remove the object first, then the row, so no row can outlive its bytes."""
    settings = get_settings()
    client = get_client()
    record = get_file(reference)

    client.storage.from_(settings.bucket).remove([record["object_path"]])
    client.table(settings.files_table).delete().eq("id", record["id"]).execute()

    return record
