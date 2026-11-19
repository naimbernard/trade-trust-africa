import PDFDocument from 'pdfkit';

const NAVY = '#0a2b3b';
const GOLD = '#c28f45';
const GREY = '#5b6b7a';

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Agreement record PDF. If no agreement exists yet the document is a DRAFT built from current stage state.
 * Content comes from the immutable snapshot when available so the PDF always matches the hashed record.
 */
export async function agreementPdf({ detail, agreement }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Trade Trust Africa ${detail.deal.ref}`, Author: 'Trade Trust Africa' } });
  const draft = !agreement;
  const snap = agreement?.snapshot;
  const buyer = snap?.buyer || detail.buyer;
  const seller = snap?.seller || detail.seller;
  const stages = snap?.stages || detail.stages.map((s) => ({ name: s.name, summary: s.proposal?.summary, revision: s.revision, status: s.status, agreed_at: s.agreed_at }));

  doc.rect(0, 0, doc.page.width, 95).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('TRADE TRUST AFRICA', 50, 32);
  doc.fillColor(GOLD).font('Helvetica').fontSize(9).text('Connecting global commerce. Building African industry.', 50, 56);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(draft ? 'DRAFT trade terms (not agreed)' : 'Record of mutually agreed commercial terms', 50, 120);
  doc.font('Helvetica').fontSize(10).fillColor(GREY)
    .text(`Reference: ${detail.deal.ref}${agreement ? `   Version: ${agreement.version}` : ''}`)
    .text(`Title: ${detail.deal.title}`)
    .text(`Generated: ${new Date().toISOString()}`);
  if (detail.deal.is_demo || detail.buyer.is_demo || detail.seller.is_demo) {
    doc.moveDown(0.4).fillColor('#a42536').font('Helvetica-Bold').text('FICTIONAL DEMO DATA. NOT A REAL TRANSACTION.');
  }

  doc.moveDown(1).fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Parties');
  doc.font('Helvetica').fontSize(10).fillColor('#1d2b38')
    .text(`Buyer: ${buyer.name} (${buyer.country})${buyer.registration_number ? `, reg. ${buyer.registration_number}` : ''}`)
    .text(`Seller: ${seller.name} (${seller.country})${seller.registration_number ? `, reg. ${seller.registration_number}` : ''}`);

  doc.moveDown(1).fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Commercial terms');
  for (const s of stages) {
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10).fillColor('#1d2b38').text(`${s.name}`, { continued: true })
      .font('Helvetica').fillColor(GREY).text(`   rev ${s.revision}${draft ? `, ${s.status?.replace('_', ' ')}` : ''}`);
    doc.font('Helvetica').fillColor('#1d2b38').text(s.summary || 'No terms recorded', { indent: 12 });
  }

  doc.moveDown(1.2).fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Important notices');
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).list([
    'This document records terms accepted by both parties on the Trade Trust Africa platform. It is not a payment confirmation, bank instrument, bill of lading, customs record or proof of delivery.',
    'Accepting payment terms does not mean funds were received. Trade Trust Africa does not hold client funds or provide finance.',
    'Have this record reviewed by qualified legal counsel before relying on it as a binding contract. Electronic acceptance on the platform is not a qualified electronic signature.',
    'Verification labels reflect only the checks listed on each party profile at the time of review.',
  ], { bulletRadius: 1.5 });

  if (agreement) {
    doc.moveDown(1).fontSize(8).fillColor(GREY).text(`Integrity hash (SHA-256 of canonical agreement record): ${agreement.sha256}`);
    doc.text(`Agreement recorded: ${new Date(agreement.created_at).toISOString()}`);
  } else {
    doc.save().rotate(-30, { origin: [300, 420] }).fontSize(80).fillColor('#e8ecef').opacity(0.5).text('DRAFT', 120, 380).restore();
  }
  return toBuffer(doc);
}
