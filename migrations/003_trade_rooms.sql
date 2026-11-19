-- Trade Rooms: negotiation stages with bilateral approval, immutable events and agreement snapshots.

create sequence deal_ref_seq start 1001;

create table deals (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('TTA-' || to_char(now(),'YYYY') || '-' || lpad(nextval('deal_ref_seq')::text, 6, '0')),
  title text not null check (length(title) between 3 and 160),
  listing_id uuid references listings(id) on delete set null,
  buyer_org_id uuid not null references organisations(id),
  seller_org_id uuid not null references organisations(id),
  currency char(3) not null default 'USD',
  status text not null default 'negotiating'
    check (status in ('negotiating','terms_agreed','completed','disputed','cancelled')),
  created_by uuid references users(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (buyer_org_id <> seller_org_id)
);
create index deals_buyer_idx on deals (buyer_org_id);
create index deals_seller_idx on deals (seller_org_id);

create table deal_stages (
  deal_id uuid not null references deals(id) on delete cascade,
  key text not null,
  position int not null,
  name text not null,
  status text not null default 'not_started' check (status in ('not_started','pending','agreed','rejected')),
  revision int not null default 0,
  proposal jsonb,                      -- { fields: {...}, note: "...", summary: "..." }
  proposed_by_side text check (proposed_by_side in ('buyer','seller')),
  proposed_by_user uuid references users(id),
  proposed_at timestamptz,
  buyer_approved_revision int,         -- revision each side approved; green only when both equal revision
  seller_approved_revision int,
  agreed_at timestamptz,
  primary key (deal_id, key)
);

create table deal_events (
  id bigserial primary key,
  deal_id uuid not null references deals(id) on delete cascade,
  stage_key text,
  type text not null,
  side text,
  user_id uuid references users(id),
  revision int,
  payload jsonb not null default '{}',
  at timestamptz not null default now()
);
create index deal_events_deal_idx on deal_events (deal_id, id desc);
create trigger deal_events_append_only before update or delete on deal_events for each row execute function forbid_mutation();

create table deal_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  org_id uuid not null references organisations(id),
  user_id uuid not null references users(id),
  body text not null check (length(body) between 1 and 2000),
  at timestamptz not null default now()
);
create index deal_messages_deal_idx on deal_messages (deal_id, at desc);

create table agreements (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  sha256 text not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deal_id, version)
);

create table deal_completions (
  deal_id uuid not null references deals(id) on delete cascade,
  side text not null check (side in ('buyer','seller')),
  user_id uuid not null references users(id),
  note text check (length(note) <= 1000),
  agreement_version int not null,
  confirmed_at timestamptz not null default now(),
  primary key (deal_id, side)
);

create table deal_disputes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  raised_by_org uuid not null references organisations(id),
  raised_by_user uuid not null references users(id),
  reason text not null check (length(reason) between 5 and 2000),
  status text not null default 'open' check (status in ('open','resolved')),
  previous_status text not null,
  resolution text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
