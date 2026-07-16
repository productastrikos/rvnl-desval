'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Automatic document-type classification (shared)
// The upload page never asks the user what kind of document they are uploading;
// we infer it from the content. Heuristics first (fast, deterministic), with an
// inference fallback for anything ambiguous. Used by both the single-document
// upload endpoint and the persistent shared repository.
// ─────────────────────────────────────────────────────────────────────────────

const { generateText } = require('./llm');

const DOC_TYPES = [
  'SOR / Rate Schedule', 'LAR (IREPS)', 'Circular / Guideline', 'Technical Specification',
  'Drawing', 'Estimate / BOQ', 'Tender / Bid Document', 'Contract Agreement',
  'Inspection / Site Report', 'General Document',
];

// Weighted signals per category. Strong, specific phrases score high; generic
// single words score low (so an incidental mention doesn't force a label).
// A signal that appears in the FILENAME counts double — filenames are the most
// reliable indicator (e.g. "CPWD_DSR_2024_Vol1.pdf", "LAR_NR_Signalling.pdf").
const DOCTYPE_SIGNALS = [
  ['LAR (IREPS)',            [[/last accepted rate/, 5], [/\blar\b/, 4], [/\bireps\b/, 4], [/accepted rate/, 3]]],
  ['SOR / Rate Schedule',    [[/schedule of rates/, 5], [/\bsor\b/, 4], [/\bdsr\b/, 4], [/unified standard schedule/, 5], [/\bussor\b/, 5], [/analysis of rates/, 4], [/cpwd.*(rates|dsr)/, 4], [/basic rate/, 2]]],
  ['Circular / Guideline',   [[/railway board/, 4], [/circular/, 4], [/correction slip/, 5], [/joint procedure order/, 4], [/\bjpo\b/, 3], [/rdso.*(guideline|specification|letter)/, 4], [/policy guideline/, 4], [/\bamendment\b/, 2], [/no\.\s*\d{4}\/[a-z]+/i, 2]]],
  ['Estimate / BOQ',         [[/bill of quantit/, 5], [/\bboq\b/, 5], [/detailed estimate/, 5], [/abstract estimate/, 5], [/abstract of cost/, 4], [/quantit(y|ies) survey/, 3], [/measurement sheet/, 3]]],
  ['Tender / Bid Document',  [[/request for proposal/, 5], [/invitation to bid/, 4], [/\brfp\b/, 4], [/tender enquiry/, 4], [/\bnit\b/, 3], [/notice inviting tender/, 5], [/bid document/, 4], [/\btender\b/, 2]]],
  ['Contract Agreement',     [[/contract agreement/, 5], [/letter of acceptance/, 4], [/\bloa\b/, 3], [/general conditions of contract/, 4], [/\bgcc\b/, 3], [/special conditions of contract/, 4], [/agreement no/, 3]]],
  ['Technical Specification',[[/technical specification/, 5], [/particular specification/, 4], [/outline design specification/, 4], [/employer'?s requirement/, 4], [/scope of work/, 3], [/specification for/, 2]]],
  ['Inspection / Site Report',[[/inspection report/, 5], [/site visit report/, 4], [/non[- ]?conformit/, 3], [/\bncr\b/, 3], [/progress report/, 3], [/joint measurement/, 3], [/snag list/, 3], [/punch list/, 3], [/\bobservation/, 1]]],
  ['Drawing',                [[/general arrangement drawing/, 5], [/\bgad\b/, 4], [/single line diagram/, 5], [/\bsld\b/, 4], [/ohe layout/, 5], [/signalling plan/, 5], [/interlocking plan/, 4], [/track layout/, 4], [/yard plan/, 4], [/cable schedule/, 4], [/drawing no\.?|drg\.? no\.?/, 2]]],
];

function heuristicDocType(text, name = '') {
  const rawName = (name || '').toLowerCase();

  // File extension is the strongest possible signal for CAD drawings.
  if (/\.(dwg|dxf)$/i.test(rawName)) return 'Drawing';

  // Normalise separators → spaces so \b word boundaries work. Underscores and
  // dots are WORD characters in regex, so "_LAR_" / "SOR_2024" would otherwise
  // never match \blar\b / \bsor\b — the main cause of misclassified uploads.
  const fname = rawName.replace(/[_\-./\\]+/g, ' ');
  const body  = (text || '').slice(0, 6000).toLowerCase().replace(/_+/g, ' ');

  let best = null, bestScore = 0;
  for (const [type, pats] of DOCTYPE_SIGNALS) {
    let score = 0;
    for (const [re, w] of pats) {
      if (re.test(fname))      score += w * 2;   // filename match — most reliable
      else if (re.test(body))  score += w;
    }
    if (score > bestScore) { bestScore = score; best = type; }
  }
  // Only trust the heuristic when reasonably confident; otherwise defer to the LLM.
  return bestScore >= 4 ? best : null;
}

// One-line descriptions to ground the LLM classifier when heuristics are unsure.
const DOC_TYPE_HINTS = {
  'SOR / Rate Schedule': 'A Schedule of Rates — CPWD SOR/DSR, Railway zonal SOR/USSOR, or an analysis-of-rates volume.',
  'LAR (IREPS)': 'Last Accepted Rates extracted from the IREPS portal — accepted tender/contract rates for items.',
  'Circular / Guideline': 'A Railway Board / RDSO / zonal railway / CPWD circular, letter, guideline, policy, JPO or correction slip.',
  'Technical Specification': "The contract's technical/particular specification or employer's requirements describing the works.",
  'Drawing': 'Engineering drawing — GAD, track/yard layout, OHE layout, signalling plan, SLD, structure drawing (PDF/image/CAD).',
  'Estimate / BOQ': 'A detailed/abstract estimate, bill of quantities or measurement/costing sheet.',
  'Tender / Bid Document': 'NIT / RFP / tender or bid document inviting offers.',
  'Contract Agreement': 'A contract agreement, LOA, or conditions-of-contract (GCC/SCC) document.',
  'Inspection / Site Report': 'Inspection / site-visit / progress report listing observations or non-conformities.',
  'General Document': 'Anything that does not clearly fit the above (manuals, standards, notes, correspondence).',
};

async function classifyDocType(text, name = '') {
  const h = heuristicDocType(text, name);
  if (h) return h;
  try {
    const prompt = `You classify railway-project engineering documents for RVNL. Choose EXACTLY ONE category that best describes the document below, based on its overall purpose (not an incidental keyword).

Categories:
${DOC_TYPES.map(t => `- ${t}: ${DOC_TYPE_HINTS[t] || ''}`).join('\n')}

Reply with ONLY the exact category name.

Document file name: ${name || '(unknown)'}
Document excerpt:
${text.slice(0, 4000)}`;
    const out = (await generateText(prompt, { temperature: 0, maxOutputTokens: 24 })).trim();
    // Prefer an exact category match; fall back to a contained match.
    const exact = DOC_TYPES.find(t => out.toLowerCase() === t.toLowerCase());
    const match = exact || DOC_TYPES.find(t => out.toLowerCase().includes(t.toLowerCase()));
    return match || 'General Document';
  } catch (_) {
    return 'General Document';
  }
}

module.exports = { DOC_TYPES, classifyDocType, heuristicDocType };
