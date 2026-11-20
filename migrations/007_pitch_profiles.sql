-- Illustrative pitch profiles: real company names shown for discussion only, never as live participants.
-- Hidden from signed-out visitors and always labelled with pitch_notice.
alter table organisations add column pitch_preview boolean not null default false;
alter table organisations add column pitch_notice text check (length(pitch_notice) <= 500);
