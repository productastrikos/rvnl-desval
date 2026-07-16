// ─────────────────────────────────────────────────────────────────────────────
// RVNL Project Intelligence — domain constants
//
// Shared vocabulary for the client: engineering disciplines across RVNL's
// contracts, the rate sources the estimation tools compare, the standards
// bodies the compliance tools review against, and starter prompts for the
// assistant. The actual knowledge lives server-side (uploaded standards,
// circulars and rate schedules indexed into the retrieval engine).
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM = {
  name: 'RVNL Project Intelligence',
  client: 'Rail Vikas Nigam Limited',
  vendor: 'Astrikos.ai',
};

// Disciplines across RVNL's multi-contract portfolio (civil, S&T, electrical …)
export const DOMAINS = [
  'Civil',
  'Track / P.Way',
  'Bridges / Structures',
  'Signalling & Telecom',
  'Electrical (TRD/OHE)',
  'Electrical (General)',
  'Buildings',
];

// Rate sources the estimation support compares side-by-side.
export const RATE_SOURCES = [
  'CPWD SOR / DSR',
  'Railway SOR (Zonal)',
  'LAR (IREPS)',
  'RSP / Stores Rate',
  'Market Rate Analysis',
  'Other Rate Schedule',
];

// Standards & guideline authorities the compliance tools review against.
export const STANDARDS_BODIES = [
  'Railway Board',
  'RDSO',
  'IRS Codes',
  'CPWD',
  'Zonal Railways',
  'IS / BIS',
];

// Quick-reference topics shown beside the assistant (send-as-prompt shortcuts).
export const QUICK_TOPICS = [
  { id: 'SOD',    title: 'Schedule of Dimensions — clearances & moving dimensions' },
  { id: 'RDSO',   title: 'RDSO specifications & drawings — latest versions' },
  { id: 'LAR',    title: 'Last Accepted Rates (IREPS) — usage in estimates' },
  { id: 'USSOR',  title: 'Railway USSOR / zonal SOR — chapter structure' },
  { id: 'IRPWM',  title: 'IR Permanent Way Manual — track standards' },
];

// Suggested starter prompts for the assistant.
export const SUGGESTIONS = [
  { icon: '₹', text: 'Compare CPWD DSR and LAR rates for PQC pavement work' },
  { icon: '📋', text: 'Summarise the latest Railway Board guidelines on EPC contract variations' },
  { icon: '📐', text: 'What clearances does the Schedule of Dimensions require for a new FOB?' },
  { icon: '⚡', text: 'Key RDSO requirements for OHE mast foundations near platforms' },
  { icon: '🚦', text: 'Checklist for reviewing a DDC-submitted signalling & interlocking plan' },
  { icon: '🧾', text: 'Draft a rate justification note citing SOR and LAR sources' },
];
