// Shared domain vocabulary. Served to the browser via GET /api/meta so the UI and API never drift.

export const ORG_TYPES = {
  manufacturer: { label: 'Manufacturer', sells: true, buys: false },
  exporter: { label: 'Exporter', sells: true, buys: false },
  distributor: { label: 'Distributor / wholesaler', sells: true, buys: true },
  importer: { label: 'Importer', sells: false, buys: true },
  buyer: { label: 'Buyer / sourcing team', sells: false, buys: true },
  logistics: { label: 'Logistics provider', sells: false, buys: false },
  finance: { label: 'Finance institution', sells: false, buys: false },
  verification: { label: 'Verification / inspection partner', sells: false, buys: false },
};
export const canSell = (t) => !!ORG_TYPES[t]?.sells;
export const canBuy = (t) => !!ORG_TYPES[t]?.buys;
export const isTrader = (t) => canSell(t) || canBuy(t);

export const PAYMENT_METHODS = [
  { code: 'lc_sight', label: 'Irrevocable Letter of Credit (at sight)' },
  { code: 'lc_usance', label: 'Letter of Credit (usance / deferred)' },
  { code: 'tt_advance', label: 'Bank transfer (SWIFT/TT) in advance' },
  { code: 'tt_split', label: 'Bank transfer: deposit + balance against documents' },
  { code: 'documentary_collection', label: 'Documentary collection (D/P or D/A)' },
  { code: 'open_account', label: 'Open account' },
  { code: 'cash_where_permitted', label: 'Cash, only where legally permitted' },
];

export const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'CNY', 'AED', 'JPY', 'KRW'];
export const TRANSPORT_MODES = ['sea_reefer', 'sea_dry', 'air', 'road', 'rail', 'multimodal'];

// Each stage has structured fields. type: text | textarea | number | select | date
export const STAGES = [
  { key: 'product', name: 'Product & quantity', fields: [
    { name: 'product', label: 'Product', type: 'text', required: true, max: 200 },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true },
    { name: 'unit', label: 'Unit', type: 'text', required: true, max: 30 },
    { name: 'specification', label: 'Specification / grade', type: 'textarea', max: 1000 },
  ] },
  { key: 'pricing', name: 'Pricing & currency', fields: [
    { name: 'total_value', label: 'Total contract value', type: 'number', required: true },
    { name: 'currency', label: 'Currency', type: 'select', options: CURRENCIES, required: true },
    { name: 'unit_price', label: 'Unit price (optional)', type: 'number' },
  ] },
  { key: 'payment', name: 'Payment method & terms', fields: [
    { name: 'method', label: 'Payment method', type: 'select', options: PAYMENT_METHODS.map((p) => p.code), required: true },
    { name: 'terms', label: 'Payment terms (deposit, timing, documents)', type: 'textarea', required: true, max: 1000 },
  ] },
  { key: 'delivery', name: 'Delivery terms (Incoterms)', fields: [
    { name: 'incoterm', label: 'Incoterm 2020', type: 'select', options: INCOTERMS, required: true },
    { name: 'named_place', label: 'Named place / port', type: 'text', required: true, max: 120 },
    { name: 'latest_shipment_date', label: 'Latest shipment date', type: 'date' },
  ] },
  { key: 'logistics', name: 'Shipping & insurance', fields: [
    { name: 'mode', label: 'Transport mode', type: 'select', options: TRANSPORT_MODES, required: true },
    { name: 'insurance_by', label: 'Cargo insurance arranged by', type: 'select', options: ['buyer', 'seller', 'not_required'], required: true },
    { name: 'details', label: 'Packaging, temperature, routing', type: 'textarea', max: 1000 },
  ] },
  { key: 'documents', name: 'Documentation & inspection', fields: [
    { name: 'required_documents', label: 'Required documents', type: 'textarea', required: true, max: 1000 },
    { name: 'inspection', label: 'Inspection / certification', type: 'textarea', max: 1000 },
  ] },
  { key: 'agreement', name: 'Final agreement', fields: [
    { name: 'governing_law', label: 'Governing law', type: 'text', required: true, max: 120 },
    { name: 'dispute_resolution', label: 'Dispute resolution', type: 'text', required: true, max: 200 },
  ] },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

export const VERIFICATION_CHECKS = {
  business_registration: { label: 'Business registration', weight: 15 },
  director_identity: { label: 'Director / signatory identity', weight: 10 },
  registered_address: { label: 'Registered address', weight: 5 },
  sanctions_screening: { label: 'Sanctions & watchlist screening', weight: 10 },
  bank_reference: { label: 'Bank reference letter', weight: 5 },
  trade_licence: { label: 'Import / export licence', weight: 5 },
};

export const DOCUMENT_CATEGORIES = [
  'certificate_of_incorporation', 'director_id', 'proof_of_address', 'bank_reference', 'trade_licence',
  'product_specification', 'quality_certificate', 'proforma_invoice', 'commercial_invoice', 'packing_list',
  'bill_of_lading', 'certificate_of_origin', 'health_certificate', 'inspection_report', 'payment_evidence', 'other',
];

export const FINANCE_PRODUCTS = ['lc_advisory', 'pre_shipment_finance', 'invoice_finance', 'supply_chain_finance', 'trade_credit_insurance'];
// Fields a party may choose to disclose to finance providers. Nothing else is ever shown to them.
export const FINANCE_SHAREABLE = {
  deal_ref: 'Trade Room reference',
  product: 'Product & quantity',
  value: 'Contract value & currency',
  payment_method: 'Agreed payment method',
  incoterm: 'Incoterm & named place',
  buyer_identity: 'Buyer company name & country',
  seller_identity: 'Seller company name & country',
  readiness: 'Trade-Ready indicator of both parties',
};

export const SHIPMENT_STATUSES = ['booked', 'picked_up', 'in_transit', 'at_port', 'customs', 'delivered', 'exception'];

export const FEE_RULES = { rate: 0.005, capUsd: 750 };

// ISO 3166-1 alpha-2.
export const COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL ' +
  'GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR ' +
  'LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK ' +
  'PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR ' +
  'TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
export const AFRICA = new Set(('AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ ' +
  'NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW').split(' '));

export const LISTING_CATEGORIES = [
  'Frozen seafood', 'Processed food', 'Agriculture', 'Cocoa & coffee', 'Grains & pulses', 'Fresh produce', 'Beverages',
  'Cosmetics ingredients', 'Textiles & apparel', 'Building materials', 'Metals & minerals', 'Chemicals', 'Plastics & packaging',
  'Machinery & equipment', 'Automotive parts', 'Electronics', 'Energy & solar', 'Pharmaceuticals & medical', 'Furniture & wood', 'Other',
];
