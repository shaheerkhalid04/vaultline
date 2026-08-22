"""Supabase client plus the thin wrapper used to call the Edge Function."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx
from supabase import Client, create_client

from .config import Settings, load_settings


class EdgeFunctionError(RuntimeError):
    """The Edge Function refused the upload or failed on the server."""

    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()


@lru_cache(maxsize=1)
def get_client() -> Client:
    settings = get_settings()
    return create_client(settings.url, settings.key)


def invoke_edge(payload: dict[str, Any], timeout: float = 60.0) -> dict[str, Any]:
    """POST to the deployed Edge Function and unwrap its JSON envelope.

    The function answers with {"ok": true, "record": {...}} or
    {"ok": false, "code": "...", "error": "..."}, so a rejection carries a
    reason we can print instead of a bare HTTP status.
    """
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {settings.key}",
        "apikey": settings.key,
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(
            settings.edge_function_url,
            json=payload,
            headers=headers,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise EdgeFunctionError("network_error", str(exc), 0) from exc

    try:
        body = response.json()
    except ValueError:
        raise EdgeFunctionError(
            "bad_response",
            f"function returned non-JSON body: {response.text[:200]}",
            response.status_code,
        ) from None

    if not body.get("ok"):
        raise EdgeFunctionError(
            body.get("code", "unknown"),
            body.get("error", "edge function rejected the request"),
            response.status_code,
        )

    return body
