-- Documents, verification checks and rating appeals.

create table documents (
  id uuid primary key default gen_random_uuid(),
  owner_org_id uuid not null references organisations(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  uploaded_by uuid not null references users(id),
  category text not null check (length(category) between 2 and 60),
  filename text not null check (length(filename) between 1 and 160),
  mime text not null check (mime in ('application/pdf','image/png','image/jpeg')),
  size_bytes int not null check (size_bytes > 0),
  sha256 text not null,
  content bytea not null,
  scan_status text not null default 'not_scanned' check (scan_status in ('not_scanned','clean','infected')),
  review_status text not null default 'submitted' check (review_status in ('submitted','accepted','rejected')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  retain_until date,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index documents_owner_idx on documents (owner_org_id);
create index documents_deal_idx on documents (deal_id);

-- Explicit, revocable sharing of a deal document with a service provider organisation.
create table document_shares (
  document_id uuid not null references documents(id) on delete cascade,
  org_id uuid not null references organisations(id) on delete cascade,
  granted_by uuid not null references users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (document_id, org_id)
);

create table verification_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  check_type text not null check (check_type in ('business_registration','director_identity','registered_address','sanctions_screening','bank_reference','trade_licence')),
  status text not null default 'requested' check (status in ('requested','passed','failed','not_applicable')),
  method text check (method in ('manual_document_review','registry_api','provider')),
  source text check (length(source) <= 200),
  evidence_document_id uuid references documents(id) on delete set null,
  reviewer_id uuid references users(id),
  notes text check (length(notes) <= 2000),
  checked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index verification_checks_org_idx on verification_checks (org_id, check_type, created_at desc);

create table rating_appeals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  submitted_by uuid not null references users(id),
  reason text not null check (length(reason) between 10 and 2000),
  status text not null default 'open' check (status in ('open','upheld','rejected')),
  resolution text check (length(resolution) <= 2000),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
