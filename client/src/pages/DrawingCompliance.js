import React, { useState, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, DocSource, EditableColumns, Field, Spinner, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { extractDrawing, validateDrawing, compareDrawings, designReview, logInteraction } from '../services/featureApi';
import { getUserDoc } from '../services/docStore';
import { DOMAINS } from '../services/rvnlKnowledge';

const PRESETS = {
  'Schedule of Quantities': {
    prompt: 'Prepare a schedule of quantities from this drawing. List every item of work / component shown with its specification and quantity or dimensions.',
    columns: ['Sl.No', 'Item', 'Specification', 'Unit', 'Quantity / Dimension', 'Location / Chainage', 'Remarks'],
  },
  'Equipment / Material List': {
    prompt: 'Prepare the equipment / material list from this drawing using the legend. Include maker/part number and quantity where shown.',
    columns: ['Sl.No', 'Item Tag', 'Description', 'Make / Part Number', 'Quantity', 'Location', 'Remarks'],
  },
  'Principal Dimensions & Levels': {
    prompt: 'Extract the principal dimensions, clearances, levels, gradients and chainages stated on this drawing (e.g. formation width, platform height/offset, span arrangement, implantation distances) exactly as shown.',
    columns: ['Sl.No', 'Parameter', 'Value', 'Unit', 'Location / Chainage', 'Remarks'],
  },
  'Cable / Conductor Schedule': {
    prompt: 'Prepare a cable schedule from this drawing. Trace every cable run between equipment, using the circled cable-type numbers and the cable legend to fill cable size and type.',
    columns: ['Sl.No', 'Cable Tag', 'From', 'To', 'Cable Size', 'Cable Type', 'Route / Remarks'],
  },
  'Signals / Points Schedule': {
    prompt: 'From this signalling plan, list every signal, point/turnout, track circuit or axle counter section with its number, type and location.',
    columns: ['Sl.No', 'Asset No', 'Type', 'Location / Chainage', 'Description', 'Remarks'],
  },
  'Custom': { prompt: '', columns: [] },
};

const V_COLS = ['slNo', 'area', 'source', 'reference', 'requirement', 'observation', 'status', 'severity', 'recommendation'];
const V_HEAD = ['Sl.No', 'Review Area', 'Against', 'Reference', 'Requirement', 'Observation', 'Status', 'Severity', 'Recommendation'];

export default function DrawingCompliance() {
  const [mode, setMode]       = useState('validate');   // validate | extract | compare | checklist
  const [preset, setPreset]   = useState('Schedule of Quantities');
  const [prompt, setPrompt]   = useState(PRESETS['Schedule of Quantities'].prompt);
  const [columns, setColumns] = useState(PRESETS['Schedule of Quantities'].columns);
  const [source, setSource]   = useState(null);        // selected doc {id,name,libraryFile,source}
  const [file, setFile]       = useState(null);        // uploaded File
  const [vFocus, setVFocus]   = useState('');
  const [specDoc, setSpecDoc] = useState(null);
  const [refDoc, setRefDoc]   = useState(null);
  // Compare mode — second drawing
  const [sourceB, setSourceB] = useState(null);
  const [fileB, setFileB]     = useState(null);
  const [cFocus, setCFocus]   = useState('');
  const [cResult, setCResult] = useState(null);
  const fileRefB = useRef(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const [vResult, setVResult] = useState(null);
  const fileRef = useRef(null);

  const applyPreset = (p) => { setPreset(p); setPrompt(PRESETS[p].prompt); setColumns(PRESETS[p].columns); };

  const onUpload = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) { setFile(f); setSource(null); setResult(null); setVResult(null); setError(null); }
  };

  // Resolve a (file, selected-doc) pair into { file } or { libraryId } for the API.
  const resolveOne = async (f, s) => {
    if (f) return { file: f };
    if (!s) throw new Error('Select or upload a drawing first.');
    if (s.source === 'library') return { libraryId: s.libraryFile || s.id };
    const full = await getUserDoc(s.id);
    if (!full?.file) throw new Error('The selected document has no original file to read. Upload the drawing here instead.');
    return { file: new File([full.file], full.name || 'drawing', { type: full.mime || full.file.type || 'application/pdf' }) };
  };
  const resolveSource = () => resolveOne(file, source);
  const srcName = file?.name || source?.name || 'drawing';

  const runValidate = async () => {
    setBusy(true); setError(null); setVResult(null);
    try {
      const src = await resolveSource();
      const res = await validateDrawing({ ...src, prompt: vFocus, buildSpecText: specDoc?.text, bindingText: refDoc?.text });
      setVResult(res);
      logInteraction({ module: 'Drawing Compliance', prompt: vFocus || 'Compliance review', subject: srcName,
        response: `${res.total || 0} findings — ${res.stats?.['Non-Compliant'] || 0} non-compliant.` }).catch(() => {});
      if (!res.findings?.length) setError('No findings were produced. Try a clearer drawing or add a focus area.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const runExtract = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const src = await resolveSource();
      const cols = columns.map(s => s.trim()).filter(Boolean);
      const res = await extractDrawing({ ...src, prompt, columns: cols.length ? cols : null });
      setResult(res);
      if (!res.rows?.length) setError('No rows were extracted. Try a more specific prompt or check the drawing quality.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const runCompare = async () => {
    setBusy(true); setError(null); setCResult(null);
    try {
      const A = await resolveOne(file, source);
      const B = await resolveOne(fileB, sourceB);
      const res = await compareDrawings({ fileA: A.file, libraryIdA: A.libraryId, fileB: B.file, libraryIdB: B.libraryId, prompt: cFocus });
      setCResult(res);
      if (!res.rows?.length) setError('No differences were produced. Try clearer drawings.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const tb = result?.meta?.titleBlock || {};
  const cad = result?.cad;
  const vRows = (vResult?.findings || []).map(o => {
    const r = {};
    V_COLS.forEach((k, i) => { r[V_HEAD[i]] = (k === 'reference' ? (o.reference ?? o.irsReference) : o[k]) ?? ''; });
    return r;
  });

  const modeBtn = (m, label, tone) => (
    <button onClick={() => setMode(m)}
      className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap ${mode === m ? tone : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{label}</button>
  );

  return (
    <Page
      title="Drawing Compliance Verification"
      subtitle="Review consultant/DDC-submitted drawings (PDF / scanned PDF / image / AutoCAD .dwg/.dxf) against the latest Indian Railways standards and guidelines — RDSO, IRS codes, the Schedule of Dimensions, IR manuals and tracked circulars — with non-compliances highlighted and referenced. Also extract drawing data, compare revisions, and generate review checklists."
    >
      <Card title="1 · Drawing Source">
        <div className="grid md:grid-cols-2 gap-4">
          <DocSource label="Select an uploaded drawing" value={source} onChange={(v) => { setSource(v); setFile(null); setResult(null); setVResult(null); }} />
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300">Or upload a drawing</label>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.dwg,.dxf" className="hidden" onChange={onUpload} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              {file ? file.name : 'GAD · layout · OHE / signalling plan · PDF · image · .dwg / .dxf'}
            </button>
            <div className="flex gap-1.5">
              {modeBtn('validate', 'Verify Compliance', 'bg-violet-500/20 text-violet-300 border-violet-500/40')}
              {modeBtn('extract', 'Extract Data', 'bg-sky-500/20 text-sky-300 border-sky-500/40')}
              {modeBtn('compare', 'Compare Revisions', 'bg-amber-500/20 text-amber-300 border-amber-500/40')}
              {modeBtn('checklist', 'Review Checklist', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40')}
            </div>
          </div>
        </div>
      </Card>

      {mode === 'validate' && (
        <Card title="2 · Verify Compliance" desc="The drawing is read and reviewed against the Indian Railways standards & circulars indexed in the knowledge base — plus, optionally, the contract's technical specification and an approved reference document. Non-compliances are highlighted with the governing reference.">
          <Field label="Focus (optional)" value={vFocus} onChange={setVFocus} placeholder="e.g. SOD clearances, OHE implantation, platform dimensions, earthing & bonding" />
          <div className="grid md:grid-cols-2 gap-4">
            <DocSource label="Contract technical specification (optional)" value={specDoc} onChange={setSpecDoc} />
            <DocSource label="Approved reference drawing / data (optional)" value={refDoc} onChange={setRefDoc} />
          </div>
          <RunButton onClick={runValidate} busy={busy} busyLabel="Reviewing against IR standards & guidelines…">Verify Drawing Compliance</RunButton>
          <ErrorNote>{error}</ErrorNote>
          <p className="text-[10px] text-slate-500">Tip: upload the applicable RDSO specs / SOD / manuals under Settings → Standards &amp; Codes and the latest circulars in Guidelines &amp; Circulars — reviews cite whatever is indexed there.</p>
        </Card>
      )}

      {mode === 'extract' && (
        <Card title="2 · Extraction Request" desc="Choose what to extract and edit the target columns before running.">
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${preset === p ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}>{p}</button>
            ))}
          </div>
          <Field label="Prompt (what to extract)" value={prompt} onChange={setPrompt} textarea rows={3} />
          <EditableColumns columns={columns} onChange={setColumns} label="Target columns (edit before extracting)" />
          <RunButton onClick={runExtract} busy={busy} busyLabel="Reading drawing sheet-by-sheet…">Extract to Table</RunButton>
          <ErrorNote>{error}</ErrorNote>
          {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Large multi-page drawings can take 30–90s as each sheet is interpreted.</div>}
        </Card>
      )}

      {mode === 'compare' && (
        <Card title="2 · Compare Revisions" desc="The first drawing is the one selected/uploaded above. Pick the other revision, then compare — useful for checking what a consultant changed between submissions.">
          <div className="grid md:grid-cols-2 gap-4">
            <DocSource label="Second drawing / revision" value={sourceB} onChange={(v) => { setSourceB(v); setFileB(null); setCResult(null); }} />
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-slate-300">Or upload the second drawing</label>
              <input ref={fileRefB} type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.dwg,.dxf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFileB(f); setSourceB(null); setCResult(null); } }} />
              <button onClick={() => fileRefB.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                {fileB ? fileB.name : 'PDF · image · AutoCAD .dwg / .dxf'}
              </button>
            </div>
          </div>
          <Field label="Comparison focus (optional)" value={cFocus} onChange={setCFocus} textarea rows={2}
            placeholder="e.g. What changed in track layout, structures and OHE between Rev.B and Rev.C?" />
          <RunButton onClick={runCompare} busy={busy} busyLabel="Reading and comparing both drawings…">Compare Drawings</RunButton>
          <ErrorNote>{error}</ErrorNote>
        </Card>
      )}

      {mode === 'checklist' && <ChecklistTab />}

      {mode === 'validate' && vResult && (
        <Card title="3 · Compliance Findings" right={<span className="text-[11px] text-slate-400">{vResult.drawing}</span>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
            <StatTile label="Findings" value={vResult.total} tone="sky" />
            {(vResult.statuses || []).map(s => (
              <StatTile key={s} label={s} value={vResult.stats?.[s] || 0}
                tone={{ 'Compliant': 'emerald', 'Non-Compliant': 'red', 'Requires Review': 'amber' }[s] || 'slate'} />
            ))}
          </div>
          <ResultTable columns={V_HEAD} rows={vRows} title="Drawing Compliance Review" sheetName="Compliance Review"
            downloadName={`Compliance_${(vResult.drawing || 'drawing').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`}
            note="Each finding cites the governing standard/circular. Verify flagged items against the referenced document before communicating to the consultant/DDC." />
          {vResult.citations?.length > 0 && <div className="text-[10px] text-slate-500 mt-2">Reference documents used: {vResult.citations.join(' · ')}</div>}
          <FeedbackBar module="drawings" subject={`Compliance review · ${vResult.drawing}`} />
        </Card>
      )}

      {mode === 'extract' && result && (
        <>
          <Card title="3 · Drawing Recognised">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Rows" value={result.rowCount} tone="emerald" />
              <StatTile label="Sheets Read" value={result.meta?.pagesProcessed ?? '—'} tone="sky" />
              <StatTile label="Drawing No" value={tb.drawingNo || '—'} tone="violet" />
              <StatTile label={cad ? 'CAD' : 'Revision'} value={cad ? (cad.kind?.toUpperCase() || 'CAD') : (tb.revision || '—')} tone="slate" />
              <StatTile label={cad ? 'Regions' : 'Sheet'} value={cad ? (cad.regions?.length || 0) : (tb.sheetNo || '—')} tone="amber" />
            </div>
            {tb.title && <div className="text-[11px] text-slate-400">Title: <span className="text-slate-200">{tb.title}</span>{tb.system ? ` · System: ${tb.system}` : ''}{tb.organisation ? ` · By: ${tb.organisation}` : ''}</div>}
            {cad?.note && <div className="text-[10px] text-amber-400">{cad.note}</div>}
          </Card>

          <Card title="4 · Extracted Table" desc="Edit cells if needed, copy for Excel, or export.">
            <ResultTable
              columns={result.columns}
              rows={result.rows}
              editable
              onRowsChange={(rows) => setResult(r => ({ ...r, rows, rowCount: rows.length }))}
              title={preset === 'Custom' ? 'Extracted data' : preset}
              sheetName={(preset === 'Custom' ? 'Extract' : preset).slice(0, 28)}
              downloadName={`${(tb.drawingNo || srcName || 'drawing').toString().replace(/\.[^.]+$/, '')}_${preset.replace(/[^a-z0-9]+/gi, '_')}`}
              note="Verify against the source drawing before issue. Empty cells indicate data not legible / not shown on the sheet."
            />
            <FeedbackBar module="drawings" subject={`${srcName} · ${preset}`} />
          </Card>
        </>
      )}

      {mode === 'compare' && cResult?.rows?.length > 0 && (
        <Card title="3 · Revision Differences" desc="Copy for Excel or export. Verify against both source drawings.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <StatTile label="Differences" value={cResult.rowCount} tone="amber" />
            <StatTile label="Drawing A" value={(cResult.drawingA || '').slice(0, 14) || '—'} tone="sky" />
            <StatTile label="Drawing B" value={(cResult.drawingB || '').slice(0, 14) || '—'} tone="violet" />
          </div>
          <ResultTable columns={cResult.columns} rows={cResult.rows}
            title={`${cResult.drawingA} vs ${cResult.drawingB}`} sheetName="Drawing Comparison"
            downloadName={`compare_${(cResult.drawingA || 'A').replace(/[^a-z0-9]+/gi, '_').slice(0, 18)}_vs_${(cResult.drawingB || 'B').replace(/[^a-z0-9]+/gi, '_').slice(0, 18)}`} />
          <FeedbackBar module="drawings" subject={`Drawing comparison · ${cResult.drawingA} vs ${cResult.drawingB}`} />
        </Card>
      )}

      <ModuleChat
        module="drawings"
        title="Ask about this drawing"
        docText={source?.text}
        docName={source?.name}
        placeholder="e.g. Does this GAD meet the Schedule of Dimensions clearances?"
        suggestions={[
          'What are the principal dimensions shown on this GAD?',
          'List the clearances stated and compare them with SOD requirements.',
          'What should I check on a DDC-submitted OHE layout plan?',
        ]}
      />
    </Page>
  );
}

/* ── Review checklist (system-wise, standards + lessons grounded) ─────────── */
function ChecklistTab() {
  const [system, setSystem] = useState('');
  const [domain, setDomain] = useState('');
  const [scope, setScope]   = useState('');
  const [doc, setDoc]       = useState(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [res, setRes]       = useState(null);

  const run = async () => {
    if (!system.trim()) { setError('Enter the system / asset under review.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await designReview({ system, domain, scope, docText: doc?.text, docName: doc?.name });
      setRes(r);
      logInteraction({ module: 'Drawing Compliance', prompt: `Review checklist: ${system}`, subject: system,
        response: `${r.checklistCount || 0} checks, ${r.riskCount || 0} risks.` }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const clRows = (res?.checklist || []).map(c => ({
    'Sl.No': c.slNo, 'Review Area': c.area || '', 'Check Item': c.checkItem || '', 'Reference': c.reference || '', 'Basis': c.basis || '',
  }));
  const riskRows = (res?.risks || []).map(r => ({
    'Sl.No': r.slNo, 'Risk': r.risk || '', 'Category': r.category || '', 'Likelihood': r.likelihood || '',
    'Impact': r.impact || '', 'Recurring': r.recurring || '', 'Preventive Measure': r.preventiveMeasure || '', 'Reference': r.reference || '',
  }));

  return (
    <>
      <Card title="2 · Generate a Review Checklist" desc="A standards-grounded, system-specific checklist for reviewing the submission — informed by the decisions & lessons register so recurring deficiencies are checked first.">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="System / asset" value={system} onChange={setSystem} placeholder="e.g. OHE layout, station building GAD, EI signalling plan, ROB" />
          <div>
            <label className="text-[11px] font-semibold text-slate-300">Discipline (optional)</label>
            <select value={domain} onChange={e => setDomain(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
              <option value="">—</option>
              {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <Field label="Scope / notes (optional)" value={scope} onChange={setScope} placeholder="stage of submission, site constraints…" />
        </div>
        <DocSource label="Design document under review (optional)" value={doc} onChange={setDoc} />
        <RunButton onClick={run} busy={busy} busyLabel="Building checklist & risk register…">Generate Checklist & Risks</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {res && (
        <>
          <Card title={`3 · Review Checklist · ${res.resolvedSystem || res.system}`}
            desc={res.systemInterpreted ? `Interpreted "${res.system}" as "${res.resolvedSystem}".` : undefined}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <StatTile label="Check Items" value={res.checklistCount} tone="sky" />
              <StatTile label="Risks" value={res.riskCount} tone="amber" />
              <StatTile label="Lessons Used" value={res.lessonsUsed} tone="violet" />
              <StatTile label="Recurring Issues" value={res.recurringCount} tone="red" />
            </div>
            <ResultTable columns={['Sl.No', 'Review Area', 'Check Item', 'Reference', 'Basis']} rows={clRows}
              title="Review Checklist" sheetName="Checklist" downloadName={`Checklist_${(res.resolvedSystem || 'system').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
          </Card>
          <Card title="4 · Risk Register">
            <ResultTable columns={['Sl.No', 'Risk', 'Category', 'Likelihood', 'Impact', 'Recurring', 'Preventive Measure', 'Reference']} rows={riskRows}
              title="Risk Register" sheetName="Risks" downloadName={`Risks_${(res.resolvedSystem || 'system').replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`} />
            {res.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {res.citations.join(' · ')}</div>}
            <FeedbackBar module="designreview" subject={`Checklist · ${res.resolvedSystem || res.system}`} />
          </Card>
        </>
      )}
    </>
  );
}
