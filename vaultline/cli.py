"""Terminal front end for vaultline."""

from __future__ import annotations

import argparse
import sys
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from . import files, notes
from .client import EdgeFunctionError, get_settings
from .config import ConfigError

console = Console()


def _tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def _short(value: Any, width: int = 8) -> str:
    return str(value)[:width]


def _print_record(record: dict[str, Any], title: str = "file record") -> None:
    lines = [
        f"[bold]id[/bold]         {record['id']}",
        f"[bold]name[/bold]       {record['file_name']}",
        f"[bold]path[/bold]       {record['object_path']}",
        f"[bold]type[/bold]       {record['mime_type']}  ({record['category']})",
        f"[bold]size[/bold]       {files.human_size(record['size_bytes'])}",
        f"[bold]sha256[/bold]     {record['checksum']}",
        f"[bold]owner[/bold]      {record['owner']}",
        f"[bold]tags[/bold]       {', '.join(record.get('tags') or []) or '-'}",
        f"[bold]validated[/bold]  {record['validated']}",
        f"[bold]created[/bold]    {record['created_at']}",
        f"[bold]updated[/bold]    {record['updated_at']}",
    ]
    console.print(Panel("\n".join(lines), title=title, border_style="cyan"))


def _print_note(note: dict[str, Any], title: str = "note") -> None:
    lines = [
        f"[bold]id[/bold]       {note['id']}",
        f"[bold]title[/bold]    {note['title']}",
        f"[bold]owner[/bold]    {note['owner']}",
        f"[bold]pinned[/bold]   {note['pinned']}",
        f"[bold]created[/bold]  {note['created_at']}",
        f"[bold]updated[/bold]  {note['updated_at']}",
        "",
        note["body"] or "[dim](empty)[/dim]",
    ]
    console.print(Panel("\n".join(lines), title=title, border_style="magenta"))


# ---------------------------------------------------------------------------
# file commands
# ---------------------------------------------------------------------------
def cmd_file_upload(args: argparse.Namespace) -> int:
    record = files.upload_file(args.path, owner=args.owner, tags=_tags(args.tags))
    console.print("[green]accepted by the edge function[/green]")
    _print_record(record, "uploaded")
    return 0


def cmd_file_list(args: argparse.Namespace) -> int:
    rows = files.list_files(
        owner=args.owner, category=args.category, search=args.search, limit=args.limit
    )
    if not rows:
        console.print("[yellow]no files stored yet[/yellow]")
        return 0

    table = Table(title=f"{len(rows)} file(s)", header_style="bold cyan")
    for column in ("id", "name", "type", "size", "owner", "tags", "created"):
        table.add_column(column)

    for row in rows:
        table.add_row(
            _short(row["id"]),
            row["file_name"],
            row["category"],
            files.human_size(row["size_bytes"]),
            row["owner"],
            ", ".join(row.get("tags") or []) or "-",
            row["created_at"][:19].replace("T", " "),
        )

    console.print(table)
    return 0


def cmd_file_get(args: argparse.Namespace) -> int:
    _print_record(files.get_file(args.reference))
    return 0


def cmd_file_download(args: argparse.Namespace) -> int:
    path, checksum_ok = files.download_file(args.reference, args.out)
    console.print(f"saved to [bold]{path}[/bold]")
    if checksum_ok:
        console.print("[green]checksum matches the stored value[/green]")
    else:
        console.print("[red]checksum mismatch, the object may have been altered[/red]")
        return 1
    return 0


def cmd_file_url(args: argparse.Namespace) -> int:
    console.print(files.signed_url(args.reference, args.expires))
    return 0


def cmd_file_update(args: argparse.Namespace) -> int:
    if args.file:
        record = files.replace_file(args.reference, args.file)
        console.print("[green]object replaced and revalidated[/green]")
    else:
        record = files.update_metadata(
            args.reference,
            owner=args.owner,
            tags=_tags(args.tags) if args.tags is not None else None,
            file_name=args.rename,
        )
        console.print("[green]metadata updated[/green]")

    _print_record(record, "updated")
    return 0


def cmd_file_delete(args: argparse.Namespace) -> int:
    record = files.get_file(args.reference)

    if not args.yes:
        console.print(f"about to delete [bold]{record['file_name']}[/bold] ({record['id']})")
        if input("type y to confirm: ").strip().lower() != "y":
            console.print("[yellow]cancelled[/yellow]")
            return 1

    files.delete_file(record["id"])
    console.print(f"[green]deleted {record['file_name']} and its metadata row[/green]")
    return 0


# ---------------------------------------------------------------------------
# note commands
# ---------------------------------------------------------------------------
def cmd_note_create(args: argparse.Namespace) -> int:
    _print_note(
        notes.create_note(args.title, body=args.body, owner=args.owner, pinned=args.pinned),
        "created",
    )
    return 0


def cmd_note_list(args: argparse.Namespace) -> int:
    rows = notes.list_notes(owner=args.owner, search=args.search, limit=args.limit)
    if not rows:
        console.print("[yellow]no notes yet[/yellow]")
        return 0

    table = Table(title=f"{len(rows)} note(s)", header_style="bold magenta")
    for column in ("id", "title", "owner", "pinned", "created"):
        table.add_column(column)

    for row in rows:
        table.add_row(
            _short(row["id"]),
            row["title"],
            row["owner"],
            "yes" if row["pinned"] else "",
            row["created_at"][:19].replace("T", " "),
        )

    console.print(table)
    return 0


def cmd_note_get(args: argparse.Namespace) -> int:
    _print_note(notes.get_note(args.reference))
    return 0


def cmd_note_update(args: argparse.Namespace) -> int:
    pinned = True if args.pin else (False if args.unpin else None)
    _print_note(
        notes.update_note(
            args.reference, title=args.title, body=args.body, owner=args.owner, pinned=pinned
        ),
        "updated",
    )
    return 0


def cmd_note_delete(args: argparse.Namespace) -> int:
    note = notes.get_note(args.reference)

    if not args.yes:
        console.print(f"about to delete note [bold]{note['title']}[/bold] ({note['id']})")
        if input("type y to confirm: ").strip().lower() != "y":
            console.print("[yellow]cancelled[/yellow]")
            return 1

    notes.delete_note(note["id"])
    console.print(f"[green]deleted note {note['title']}[/green]")
    return 0


# ---------------------------------------------------------------------------
# diagnostics
# ---------------------------------------------------------------------------
def cmd_health(_: argparse.Namespace) -> int:
    settings = get_settings()
    console.print(
        Panel(
            "\n".join(
                [
                    f"[bold]project[/bold]        {settings.url}",
                    f"[bold]bucket[/bold]         {settings.bucket}",
                    f"[bold]files table[/bold]    {settings.files_table}",
                    f"[bold]notes table[/bold]    {settings.notes_table}",
                    f"[bold]edge function[/bold]  {settings.edge_function_url}",
                    f"[bold]size limit[/bold]     {settings.max_mb} MB",
                ]
            ),
            title="configuration",
            border_style="green",
        )
    )

    file_count = len(files.list_files(limit=1000))
    note_count = len(notes.list_notes(limit=1000))
    console.print(f"reachable: {file_count} file record(s), {note_count} note(s)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vaultline",
        description="CRUD over Supabase Storage and tables, validated by an Edge Function.",
    )
    top = parser.add_subparsers(dest="group", required=True)

    # files -----------------------------------------------------------------
    file_parser = top.add_parser("file", help="storage objects and their metadata")
    file_cmds = file_parser.add_subparsers(dest="command", required=True)

    upload = file_cmds.add_parser("upload", help="upload a file and register it")
    upload.add_argument("path")
    upload.add_argument("--owner", default="anonymous")
    upload.add_argument("--tags", help="comma separated")
    upload.set_defaults(func=cmd_file_upload)

    listing = file_cmds.add_parser("list", help="list stored files")
    listing.add_argument("--owner")
    listing.add_argument("--category")
    listing.add_argument("--search")
    listing.add_argument("--limit", type=int, default=50)
    listing.set_defaults(func=cmd_file_list)

    show = file_cmds.add_parser("get", help="show one record")
    show.add_argument("reference", help="id, object path, or part of the file name")
    show.set_defaults(func=cmd_file_get)

    download = file_cmds.add_parser("download", help="download and verify a file")
    download.add_argument("reference")
    download.add_argument("--out", default="downloads")
    download.set_defaults(func=cmd_file_download)

    url = file_cmds.add_parser("url", help="create a signed url")
    url.add_argument("reference")
    url.add_argument("--expires", type=int, default=3600, help="seconds")
    url.set_defaults(func=cmd_file_url)

    update = file_cmds.add_parser("update", help="replace the file or edit metadata")
    update.add_argument("reference")
    update.add_argument("--file", help="local path to replace the stored object")
    update.add_argument("--owner")
    update.add_argument("--tags", help="comma separated, replaces the existing tags")
    update.add_argument("--rename", help="new display name")
    update.set_defaults(func=cmd_file_update)

    remove = file_cmds.add_parser("delete", help="delete object and metadata")
    remove.add_argument("reference")
    remove.add_argument("-y", "--yes", action="store_true", help="skip the confirmation")
    remove.set_defaults(func=cmd_file_delete)

    # notes -----------------------------------------------------------------
    note_parser = top.add_parser("note", help="plain table CRUD")
    note_cmds = note_parser.add_subparsers(dest="command", required=True)

    note_create = note_cmds.add_parser("create")
    note_create.add_argument("title")
    note_create.add_argument("--body", default="")
    note_create.add_argument("--owner", default="anonymous")
    note_create.add_argument("--pinned", action="store_true")
    note_create.set_defaults(func=cmd_note_create)

    note_list = note_cmds.add_parser("list")
    note_list.add_argument("--owner")
    note_list.add_argument("--search")
    note_list.add_argument("--limit", type=int, default=50)
    note_list.set_defaults(func=cmd_note_list)

    note_get = note_cmds.add_parser("get")
    note_get.add_argument("reference")
    note_get.set_defaults(func=cmd_note_get)

    note_update = note_cmds.add_parser("update")
    note_update.add_argument("reference")
    note_update.add_argument("--title")
    note_update.add_argument("--body")
    note_update.add_argument("--owner")
    note_update.add_argument("--pin", action="store_true")
    note_update.add_argument("--unpin", action="store_true")
    note_update.set_defaults(func=cmd_note_update)

    note_delete = note_cmds.add_parser("delete")
    note_delete.add_argument("reference")
    note_delete.add_argument("-y", "--yes", action="store_true")
    note_delete.set_defaults(func=cmd_note_delete)

    # diagnostics -----------------------------------------------------------
    health = top.add_parser("health", help="show config and confirm the project answers")
    health.set_defaults(func=cmd_health)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        return args.func(args)
    except ConfigError as exc:
        console.print(f"[red]config error:[/red] {exc}")
    except EdgeFunctionError as exc:
        console.print(f"[red]edge function rejected this ({exc.code}):[/red] {exc}")
    except (files.NotFound, notes.NotFound) as exc:
        console.print(f"[red]not found:[/red] {exc}")
    except (files.Ambiguous, notes.Ambiguous) as exc:
        console.print(f"[yellow]ambiguous reference:[/yellow] {exc}")
    except FileNotFoundError as exc:
        console.print(f"[red]{exc}[/red]")
    except KeyboardInterrupt:
        console.print("\n[yellow]interrupted[/yellow]")

    return 1


if __name__ == "__main__":
    sys.exit(main())
