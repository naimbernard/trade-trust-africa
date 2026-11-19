-- Logistics quotes and tracking, finance introductions, subscriptions and fee ledger.

create table logistics_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  requested_by_org uuid not null references organisations(id),
  requested_by_user uuid not null references users(id),
  origin text not null check (length(origin) between 2 and 120),
  destination text not null check (length(destination) between 2 and 120),
  cargo_description text not null check (length(cargo_description) between 2 and 500),
  quantity text check (length(quantity) <= 80),
  incoterm text,
  mode text not null check (mode in ('sea_reefer','sea_dry','air','road','rail','multimodal')),
  temperature_control text check (length(temperature_control) <= 80),
  ready_date date,
  status text not null default 'open' check (status in ('open','awarded','cancelled')),
  created_at timestamptz not null default now()
);

create table logistics_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references logistics_requests(id) on delete cascade,
  provider_org_id uuid not null references organisations(id),
  submitted_by uuid not null references users(id),
  price numeric(18,2) not null check (price > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  transit_days int not null check (transit_days between 0 and 365),
  valid_until date not null,
  notes text check (length(notes) <= 1000),
  status text not null default 'submitted' check (status in ('submitted','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  unique (request_id, provider_org_id)
);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  quote_id uuid not null unique references logistics_quotes(id),
  provider_org_id uuid not null references organisations(id),
  status text not null default 'booked' check (status in ('booked','picked_up','in_transit','at_port','customs','delivered','exception')),
  tracking_reference text check (length(tracking_reference) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shipment_events (
  id bigserial primary key,
  shipment_id uuid not null references shipments(id) on delete cascade,
  status text not null,
  location text check (length(location) <= 120),
  note text check (length(note) <= 1000),
  reported_by_org uuid not null references organisations(id),
  reported_by_user uuid not null references users(id),
  at timestamptz not null default now()
);
create trigger shipment_events_append_only before update or delete on shipment_events for each row execute function forbid_mutation();

create table finance_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  requested_by_org uuid not null references organisations(id),
  requested_by_user uuid not null references users(id),
  product text not null check (product in ('lc_advisory','pre_shipment_finance','invoice_finance','supply_chain_finance','trade_credit_insurance')),
  shared_fields jsonb not null,         -- frozen copy of exactly the fields the party consented to share
  consent_text text not null,
  consented_at timestamptz not null,
  status text not null default 'open' check (status in ('open','withdrawn','closed')),
  created_at timestamptz not null default now()
);

create table finance_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references finance_requests(id) on delete cascade,
  provider_org_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  decision text not null check (decision in ('interested','more_information','declined')),
  message text check (length(message) <= 1500),
  created_at timestamptz not null default now(),
  unique (request_id, provider_org_id)
);

create table plans (
  code text primary key,
  name text not null,
  price_usd_month numeric(10,2),        -- null = custom quote
  description text not null,
  entitlements jsonb not null,
  sort int not null default 0
);
insert into plans (code, name, price_usd_month, description, entitlements, sort) values
 ('explorer','Explorer',0,'Basic business profile, searchable directory, limited enquiries.',
   '{"enquiries_per_month":10,"trade_rooms":false,"active_listings":3,"documents":true}',1),
 ('business','Business',89,'Full listing management, Trade Room access, document workspace, analytics.',
   '{"enquiries_per_month":null,"trade_rooms":true,"active_listings":100,"documents":true}',2),
 ('enterprise','Enterprise',null,'Teams, API access, multiple branches, advanced workflow, reporting and SLA. Custom quote.',
   '{"enquiries_per_month":null,"trade_rooms":true,"active_listings":null,"documents":true}',3);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organisations(id) on delete cascade,
  plan_code text not null references plans(code),
  status text not null default 'active' check (status in ('active','pending_quote','cancelled')),
  provider text not null default 'simulated',
  provider_ref text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fee_ledger (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references deals(id),
  payer_org_id uuid not null references organisations(id),
  trade_value numeric(18,2) not null,
  currency char(3) not null,
  rate numeric(6,5) not null,
  cap_usd numeric(10,2) not null,
  fee_amount numeric(18,2) not null,
  status text not null default 'accrued' check (status in ('accrued','waived_pilot','invoiced','paid','disputed','void','needs_review')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
