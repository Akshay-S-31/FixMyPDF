/**
 * OpenPDF Editor — V2 Visual Editor Logic
 */

const API_BASE = "http://localhost:8000";

let currentFileId = null;
let currentFileName = "";
let currentPagesMetadata = [];
let editsList = [];

// ── DOM Elements ─────────────────────────────────────────────────────
const screenUpload = document.getElementById("screen-upload");
const screenEditor = document.getElementById("screen-editor");

const dropZone = document.getElementById("drop-zone");
const fileUpload = document.getElementById("file-upload");
const uploadFileName = document.getElementById("upload-file-name");
const btnStart = document.getElementById("btn-start");

const btnBack = document.getElementById("btn-back");
const editorFilename = document.getElementById("editor-filename");
const pageInfo = document.getElementById("page-info");
const editsBadge = document.getElementById("edits-badge");
const btnSave = document.getElementById("btn-save");
const pdfViewport = document.getElementById("pdf-viewport");

// ── Upload Screen Logic ─────────────────────────────────────────────

fileUpload.addEventListener("change", () => {
  if (fileUpload.files.length) {
    dropZone.classList.add("has-file");
    uploadFileName.textContent = `✅ ${fileUpload.files[0].name}`;
    btnStart.disabled = false;
  } else {
    dropZone.classList.remove("has-file");
    uploadFileName.textContent = "";
    btnStart.disabled = true;
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    fileUpload.files = e.dataTransfer.files;
    fileUpload.dispatchEvent(new Event("change"));
  }
});

btnStart.addEventListener("click", async () => {
  if (!fileUpload.files.length) return;
  const file = fileUpload.files[0];
  
  btnStart.classList.add("loading");
  try {
    const formData = new FormData();
    formData.append("file", file);
    
    const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
    if (!res.ok) throw new Error(await extractError(res));
    
    const data = await res.json();
    currentFileId = data.fileId;
    currentFileName = data.fileName;
    currentPagesMetadata = data.pages;
    editsList = [];
    
    updateEditsBadge();
    editorFilename.textContent = currentFileName;
    pageInfo.textContent = `${data.pageCount} page${data.pageCount !== 1 ? 's' : ''}`;
    
    screenUpload.classList.add("hidden");
    screenEditor.classList.remove("hidden");
    
    await renderPDF();
    
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, "error");
  } finally {
    btnStart.classList.remove("loading");
  }
});

// ── Editor Screen Logic ─────────────────────────────────────────────

btnBack.addEventListener("click", () => {
  screenEditor.classList.add("hidden");
  screenUpload.classList.remove("hidden");
  pdfViewport.innerHTML = "";
  fileUpload.value = "";
  fileUpload.dispatchEvent(new Event("change"));
});

async function renderPDF() {
  pdfViewport.innerHTML = '<div style="margin:auto; padding:2rem;">Loading PDF...</div>';
  try {
    const pdfUrl = `${API_BASE}/pdf/${currentFileId}`;
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdfDoc = await loadingTask.promise;
    
    pdfViewport.innerHTML = "";
    
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      await renderPage(page, i);
    }
  } catch (err) {
    pdfViewport.innerHTML = `<div style="color:var(--error); margin:auto; padding:2rem;">Error loading PDF: ${err.message}</div>`;
  }
}

async function renderPage(pdfPage, pageNum) {
  const scale = 1.5;
  const viewport = pdfPage.getViewport({ scale });
  
  const wrapper = document.createElement("div");
  wrapper.className = "page-wrapper";
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;
  
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  wrapper.appendChild(canvas);
  
  const overlay = document.createElement("div");
  overlay.className = "text-overlay";
  wrapper.appendChild(overlay);
  
  const label = document.createElement("div");
  label.className = "page-label";
  label.textContent = `Page ${pageNum}`;
  
  pdfViewport.appendChild(label);
  pdfViewport.appendChild(wrapper);
  
  const renderContext = {
    canvasContext: canvas.getContext('2d'),
    viewport: viewport
  };
  await pdfPage.render(renderContext).promise;
  
  // Add interactive text spans
  const pageMeta = currentPagesMetadata.find(p => p.page === pageNum);
  if (pageMeta) {
    const scaleX = viewport.width / pageMeta.width;
    const scaleY = viewport.height / pageMeta.height;
    
    pageMeta.spans.forEach(span => {
      const domX = span.x0 * scaleX;
      const domY = span.y0 * scaleY;
      const domW = (span.x1 - span.x0) * scaleX;
      const domH = (span.y1 - span.y0) * scaleY;
      const domFontSize = span.fontSize * scaleY;
      
      const el = document.createElement("div");
      el.className = "text-span";
      el.contentEditable = true;
      el.spellcheck = false;
      el.title = "Click to edit text";
      
      el.style.left = `${domX}px`;
      el.style.top = `${domY}px`;
      el.style.width = `${domW + 2}px`; // slight padding
      el.style.height = `${domH + 2}px`;
      el.style.fontSize = `${domFontSize}px`;
      el.style.fontFamily = span.font || 'sans-serif';
      el.style.lineHeight = `${domH}px`;
      
      // Store original data
      el.dataset.origText = span.text;
      el.dataset.x0 = span.x0;
      el.dataset.y0 = span.y0;
      el.dataset.x1 = span.x1;
      el.dataset.y1 = span.y1;
      el.dataset.fontSize = span.fontSize;
      el.dataset.color = span.color;
      el.dataset.page = pageNum;
      
      el.innerText = span.text;
      
      el.addEventListener("focus", () => {
        el.classList.add("editing");
      });
      
      el.addEventListener("blur", () => {
        el.classList.remove("editing");
        const newText = el.innerText.replace(/\n/g, '');
        if (newText !== el.dataset.origText) {
          el.classList.add("edited");
          recordEdit(el, newText);
        } else {
          el.classList.remove("edited");
          removeEdit(el);
        }
      });
      
      overlay.appendChild(el);
    });
  }
}

function recordEdit(el, newText) {
  const editId = `${el.dataset.page}-${el.dataset.x0}-${el.dataset.y0}`;
  const existing = editsList.find(e => e.id === editId);
  if (existing) {
    existing.newText = newText;
  } else {
    editsList.push({
      id: editId,
      page: parseInt(el.dataset.page),
      x0: parseFloat(el.dataset.x0),
      y0: parseFloat(el.dataset.y0),
      x1: parseFloat(el.dataset.x1),
      y1: parseFloat(el.dataset.y1),
      fontSize: parseFloat(el.dataset.fontSize),
      color: el.dataset.color,
      oldText: el.dataset.origText,
      newText: newText
    });
  }
  updateEditsBadge();
}

function removeEdit(el) {
  const editId = `${el.dataset.page}-${el.dataset.x0}-${el.dataset.y0}`;
  editsList = editsList.filter(e => e.id !== editId);
  updateEditsBadge();
}

function updateEditsBadge() {
  if (editsList.length > 0) {
    editsBadge.textContent = `${editsList.length} edit${editsList.length > 1 ? 's' : ''}`;
    editsBadge.classList.add("show");
  } else {
    editsBadge.classList.remove("show");
  }
}

btnSave.addEventListener("click", async () => {
  if (editsList.length === 0) {
    showToast("No edits to save.", "info");
    return;
  }
  
  btnSave.classList.add("loading");
  try {
    const formData = new FormData();
    formData.append("file_id", currentFileId);
    formData.append("edits_json", JSON.stringify(editsList));
    
    const res = await fetch(`${API_BASE}/apply-edits`, { method: "POST", body: formData });
    if (!res.ok) throw new Error(await extractError(res));
    
    const blob = await res.blob();
    downloadBlob(blob, `edited_${currentFileName}`);
    showToast("PDF edited & downloaded successfully!", "success");
  } catch (err) {
    showToast(`Save failed: ${err.message}`, "error");
  } finally {
    btnSave.classList.remove("loading");
  }
});


// ── Utilities ────────────────────────────────────────────────────────

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const icons = { success: "✅", error: "❌", info: "ℹ️" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ""}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function extractError(response) {
  try {
    const data = await response.json();
    return data.detail || JSON.stringify(data);
  } catch {
    return `Server error (${response.status})`;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
