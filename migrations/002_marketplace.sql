-- Marketplace: supplier offers and buyer requests, with full text search.

create table listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  kind text not null check (kind in ('offer','request')),
  title text not null check (length(title) between 3 and 140),
  description text not null default '' check (length(description) <= 5000),
  category text not null check (length(category) between 2 and 60),
  hs_code text check (hs_code ~ '^[0-9]{2,10}$'),
  origin_country char(2) check (origin_country ~ '^[A-Z]{2}$'),
  destination_country char(2) check (destination_country ~ '^[A-Z]{2}$'),
  quantity numeric(18,3) check (quantity > 0),
  unit text check (length(unit) <= 30),
  price_min numeric(18,2) check (price_min >= 0),
  price_max numeric(18,2) check (price_max >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  incoterms text[] not null default '{}',
  lead_time_days int check (lead_time_days between 0 and 730),
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  is_demo boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(category,'') || ' ' || coalesce(hs_code,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) stored,
  check (price_max is null or price_min is null or price_max >= price_min)
);
create index listings_search_idx on listings using gin (search);
create index listings_filter_idx on listings (status, kind, category);
create index listings_org_idx on listings (org_id);

create table enquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  from_org_id uuid not null references organisations(id) on delete cascade,
  from_user_id uuid not null references users(id),
  message text not null check (length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open','responded','closed')),
  response text check (length(response) <= 2000),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index enquiries_listing_idx on enquiries (listing_id);
create index enquiries_from_idx on enquiries (from_org_id, created_at);
