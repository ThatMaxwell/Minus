-- Your phone and your PC, linked through your account. The PC mirrors its agents and their
-- conversations here; your phone reads them live and writes back your messages and
-- decisions (approve, decline, a choice); the PC picks those up and acts on them.
-- Rows are matched by the app's own ids (local_id), so both sides talk about the same thing.

alter table public.agents add column if not exists local_id text;
alter table public.agents add column if not exists snapshot jsonb not null default '{}';
create unique index if not exists agents_owner_local on public.agents (owner, local_id);

alter table public.messages add column if not exists local_id text;
-- the device that last wrote the row, so nobody acts on their own changes
alter table public.messages add column if not exists origin text;
create unique index if not exists messages_owner_local on public.messages (owner, local_id);

-- updates arrive with the whole row
alter table public.agents replica identity full;
alter table public.messages replica identity full;
