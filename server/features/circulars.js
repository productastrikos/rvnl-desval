'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Railway Guidelines & Amendment Tracking  (/api/circulars)
//
// RVNL requirement: identify, track and summarize the latest railway
// guidelines, circulars and amendments (Railway Board, RDSO, CPWD, zonal
// railways, Metro rail authorities …) so project teams always work with the
// most recent requirements.
//
// Every uploaded circular/guideline is:
//   • text-extracted and PERSISTED on the server (registry survives restarts),
//   • auto-analysed by the AI into registry metadata — issuing authority,
//     reference number, issue date, subject, what it supersedes/amends and the
//     key changes it introduces,
//   • indexed into the knowledge base so the assistant and the compliance
//     tools are grounded in the latest requirements.
//
//   GET    /api/circulars              list registry (q / category / authority)
//   POST   /api/circulars              upload one (multipart: file, category?)
//   GET    /api/circulars/:id          full record incl. text preview
//   DELETE /api/circulars/:id          remove (admin or uploader)
//   POST   /api/circulars/digest       { topic } → consolidated "latest
//                                      applicable requirements" briefing with
//                                      the amendment trail for that topic
//
// Storage (server/data/circulars/): index.json + <id>.txt
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const rag = require('../rag');
const { extractFileText } = require('../lib/extract');
const { generateJSON } = require('../lib/llm');
const { getFeedbackGuidance } = require('./feedback');
const { MAX_UPLOAD_BYTES } = require('../lib/limits');

const router = express.Router();
const CIRC_DIR   = path.join(__dirname, '..', 'data', 'circulars');
const INDEX_FILE = path.join(CIRC_DIR, 'index.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const CATEGORIES = [
  'Railway Board Circular',
  'RDSO Guideline / Specification',
  'Zonal Railway Circular',
  'CPWD / Works Manual',
  'Safety Circular',
  'Amendment / Correction Slip',
  'Policy / JPO',
  'Other Guideline',
];

const SYSTEM = `You are a documentation and compliance officer at RVNL (Rail Vikas Nigam Limited).
You read Indian Railways circulars, Railway Board letters, RDSO guidelines/specifications, correction slips and CPWD directives, and maintain an amendment-tracked registry of them.
You extract reference numbers, dates and supersession/amendment relationships exactly as printed. You never invent references.`;

// ── Disk helpers ──────────────────────────────────────────────────────────────
function ensureDir() { if (!fs.existsSync(CIRC_DIR)) fs.mkdirSync(CIRC_DIR, { recursive: true }); }
function readIndex() { ensureDir(); try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { return []; } }
function writeIndex(recs) { ensureDir(); fs.writeFileSync(INDEX_FILE, JSON.stringify(recs, null, 2)); }
function textPath(id) { return path.join(CIRC_DIR, `${id}.txt`); }
function readText(id) { try { return fs.readFileSync(textPath(id), 'utf8'); } catch (_) { return ''; } }
function ragId(id) { return `CIRCULAR-${id}`; }

async function ingest(rec) {
  const text = readText(rec.id);
  if (!text.trim()) return;
  await rag.addDocument({
    id: ragId(rec.id),
    name: `${rec.refNo ? rec.refNo + ' — ' : ''}${rec.subject || rec.name}`,
    type: rec.category,
    text,
    uploadedBy: 'system', uploadedByRole: 'system', docCategory: 'guidelines',
  });
}

async function reindexAll() {
  const recs = readIndex();
  for (const r of recs) {
    try { await ingest(r); } catch (err) { console.warn(`[Circulars] reindex "${r.name}" failed: ${err.message}`); }
  }
  if (recs.length) console.log(`[Circulars] Re-indexed ${recs.length} circular(s)/guideline(s) into the knowledge base`);
}

// Mark records that a later upload claims to supersede/amend, so the registry
// list can flag potentially outdated guidance at a glance.
function applySupersession(recs) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byRef = new Map();
  for (const r of recs) if (r.refNo) byRef.set(norm(r.refNo), r);
  for (const r of recs) { r.supersededBy = r.supersededBy || ''; }
  for (const r of recs) {
    for (const ref of [...(r.supersedes || []), ...(r.amends || [])]) {
      const t = byRef.get(norm(ref));
      if (t && t.id !== r.id) t.supersededBy = r.refNo || r.name;
    }
  }
  return recs;
}

const publicView = (r) => ({
  id: r.id, name: r.name, category: r.category, authority: r.authority || '',
  refNo: r.refNo || '', issueDate: r.issueDate || '', subject: r.subject || '',
  supersedes: r.supersedes || [], amends: r.amends || [], keyChanges: r.keyChanges || [],
  applicability: r.applicability || '', summary: r.summary || '',
  supersededBy: r.supersededBy || '',
  fileName: r.fileName, pages: r.pages, textLength: r.textLength,
  uploadedBy: r.uploadedBy, addedAt: r.addedAt,
});

// ── GET /api/circulars ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { q = '', category = '', authority = '' } = req.query;
  let recs = applySupersession(readIndex());
  if (category)  recs = recs.filter(r => r.category === category);
  if (authority) recs = recs.filter(r => (r.authority || '').toLowerCase().includes(String(authority).toLowerCase()));
  if (q.trim()) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    recs = recs.filter(r => {
      const hay = [r.name, r.refNo, r.subject, r.authority, r.summary, (r.keyChanges || []).join(' ')].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  res.json({ categories: CATEGORIES, total: readIndex().length, count: recs.length, circulars: recs.map(publicView) });
});

// ── POST /api/circulars ───────────────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a circular / guideline file (PDF, scan, DOCX…).' });
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted PDF.' });

    // AI registry-metadata extraction — best effort; the record is stored even
    // when analysis fails so the document is never lost.
    let meta = {};
    try {
      meta = await generateJSON(`Analyse this railway circular / guideline / amendment for the RVNL registry.

Return ONLY JSON:
{
  "authority": "",       // issuing body, e.g. "Railway Board", "RDSO", "CPWD", "Central Railway"
  "refNo": "",           // letter/circular number exactly as printed, e.g. "2024/CE-I/CT/3"
  "issueDate": "",       // as printed; add ISO form in brackets if certain
  "subject": "",         // the subject line
  "category": "",        // one of: ${CATEGORIES.join(' | ')}
  "supersedes": [""],    // reference numbers this document supersedes/cancels (exact strings; [] if none)
  "amends": [""],        // reference numbers it amends/partially modifies ([] if none)
  "keyChanges": [""],    // 3-8 bullet points: what changed / what is now required
  "applicability": "",   // who/what it applies to (works, contracts, disciplines, zones)
  "summary": ""          // 3-5 sentence executive summary for a project team
}
Copy references EXACTLY as printed. Use ""/[] when not stated.

DOCUMENT (${req.file.originalname}):
${text.slice(0, 28000)}`, { system: SYSTEM, temperature: 0, maxOutputTokens: 6000 });
    } catch (err) {
      console.warn('[Circulars] metadata extraction failed:', err.message);
    }

    const id = 'CIRC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const rec = {
      id,
      name: req.file.originalname.replace(/\.[^/.]+$/, ''),
      category: CATEGORIES.includes(req.body.category) ? req.body.category
              : (CATEGORIES.includes(meta.category) ? meta.category : 'Other Guideline'),
      authority: meta.authority || '',
      refNo: meta.refNo || '',
      issueDate: meta.issueDate || '',
      subject: meta.subject || '',
      supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
      amends: Array.isArray(meta.amends) ? meta.amends.filter(Boolean) : [],
      keyChanges: Array.isArray(meta.keyChanges) ? meta.keyChanges.filter(Boolean) : [],
      applicability: meta.applicability || '',
      summary: meta.summary || '',
      fileName: req.file.originalname,
      pages: Math.ceil(text.length / 3000),
      textLength: text.length,
      uploadedBy: req.user?.username || 'unknown',
      addedAt: new Date().toISOString(),
    };

    ensureDir();
    fs.writeFileSync(textPath(id), text);
    const recs = readIndex(); recs.unshift(rec); writeIndex(recs);
    await ingest(rec);
    res.status(201).json(publicView(applySupersession(readIndex()).find(r => r.id === id) || rec));
  } catch (err) {
    console.error('[/api/circulars POST]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/circulars/digest ───────────────────────────────────────────────
// Consolidated "what currently applies" briefing for a topic, with the
// amendment trail assembled from the registry (and the wider knowledge base).
router.post('/digest', async (req, res) => {
  try {
    const topic = (req.body.topic || '').trim();
    if (!topic) return res.status(400).json({ error: 'Enter the topic to brief on (e.g. "ballastless track", "OHE mast foundations", "EPC contract variations").' });

    const recs = applySupersession(readIndex());
    const terms = topic.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scored = recs.map(r => {
      const hay = [r.name, r.refNo, r.subject, r.summary, (r.keyChanges || []).join(' '), r.applicability].join(' ').toLowerCase();
      return { r, s: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 10);

    const pool = scored.length ? scored.map(x => x.r) : recs.slice(0, 8);
    const regBlock = pool.length
      ? pool.map((r, i) => `[${i + 1}] ${r.refNo || r.name} · ${r.authority || '—'} · ${r.issueDate || 'date n/a'}${r.supersededBy ? ` · ⚠ superseded by ${r.supersededBy}` : ''}\nSubject: ${r.subject || '—'}\nKey changes: ${(r.keyChanges || []).join('; ') || '—'}\nSummary: ${r.summary || '—'}`).join('\n\n')
      : '(Registry is empty — no circulars uploaded yet.)';

    // Ground in the indexed circular/guideline text too.
    const hits = await rag.retrieve(topic, 6).catch(() => []);
    const kbBlock = hits.length
      ? hits.map((c, i) => `--- [${i + 1}] ${c.source} ---\n${c.text}`).join('\n\n')
      : '';

    const prompt = `Brief an RVNL project team on the CURRENT applicable guidance for: "${topic}".

REGISTRY OF TRACKED CIRCULARS / GUIDELINES (with supersession flags):
${regBlock}
${kbBlock ? `\nRELEVANT EXTRACTS FROM THE INDEXED DOCUMENTS:\n${kbBlock}\n` : ''}
Return ONLY JSON:
{
  "summary": "",                       // 3-6 sentences: what currently governs this topic
  "currentRequirements": [ { "requirement": "", "reference": "", "since": "" } ],
  "amendmentTrail": [ { "reference": "", "date": "", "status": "In force | Superseded | Amended", "note": "" } ],  // newest first
  "watchouts": [ "" ],                 // items marked superseded, gaps, or documents the team should obtain
  "actions": [ "" ]                    // concrete next steps for the project team
}
- Base everything on the registry/extracts above. Where the registry is silent, say so in "watchouts" rather than inventing a circular.
Output ONLY the JSON.`;

    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('circulars'), temperature: 0.2, maxOutputTokens: 8000 });
    res.json({
      topic,
      registryMatches: scored.length,
      summary: out.summary || '',
      currentRequirements: Array.isArray(out.currentRequirements) ? out.currentRequirements : [],
      amendmentTrail: Array.isArray(out.amendmentTrail) ? out.amendmentTrail : [],
      watchouts: Array.isArray(out.watchouts) ? out.watchouts : [],
      actions: Array.isArray(out.actions) ? out.actions : [],
      citations: [...new Set(hits.map(h => h.source))],
    });
  } catch (err) {
    console.error('[/api/circulars/digest]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── GET /api/circulars/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const rec = applySupersession(readIndex()).find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Circular not found.' });
  res.json({ ...publicView(rec), text: readText(rec.id).slice(0, 60000) });
});

// ── DELETE /api/circulars/:id ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const recs = readIndex();
    const rec = recs.find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: 'Circular not found.' });
    if (req.user.role !== 'admin' && rec.uploadedBy !== req.user.username) {
      return res.status(403).json({ error: 'You can only delete circulars you uploaded.' });
    }
    rag.removeDocument(ragId(rec.id));
    try { fs.unlinkSync(textPath(rec.id)); } catch (_) {}
    writeIndex(recs.filter(r => r.id !== rec.id));
    res.json({ success: true, id: rec.id });
  } catch (err) {
    console.error('[/api/circulars/:id DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = { router, reindexAll, CATEGORIES };
