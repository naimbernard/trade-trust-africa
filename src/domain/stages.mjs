import { fail } from '../http.mjs';
import { STAGES, PAYMENT_METHODS } from './constants.mjs';

export const stageSpec = (key) => STAGES.find((s) => s.key === key);

/** Validate the structured fields for a stage proposal. Unknown fields are dropped. */
export function validateStageFields(key, fields = {}, note) {
  const spec = stageSpec(key);
  if (!spec) fail(404, 'Stage not found');
  if (typeof fields !== 'object' || Array.isArray(fields) || fields === null) fail(400, 'Fields must be an object');
  const out = {};
  for (const f of spec.fields) {
    let val = fields[f.name];
    if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
      if (f.required) fail(400, `${f.label} is required`);
      continue;
    }
    if (f.type === 'number') {
      val = Number(val);
      if (!Number.isFinite(val) || val < 0 || val > 1e13) fail(400, `${f.label} must be a valid number`);
    } else if (f.type === 'select') {
      if (!f.options.includes(val)) fail(400, `${f.label} is not a recognised option`);
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || Number.isNaN(Date.parse(val))) fail(400, `${f.label} must be a date`);
    } else {
      if (typeof val !== 'string') fail(400, `${f.label} must be text`);
      val = val.trim();
      if (val.length > (f.max || 1000)) fail(400, `${f.label} is too long`);
    }
    out[f.name] = val;
  }
  let cleanNote = null;
  if (note !== undefined && note !== null && note !== '') {
    if (typeof note !== 'string' || note.length > 1500) fail(400, 'Note must be text up to 1500 characters');
    cleanNote = note.trim() || null;
  }
  return { fields: out, note: cleanNote, summary: summarise(key, out, cleanNote) };
}

const fmtNum = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);

export function summarise(key, f, note) {
  const label = (code) => PAYMENT_METHODS.find((p) => p.code === code)?.label || code;
  let s;
  switch (key) {
    case 'product': s = `${f.product}, ${fmtNum(f.quantity)} ${f.unit}${f.specification ? `. Spec: ${f.specification}` : ''}`; break;
    case 'pricing': s = `${f.currency} ${fmtNum(f.total_value)} total${f.unit_price ? ` (${f.currency} ${fmtNum(f.unit_price)} per unit)` : ''}`; break;
    case 'payment': s = `${label(f.method)}. ${f.terms}`; break;
    case 'delivery': s = `${f.incoterm} ${f.named_place}${f.latest_shipment_date ? `, ship by ${f.latest_shipment_date}` : ''}`; break;
    case 'logistics': s = `${String(f.mode).replace('_', ' ')}; insurance: ${String(f.insurance_by).replace('_', ' ')}${f.details ? `. ${f.details}` : ''}`; break;
    case 'documents': s = `Documents: ${f.required_documents}${f.inspection ? `. Inspection: ${f.inspection}` : ''}`; break;
    case 'agreement': s = `Governing law: ${f.governing_law}. Disputes: ${f.dispute_resolution}`; break;
    default: s = JSON.stringify(f);
  }
  return note ? `${s} (Note: ${note})` : s;
}
