# FixMyPDF

**FixMyPDF** is a lightweight, fully local, and private visual PDF editor. It allows you to upload a PDF, click on any text directly in the document, and seamlessly edit it in your browser. All processing happens locally on your machine, ensuring your sensitive documents never leave your computer.

---

##  Features
- **Visual Editing:** Edit PDF text just like a word processor. Click any text on the page to change it.
- **Privacy First:** No external APIs or cloud servers. The entire app runs locally on your machine.
- **Precision Replacement:** Maintains the original font sizes, colors, and precise coordinates of the text you modify.
- **Zero Watermarks:** Completely free, open-source, and unrestricted.

---

##  How It Works
FixMyPDF consists of two decoupled components working together:

1. **FastAPI Backend (`/backend`)**
   - Utilizes **PyMuPDF (fitz)** to extract the raw text and its exact bounding box coordinates (x, y, width, height), font sizes, and colors.
   - Stores the PDF in memory during the session.
   - When edits are submitted, it programmatically applies a "redaction" layer to erase the original text and stamps the new text exactly where the old text used to be.

2. **Vanilla JavaScript Frontend (`/frontend`)**
   - Uses **Mozilla's PDF.js** to natively render the document onto an HTML5 `<canvas>`.
   - Takes the raw coordinates from the backend, scales them to the screen's viewport size, and overlays invisible `contenteditable` HTML `<div>` elements perfectly on top of the original text.
   - When a user clicks, the `<div>` becomes opaque, allowing for a seamless real-time visual editing experience.

---

##  How to Run

### Prerequisites
- Python 3.10+ installed on your system.

### 1. Start the Backend Server
Open a terminal, navigate to the `backend` folder, install the dependencies, and start the FastAPI server:

```bash
cd FixMyPDF/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
*The backend will now be running on `http://localhost:8000`.*

### 2. Start the Frontend Server
Open a **new** terminal window, navigate to the `frontend` folder, and start a simple static file server:

```bash
cd FixMyPDF/frontend
python -m http.server 8080
```
*The frontend will now be hosted on `http://localhost:8080`.*

### 3. Open the Editor
Finally, open your web browser and go to:
**http://localhost:8080**

Drop your PDF into the upload zone, click **Open Editor**, and start typing!
