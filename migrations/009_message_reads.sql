-- Tracks when each user last opened a Trade Room, for unread message counts in the Messages inbox.
create table deal_reads (
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);
