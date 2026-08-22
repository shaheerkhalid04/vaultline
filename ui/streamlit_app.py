"""Optional Streamlit front end over the same functions the CLI uses.

Run with:  streamlit run ui/streamlit_app.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vaultline import files, notes  # noqa: E402
from vaultline.client import EdgeFunctionError, get_settings  # noqa: E402
from vaultline.config import ConfigError  # noqa: E402

st.set_page_config(page_title="vaultline", page_icon="::", layout="wide")

try:
    settings = get_settings()
except ConfigError as exc:
    st.error(str(exc))
    st.stop()

st.title("vaultline")
st.caption(
    f"bucket `{settings.bucket}` - validated by the `{settings.edge_function}` edge function "
    f"(limit {settings.max_mb} MB)"
)

owner = st.sidebar.text_input("Acting as", value="anonymous")
st.sidebar.markdown("---")
st.sidebar.caption("Every upload is checked server side before a row is written.")

files_tab, notes_tab = st.tabs(["Files", "Notes"])


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
with files_tab:
    with st.expander("Upload a file", expanded=True):
        upload = st.file_uploader("Choose a file", key="uploader")
        tags_input = st.text_input("Tags", placeholder="reports, q3", key="upload_tags")

        if st.button("Upload", type="primary", disabled=upload is None):
            temp_dir = Path(tempfile.mkdtemp())
            staged = temp_dir / upload.name
            staged.write_bytes(upload.getbuffer())

            try:
                record = files.upload_file(
                    staged,
                    owner=owner,
                    tags=[t.strip() for t in tags_input.split(",") if t.strip()],
                )
            except EdgeFunctionError as exc:
                st.error(f"rejected ({exc.code}): {exc}")
            else:
                st.success(f"stored {record['file_name']} as {record['mime_type']}")
                st.json(record)

    st.subheader("Stored files")

    search = st.text_input("Search by name", key="file_search")
    rows = files.list_files(search=search or None, limit=200)

    if not rows:
        st.info("Nothing stored yet.")
    else:
        st.dataframe(
            [
                {
                    "name": row["file_name"],
                    "type": row["category"],
                    "size": files.human_size(row["size_bytes"]),
                    "owner": row["owner"],
                    "tags": ", ".join(row.get("tags") or []),
                    "created": row["created_at"][:19].replace("T", " "),
                }
                for row in rows
            ],
            use_container_width=True,
            hide_index=True,
        )

        labels = {f"{row['file_name']} ({row['id'][:8]})": row for row in rows}
        selection = st.selectbox("Selected file", list(labels))
        record = labels[selection]

        col_download, col_replace, col_delete = st.columns(3)

        with col_download:
            payload = None
            if st.button("Prepare download"):
                path, ok = files.download_file(record["id"], tempfile.mkdtemp())
                payload = path.read_bytes()
                if not ok:
                    st.warning("checksum mismatch")
            if payload is not None:
                st.download_button("Save file", payload, file_name=record["file_name"])

        with col_replace:
            replacement = st.file_uploader("Replace with", key="replacement")
            if st.button("Replace", disabled=replacement is None):
                temp_dir = Path(tempfile.mkdtemp())
                staged = temp_dir / replacement.name
                staged.write_bytes(replacement.getbuffer())
                try:
                    files.replace_file(record["id"], staged)
                except EdgeFunctionError as exc:
                    st.error(f"rejected ({exc.code}): {exc}")
                else:
                    st.success("replaced and revalidated")
                    st.rerun()

        with col_delete:
            st.write("")
            if st.button("Delete", type="secondary"):
                files.delete_file(record["id"])
                st.success("deleted")
                st.rerun()

        st.markdown("**Edit metadata**")
        new_tags = st.text_input("Tags", value=", ".join(record.get("tags") or []), key="edit_tags")
        new_owner = st.text_input("Owner", value=record["owner"], key="edit_owner")

        if st.button("Save metadata"):
            files.update_metadata(
                record["id"],
                owner=new_owner,
                tags=[t.strip() for t in new_tags.split(",") if t.strip()],
            )
            st.success("metadata updated")
            st.rerun()

        with st.expander("Full record"):
            st.json(record)


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------
with notes_tab:
    with st.expander("New note", expanded=True):
        title = st.text_input("Title", key="note_title")
        body = st.text_area("Body", key="note_body")
        pinned = st.checkbox("Pinned", key="note_pinned")

        if st.button("Create note", type="primary", disabled=not title):
            notes.create_note(title, body=body, owner=owner, pinned=pinned)
            st.success("note created")
            st.rerun()

    note_rows = notes.list_notes(limit=200)

    if not note_rows:
        st.info("No notes yet.")
    else:
        note_labels = {f"{row['title']} ({row['id'][:8]})": row for row in note_rows}
        chosen = st.selectbox("Selected note", list(note_labels))
        note = note_labels[chosen]

        edit_title = st.text_input("Title", value=note["title"], key="edit_note_title")
        edit_body = st.text_area("Body", value=note["body"], key="edit_note_body")
        edit_pinned = st.checkbox("Pinned", value=note["pinned"], key="edit_note_pinned")

        col_save, col_remove = st.columns(2)

        with col_save:
            if st.button("Save note"):
                notes.update_note(
                    note["id"], title=edit_title, body=edit_body, pinned=edit_pinned
                )
                st.success("saved")
                st.rerun()

        with col_remove:
            if st.button("Delete note"):
                notes.delete_note(note["id"])
                st.success("deleted")
                st.rerun()
