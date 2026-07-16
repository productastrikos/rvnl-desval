# RVNL Project Intelligence

An AI-driven works-intelligence platform for **Rail Vikas Nigam Limited (RVNL)**, built around
four capabilities:

1. **Rate Analysis & Estimation Support** — quick retrieval and side-by-side comparison of item
   rates from CPWD SORs/DSR, Railway zonal SORs and Last Accepted Rates (LARs) from the IREPS
   portal, plus draft cost-justification notes and BOQ rate checks.
2. **Railway Guidelines & Amendment Tracking** — a living registry of Railway Board, RDSO, zonal
   railway and CPWD circulars/guidelines. Every upload is auto-summarised, supersession/amendment
   links are tracked, and a "latest requirements" digest keeps teams on the current guidance.
3. **Drawing Compliance Verification** — consultant/DDC-submitted drawings (PDF, scans, images,
   AutoCAD .dwg/.dxf) are reviewed against the latest Indian Railways standards indexed in the
   knowledge base, with non-compliances highlighted and the governing reference cited. Includes
   drawing data extraction, revision comparison and standards-grounded review checklists.
4. **Multi-Contract Knowledge Management** — a centralized Knowledge Hub and contract-wise
   workspace (civil, S&T, electrical …) with a persistent shared repository, plus a cross-contract
   Decisions & Lessons register.

Everything runs on the local appliance. Language and vision processing are performed by an
**on-premise inference engine**; documents, queries and credentials never leave the network.

---

## 1. How it works

### On-premise inference engine
All generation and document understanding runs server-side through a single local engine
(`server/lib/llm.js`). The browser never receives credentials or raw model output beyond the
finished answer. Vision-capable requests receive page images so scanned pages, figures and
drawings can be read.

### Knowledge base
The retrieval engine (hybrid BM25 keyword search + local semantic embeddings, fused with RRF and
diversified with MMR) is grounded in the references the teams maintain **inside the app**:

- **Standards & Codes** (admin, version-controlled): RDSO specifications, IRS codes, the Schedule
  of Dimensions, IR manuals (IRPWM/IRBM/ACTM…), CPWD and IS/EN standards. Only the *active*
  version of each document is searched, so answers always reflect the current edition.
- **Guidelines & Circulars registry**: every tracked circular's text is indexed on upload.
- **Rate sources**: every uploaded SOR/LAR schedule is indexed for retrieval and scanned directly
  by the rate-search tools.

Any PDF placed in `server/docs/` is additionally pre-ingested at boot as built-in reference
material (the directory ships empty).

### Your documents (browser-held)
Day-to-day documents are uploaded on the **Knowledge Hub** page. On upload the server:
1. extracts the text layer page-by-page, and
2. sends any page that has no usable text (scanned pages, image-only pages) to the **vision
   model** for extraction, then
3. **auto-detects the document type** (SOR / LAR / circular / drawing / estimate / tender /
   contract / report) from the content.

The extracted content is stored in the browser and stays available to every tool for the rest of
the session; ticking "Save to shared repository" persists it server-side for all users across
sessions. **Signing out clears the browser-held documents.**

---

## 2. Project layout

```
RVNL_desval/
├── server/
│   ├── index.js              # API routes, upload + auto-classification, RAG wiring
│   ├── rag/                  # Hybrid BM25 + semantic retrieval engine
│   ├── docs/                 # Optional pre-ingested reference PDFs (ships empty)
│   ├── lib/
│   │   ├── llm.js            # On-premise inference engine (text + vision)
│   │   ├── extract.js        # Per-page text + vision OCR for image-only pages
│   │   ├── rasterize.js      # PDF → page images (for the vision model)
│   │   └── excel.js          # Workbook generation
│   ├── features/
│   │   ├── rates.js          # Rate source library + SOR/LAR search, justification, BOQ check
│   │   ├── circulars.js      # Guidelines registry + amendment tracking + digest
│   │   ├── drawings.js       # Drawing compliance verification + extraction + comparison
│   │   ├── designreview.js   # Standards-grounded review checklists + risk register
│   │   ├── lessons.js        # Decisions & lessons register
│   │   ├── repository.js     # Persistent shared document repository
│   │   └── rulebooks.js      # Standards & codes library with version control (admin)
│   ├── auth/                 # JWT auth + user store
│   └── .env                  # Local engine credentials (server-side only; gitignored)
└── client/
    └── src/
        ├── pages/            # Dashboard, Railway Assistant, Rates, Circulars, Drawings, Hub…
        ├── components/       # Layout + shared feature UI kit
        └── services/
            ├── aiService.js  # Fetch calls to the backend
            ├── featureApi.js # Feature-route clients
            └── docStore.js   # Browser document store (IndexedDB)
```

---

## 3. Running it

From the project root:

```
npm run dev
```

This starts the API server (port 5001) and the client (port 3000) together. In production the
server also serves the built client from `client/build`.

### Configuration

The local engine credentials live in `server/.env` (server-side only, never sent to the browser):

```
LLM_API_KEY=...            # required
LLM_BASE_URL=...           # optional override
LLM_MODEL=...              # optional override
LLM_VISION_MODEL=...       # optional override
PORT=5001
```

Use **Settings → Test Connection** to confirm the engine is online and the knowledge base has
loaded.

### First-time setup for a project office

1. Sign in as admin and add users (department-wise) under **User Management**.
2. Upload the standards you review against under **Settings → Standards & Codes** (rulebooks API).
3. Add rate schedules under **Rate Analysis → Rate Sources** (CPWD SOR, zonal SORs, IREPS LARs).
4. Add the circulars your contracts work to under **Guidelines & Circulars**.

---

## 4. Roles

Two roles, authenticated with JWT (8-hour expiry):

- **Administrator** — all pages plus User Management, Audit Log and Standards & Codes.
- **Project Engineer** — all analysis pages.

Default accounts are created on first boot (`server/data/users.json`):
`admin / admin123` and `engineer1 / engineer123`.

---

## 5. Security model

- All inference runs locally on the appliance; there is no user-facing cloud configuration.
- Session documents are held only in the browser and are wiped on logout; repository documents
  persist server-side by explicit choice.
- All API routes require a bearer token except login and the health check.
- Every meaningful action is captured in the admin audit trail.
