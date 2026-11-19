-- Team invitations. The token is shown once to the inviter; only its hash is stored.
create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('admin','trader','viewer')),
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on invitations (org_id);
