-- Core identity, tenancy and audit.

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 160),
  org_type text not null check (org_type in ('manufacturer','exporter','importer','buyer','distributor','logistics','finance','verification')),
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  city text check (length(city) <= 100),
  registration_number text check (length(registration_number) <= 80),
  website text check (length(website) <= 200),
  description text not null default '' check (length(description) <= 4000),
  sectors text[] not null default '{}',
  is_demo boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) <= 254),
  full_name text not null check (length(full_name) between 2 and 120),
  password_hash text not null,
  platform_role text not null default 'user' check (platform_role in ('user','reviewer','platform_admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_uq on users (email);

create table memberships (
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references organisations(id) on delete cascade,
  role text not null check (role in ('owner','admin','trader','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index memberships_org_idx on memberships (org_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references organisations(id) on delete set null,
  csrf_token text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user_idx on sessions (user_id);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_org_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  data jsonb not null default '{}',
  ip text
);
create index audit_log_at_idx on audit_log (at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create trigger audit_log_append_only before update or delete on audit_log for each row execute function forbid_mutation();

create table partnership_enquiries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(full_name) between 1 and 100),
  company text not null check (length(company) between 1 and 100),
  email text check (length(email) <= 254),
  partner_type text not null check (length(partner_type) <= 50),
  message text not null check (length(message) between 1 and 1000),
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
