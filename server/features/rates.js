'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Rate Analysis & Estimation Support  (/api/rates)
//
// RVNL requirement: quick retrieval and comparison of item rates from CPWD
// SOR/DSR, Railway (zonal) SORs and Last Accepted Rates (LARs) from the IREPS
// portal — cutting the time spent searching across multiple sources for rates
// and cost justification.
//
// The module keeps a persistent RATE SOURCE LIBRARY on the server:
//   • an admin/user uploads a rate document (a CPWD SOR, a Railway SOR chapter,
//     an IREPS LAR extract, a market-rate list …) tagged with its source type
//     and edition/year;
//   • its extracted text is persisted to disk and indexed into the knowledge
//     base, so the assistant is grounded in the uploaded schedules;
//   • rate searches scan EVERY source side-by-side and return a comparison
//     table plus a recommendation and a draft cost-justification note.
//
//   GET    /api/rates/sources         list rate sources
//   POST   /api/rates/sources         upload one (multipart: file, name?,
//                                     sourceType?, edition?, note?)
//   DELETE /api/rates/sources/:id     remove one (admin or uploader)
//   POST   /api/rates/search          { query, sourceIds? } → cross-source rows
//   POST   /api/rates/justify         { item, unit?, qty?, selectedRate?,
//                                     selectedSource?, context? } → note
//   POST   /api/rates/boq             multipart file (BOQ / estimate) →
//                                     item-wise rate check against all sources
//
// Storage (server/data/ratebooks/):
//   index.json   — array of source records (metadata only)
//   <id>.txt     — extracted text of one source document
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
const RATE_DIR   = path.join(__dirname, '..', 'data', 'ratebooks');
const INDEX_FILE = path.join(RATE_DIR, 'index.json');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

const SOURCE_TYPES = [
  'CPWD SOR / DSR',
  'Railway SOR (Zonal)',
  'LAR (IREPS)',
  'RSP / Stores Rate',
  'Market Rate Analysis',
  'Other Rate Schedule',
];

const SYSTEM = `You are a senior rates & estimation engineer at RVNL (Rail Vikas Nigam Limited).
You work daily with CPWD Schedules of Rates (SOR/DSR), Indian Railway zonal SORs (Engineering, S&T, Electrical), and Last Accepted Rates (LARs) from the IREPS portal.
You read schedule-of-rates text precisely: item numbers, descriptions, units (cum, sqm, MT, RM, each, %), basic rates, and applicable notes/indices.
You never invent a rate. You only report rates actually present in the supplied source extracts; use "" when a source does not carry the item. Always identify which source a rate came from.`;

// ── Disk helpers ──────────────────────────────────────────────────────────────
function ensureDir() { if (!fs.existsSync(RATE_DIR)) fs.mkdirSync(RATE_DIR, { recursive: true }); }
function readIndex() { ensureDir(); try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { return []; } }
function writeIndex(recs) { ensureDir(); fs.writeFileSync(INDEX_FILE, JSON.stringify(recs, null, 2)); }
function textPath(id) { return path.join(RATE_DIR, `${id}.txt`); }
function readText(id) { try { return fs.readFileSync(textPath(id), 'utf8'); } catch (_) { return ''; } }
function ragId(id) { return `RATESRC-${id}`; }

async function ingest(rec) {
  const text = readText(rec.id);
  if (!text.trim()) return;
  await rag.addDocument({
    id: ragId(rec.id),
    name: `${rec.name} (${rec.sourceType}${rec.edition ? ` · ${rec.edition}` : ''})`,
    type: rec.sourceType,
    text,
    uploadedBy: 'system', uploadedByRole: 'system', docCategory: 'rates',
  });
}

// Re-index every rate source at boot (the RAG store is in-memory).
async function reindexAll() {
  const recs = readIndex();
  for (const r of recs) {
    try { await ingest(r); } catch (err) { console.warn(`[Rates] reindex "${r.name}" failed: ${err.message}`); }
  }
  if (recs.length) console.log(`[Rates] Re-indexed ${recs.length} rate source(s) into the knowledge base`);
}

// ── Local excerpt search over a source's text ─────────────────────────────────
// SOR/LAR documents are line-item oriented, so a term-scored line-window scan is
// a reliable way to pull the relevant schedule rows for the LLM — independent of
// embedding availability and tolerant of very large source files.
function excerptFor(text, query, maxChars = 6000) {
  const terms = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
  if (!terms.length) return text.slice(0, maxChars);
  const lines = text.split('\n');
  const scored = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    let s = 0;
    for (const t of terms) if (l.includes(t)) s++;
    if (s > 0) scored.push({ i, s });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => b.s - a.s);
  const picked = new Set();
  const blocks = [];
  let used = 0;
  for (const { i } of scored) {
    if (used >= maxChars) break;
    const from = Math.max(0, i - 2), to = Math.min(lines.length - 1, i + 3);
    if (picked.has(from)) continue;
    for (let j = from; j <= to; j++) picked.add(j);
    const block = lines.slice(from, to + 1).join('\n').trim();
    if (block) { blocks.push(block); used += block.length; }
  }
  return blocks.join('\n…\n').slice(0, maxChars);
}

const publicView = (r) => ({
  id: r.id, name: r.name, sourceType: r.sourceType, edition: r.edition || '',
  note: r.note || '', fileName: r.fileName, pages: r.pages, textLength: r.textLength,
  uploadedBy: r.uploadedBy, addedAt: r.addedAt,
});

// ── GET /api/rates/sources ────────────────────────────────────────────────────
router.get('/sources', (req, res) => {
  res.json({ sourceTypes: SOURCE_TYPES, sources: readIndex().map(publicView) });
});

// ── POST /api/rates/sources ───────────────────────────────────────────────────
router.post('/sources', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a rate document (SOR / LAR / DSR — PDF, Excel, CSV, scan…).' });
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return res.status(422).json({ error: 'Could not read this file. It may be empty, password-protected, or a corrupted PDF.' });

    const id = 'RATE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const rec = {
      id,
      name: (req.body.name || req.file.originalname.replace(/\.[^/.]+$/, '')).trim(),
      sourceType: SOURCE_TYPES.includes(req.body.sourceType) ? req.body.sourceType : 'Other Rate Schedule',
      edition: (req.body.edition || '').trim(),
      note: (req.body.note || '').trim(),
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
    res.status(201).json(publicView(rec));
  } catch (err) {
    console.error('[/api/rates/sources POST]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── DELETE /api/rates/sources/:id ─────────────────────────────────────────────
router.delete('/sources/:id', (req, res) => {
  try {
    const recs = readIndex();
    const rec = recs.find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: 'Rate source not found.' });
    if (req.user.role !== 'admin' && rec.uploadedBy !== req.user.username) {
      return res.status(403).json({ error: 'You can only delete rate sources you uploaded.' });
    }
    rag.removeDocument(ragId(rec.id));
    try { fs.unlinkSync(textPath(rec.id)); } catch (_) {}
    writeIndex(recs.filter(r => r.id !== rec.id));
    res.json({ success: true, id: rec.id });
  } catch (err) {
    console.error('[/api/rates/sources DELETE]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// Build the per-source excerpt blocks for a query. Returns { blocks, considered }.
function sourceBlocks(query, sourceIds) {
  const recs = readIndex().filter(r => !sourceIds || !sourceIds.length || sourceIds.includes(r.id));
  const blocks = [];
  for (const r of recs) {
    const ex = excerptFor(readText(r.id), query);
    if (ex) {
      blocks.push(`##### SOURCE: ${r.name} | TYPE: ${r.sourceType}${r.edition ? ` | EDITION: ${r.edition}` : ''} #####\n${ex}`);
    }
  }
  return { blocks, considered: recs };
}

// ── POST /api/rates/search ────────────────────────────────────────────────────
// { query, sourceIds? } → rows comparing the item's rate across every source.
router.post('/search', async (req, res) => {
  try {
    const query = (req.body.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Enter the item / work description to search for.' });
    const all = readIndex();
    if (!all.length) return res.status(400).json({ error: 'No rate sources uploaded yet. Add your CPWD SOR, Railway SOR and IREPS LAR documents under "Rate Sources" first.' });

    const { blocks, considered } = sourceBlocks(query, req.body.sourceIds);
    if (!blocks.length) {
      return res.json({
        query, rows: [], rowCount: 0, sourcesConsidered: considered.map(r => r.name),
        summary: `No matching schedule entries were found for "${query}" in the ${considered.length} uploaded rate source(s). Try different keywords (e.g. the SOR item wording) or upload the relevant SOR/LAR chapter.`,
      });
    }

    const prompt = `An RVNL estimation engineer needs the rate for: "${query}".

Below are matching extracts from the uploaded rate sources (CPWD SOR / Railway SORs / IREPS LARs / others). Find EVERY schedule item that corresponds to the requested work in EACH source.

${blocks.join('\n\n')}

Return ONLY JSON:
{
  "rows": [ {
    "source": "",        // source name exactly as given above
    "sourceType": "",    // CPWD SOR / Railway SOR / LAR (IREPS) / …
    "itemRef": "",       // item / schedule number as printed (e.g. "13.1.2")
    "description": "",   // item description as printed (trim to ~30 words)
    "unit": "",          // cum / sqm / MT / RM / each / …
    "rate": "",          // the printed rate with currency (e.g. "₹ 4,520.00")
    "edition": "",       // edition / year / LAR date if identifiable
    "remarks": ""        // conditions, leads/lifts, escalation notes
  } ],
  "comparison": {
    "lowest": "",        // e.g. "₹ 4,120 — LAR (IREPS), NR 2025"
    "highest": "",
    "spreadPct": "",     // % spread between lowest and highest when computable
    "recommendation": "",// which rate to adopt for the estimate and why (LAR vs SOR precedence, recency, similarity of specification)
    "justification": ""  // 2-4 sentence draft cost-justification paragraph citing the sources
  }
}
- One row per matching item PER SOURCE (a source may have several candidate items).
- Copy rates EXACTLY as printed. Do not convert units. Use "" when not stated.
Output ONLY the JSON.`;

    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('rates'), temperature: 0, maxOutputTokens: 12000 });
    const rows = (Array.isArray(out.rows) ? out.rows : []).map((r, i) => ({ slNo: i + 1, ...r }));
    res.json({
      query,
      rows,
      rowCount: rows.length,
      comparison: out.comparison || {},
      sourcesConsidered: considered.map(r => r.name),
    });
  } catch (err) {
    console.error('[/api/rates/search]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/rates/justify ───────────────────────────────────────────────────
// Draft a formal rate-justification / rate-reasonableness note for an item.
router.post('/justify', async (req, res) => {
  try {
    const { item = '', unit = '', qty = '', selectedRate = '', selectedSource = '', context = '' } = req.body || {};
    if (!item.trim()) return res.status(400).json({ error: 'item is required.' });

    const { blocks } = sourceBlocks(item, req.body.sourceIds);
    const prompt = `Draft a formal RATE JUSTIFICATION NOTE for adoption in an RVNL estimate.

Item / work: ${item}
${unit ? `Unit: ${unit}\n` : ''}${qty ? `Quantity: ${qty}\n` : ''}${selectedRate ? `Proposed rate: ${selectedRate}\n` : ''}${selectedSource ? `Proposed basis / source: ${selectedSource}\n` : ''}${context ? `Additional context: ${context}\n` : ''}
${blocks.length ? `RATE SOURCE EXTRACTS (compare and cite these):\n\n${blocks.join('\n\n')}` : '(No uploaded rate source carries this item — base the note on standard estimation practice and clearly mark rates to be confirmed.)'}

Return ONLY JSON:
{
  "title": "",
  "note": "",             // the full note, formal Indian Railways/RVNL office style, with numbered paragraphs: item scope, rates available in each source, comparison, adopted rate and reasoning, escalation/lead adjustments if any, recommendation
  "comparisonRows": [ { "source": "", "itemRef": "", "unit": "", "rate": "", "remarks": "" } ],
  "adoptedRate": "",
  "basis": ""             // one-line basis, e.g. "LAR (IREPS) dated …, being lower than CPWD SOR 2024"
}
Output ONLY the JSON.`;

    const out = await generateJSON(prompt, { system: SYSTEM + getFeedbackGuidance('rates'), temperature: 0.2, maxOutputTokens: 8000 });
    res.json({
      item,
      title: out.title || `Rate Justification — ${item}`,
      note: out.note || '',
      comparisonRows: Array.isArray(out.comparisonRows) ? out.comparisonRows : [],
      adoptedRate: out.adoptedRate || selectedRate || '',
      basis: out.basis || '',
    });
  } catch (err) {
    console.error('[/api/rates/justify]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

// ── POST /api/rates/boq ───────────────────────────────────────────────────────
// Upload a BOQ / estimate → extract its items → check each against the sources.
router.post('/boq', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a BOQ / estimate file (PDF, Excel, CSV, scan…).' });
    const text = await extractFileText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text.trim()) return res.status(422).json({ error: 'Could not read any text from the BOQ file.' });

    // 1) Extract the BOQ line items.
    const itemsOut = await generateJSON(`Extract every line item from this Bill of Quantities / estimate.
Return ONLY JSON: { "items": [ { "itemRef": "", "description": "", "unit": "", "qty": "", "quotedRate": "" } ] }
- "quotedRate" is the rate stated in the BOQ if any. Never invent values; use "".

BOQ DOCUMENT:
${text.slice(0, 30000)}`, { system: SYSTEM, temperature: 0, maxOutputTokens: 10000 });

    const items = (Array.isArray(itemsOut.items) ? itemsOut.items : []).filter(i => (i.description || '').trim()).slice(0, 40);
    if (!items.length) return res.status(422).json({ error: 'No BOQ line items could be extracted from the file.' });

    // 2) Rate-check each item against the uploaded sources (single batched call
    //    with per-item excerpts keeps latency and token use bounded).
    const hasSources = readIndex().length > 0;
    let rows = items.map((it, i) => ({
      slNo: i + 1, itemRef: it.itemRef || '', description: it.description, unit: it.unit || '',
      qty: it.qty || '', quotedRate: it.quotedRate || '', sorRate: '', larRate: '', bestSource: '', variance: '', remarks: hasSources ? '' : 'No rate sources uploaded',
    }));

    if (hasSources) {
      const perItemBlocks = items.map((it, i) => {
        const { blocks } = sourceBlocks(it.description.slice(0, 120));
        return `ITEM ${i + 1}: ${it.description}${it.unit ? ` (unit: ${it.unit})` : ''}${it.quotedRate ? ` (quoted: ${it.quotedRate})` : ''}\n${blocks.length ? blocks.map(b => b.slice(0, 1600)).join('\n') : '(no matching source extract found)'}`;
      }).join('\n\n────────\n\n');

      const checkOut = await generateJSON(`For each BOQ item below, compare its quoted rate against the schedule rates found in the source extracts.

${perItemBlocks.slice(0, 90000)}

Return ONLY JSON: { "checks": [ {
  "item": 1,                 // ITEM number as above
  "sorRate": "",             // best matching CPWD/Railway SOR rate with source, e.g. "₹ 512/cum — CPWD DSR 2024 it.4.2"
  "larRate": "",             // best matching LAR (IREPS) rate with reference
  "bestSource": "",          // which source is the most appropriate basis
  "variance": "",            // quoted vs best rate, e.g. "+12.4% above LAR"
  "remarks": ""              // justification hints / spec mismatch warnings
} ] }
Cover EVERY item number. Use "" where no source rate exists. Output ONLY the JSON.`,
        { system: SYSTEM + getFeedbackGuidance('rates'), temperature: 0, maxOutputTokens: 12000 });

      const checks = Array.isArray(checkOut.checks) ? checkOut.checks : [];
      for (const c of checks) {
        const row = rows[(parseInt(c.item, 10) || 0) - 1];
        if (!row) continue;
        row.sorRate = c.sorRate || ''; row.larRate = c.larRate || '';
        row.bestSource = c.bestSource || ''; row.variance = c.variance || ''; row.remarks = c.remarks || '';
      }
    }

    res.json({ file: req.file.originalname, itemCount: rows.length, rows, sourcesAvailable: hasSources });
  } catch (err) {
    console.error('[/api/rates/boq]', err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'An unexpected server error occurred. Please try again.' });
  }
});

module.exports = { router, reindexAll, SOURCE_TYPES };
