"""
OpenPDF Editor — FastAPI Backend (Visual Editor)
Endpoints:
  POST /upload       → receive PDF, extract text spans, store in-memory, return metadata
  GET  /pdf/{fid}    → serve the stored raw PDF for PDF.js
  POST /apply-edits  → receive original file id + edits list, return modified PDF
"""

import io
import uuid
from typing import Optional

import fitz  # PyMuPDF
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="OpenPDF Editor", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory PDF storage  (keyed by UUID string → raw bytes)
# ---------------------------------------------------------------------------
pdf_store: dict[str, bytes] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_pdf(data: bytes) -> fitz.Document:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not open PDF: {exc}")
    if doc.is_encrypted:
        doc.close()
        raise HTTPException(status_code=422, detail="This PDF is encrypted / password-protected.")
    return doc


def _extract_text_metadata(doc: fitz.Document) -> list[dict]:
    """Return per-page text span metadata for the overlay layer."""
    pages = []
    for page_idx, page in enumerate(doc):
        pw = page.rect.width
        ph = page.rect.height
        spans_out = []
        blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if block.get("type") != 0:  # skip image blocks
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    bbox = span["bbox"]  # (x0, y0, x1, y1) — top-left origin
                    # Convert color int to hex
                    c = span.get("color", 0)
                    r = (c >> 16) & 0xFF
                    g = (c >> 8) & 0xFF
                    b = c & 0xFF
                    color_hex = f"#{r:02x}{g:02x}{b:02x}"

                    spans_out.append({
                        "text": text,
                        "x0": round(bbox[0], 2),
                        "y0": round(bbox[1], 2),
                        "x1": round(bbox[2], 2),
                        "y1": round(bbox[3], 2),
                        "fontSize": round(span.get("size", 12), 2),
                        "font": span.get("font", "Helvetica"),
                        "color": color_hex,
                    })
        pages.append({
            "page": page_idx + 1,
            "width": round(pw, 2),
            "height": round(ph, 2),
            "spans": spans_out,
        })
    return pages


def _hex_to_rgb(hex_str: str) -> tuple:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        return (0, 0, 0)
    return (int(hex_str[0:2], 16) / 255, int(hex_str[2:4], 16) / 255, int(hex_str[4:6], 16) / 255)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
async def health():
    return {"status": "ok", "service": "OpenPDF Editor v2"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Store the PDF and return text-span metadata for every page.
    """
    data = await file.read()
    doc = _open_pdf(data)

    # Check for text
    has_text = any(page.get_text("text").strip() for page in doc)

    metadata = _extract_text_metadata(doc)
    doc.close()

    file_id = str(uuid.uuid4())
    pdf_store[file_id] = data

    return JSONResponse({
        "fileId": file_id,
        "fileName": file.filename,
        "pageCount": len(metadata),
        "hasText": has_text,
        "pages": metadata,
    })


@app.get("/pdf/{file_id}")
async def get_pdf(file_id: str):
    """Serve the raw PDF so PDF.js can render it."""
    data = pdf_store.get(file_id)
    if data is None:
        raise HTTPException(status_code=404, detail="PDF not found. Please re-upload.")
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@app.post("/apply-edits")
async def apply_edits(
    file_id: str = Form(...),
    edits_json: str = Form(...),
):
    """
    Apply a list of text edits and return the modified PDF.

    edits_json is a JSON string: [
      { "page": 1, "x0": ..., "y0": ..., "x1": ..., "y1": ...,
        "oldText": "...", "newText": "...", "fontSize": 12, "color": "#000000" }
    ]
    """
    import json

    data = pdf_store.get(file_id)
    if data is None:
        raise HTTPException(status_code=404, detail="PDF not found. Please re-upload.")

    try:
        edits = json.loads(edits_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid edits JSON.")

    if not edits:
        raise HTTPException(status_code=422, detail="No edits provided.")

    doc = _open_pdf(data)

    for edit in edits:
        page_idx = edit["page"] - 1
        if page_idx < 0 or page_idx >= len(doc):
            continue
        page = doc[page_idx]

        rect = fitz.Rect(edit["x0"], edit["y0"], edit["x1"], edit["y1"])
        font_size = edit.get("fontSize", 12)
        color = _hex_to_rgb(edit.get("color", "#000000"))
        new_text = edit.get("newText", "")

        # Redact the old text area
        page.add_redact_annot(rect, fill=(1, 1, 1))
        page.apply_redactions()

        # Insert new text at the original position
        # y1 is the baseline-ish position; offset slightly up
        insert_point = fitz.Point(rect.x0, rect.y1 - 2)
        page.insert_text(
            insert_point,
            new_text,
            fontsize=font_size,
            fontname="helv",
            color=color,
        )

    buf = io.BytesIO()
    doc.save(buf, garbage=4, deflate=True)
    doc.close()
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="edited.pdf"'},
    )
