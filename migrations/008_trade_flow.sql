-- Guided trade flow: chat offers, execution steps after agreement, payment records and company age.

alter table organisations add column incorporated_on date;
alter table documents add column issued_on date;
alter table deals add column payment_due_on date;
alter table finance_requests add column selected_provider_org uuid references organisations(id);

-- One-shot offers made from the Trade Room chat. Accepting an offer agrees every term in it at once.
create table deal_offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  seq int not null,
  side text not null check (side in ('buyer','seller')),
  user_id uuid not null references users(id),
  terms jsonb not null,
  note text check (length(note) <= 1000),
  status text not null default 'open' check (status in ('open','accepted','countered','declined','withdrawn')),
  responded_by uuid references users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deal_id, seq)
);
create unique index deal_offers_one_open on deal_offers (deal_id) where status = 'open';

-- Execution steps created when terms are agreed.
create table deal_milestones (
  deal_id uuid not null references deals(id) on delete cascade,
  key text not null,
  position int not null,
  name text not null,
  owner_side text not null check (owner_side in ('buyer','seller')),
  status text not null default 'locked' check (status in ('locked','active','done','skipped')),
  data jsonb not null default '{}',
  completed_by uuid references users(id),
  completed_at timestamptz,
  primary key (deal_id, key)
);

-- Payment behaviour record used for company history. 'demo' rows are only shown in demo mode.
create table payment_records (
  id uuid primary key default gen_random_uuid(),
  payer_org_id uuid not null references organisations(id) on delete cascade,
  payee_org_id uuid references organisations(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  amount numeric(18,2) not null check (amount >= 0),
  currency char(3) not null,
  due_date date not null,
  paid_on date not null,
  on_time boolean generated always as (paid_on <= due_date) stored,
  counterparty_country char(2),
  source text not null default 'platform' check (source in ('platform','demo')),
  created_at timestamptz not null default now()
);
create index payment_records_payer_idx on payment_records (payer_org_id, paid_on desc);
