-- Minus: accounts, devices, agents and their conversations.
-- Every row belongs to one person, and row level security makes sure only that person
-- (signed in on any of their devices) can read or change it. API keys are NOT stored
-- here: they stay on the computer that uses them.

create extension if not exists pgcrypto;

-- ───────── people ─────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  github_login text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- fill a profile from the GitHub login on sign up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, github_login, name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'user_name',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'user_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── devices: your PCs (which are also computers agents can use) and phones ─────────
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('desktop', 'phone')),
  platform text not null check (platform in ('windows', 'macos', 'linux', 'android')),
  app_version text,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ───────── computers agents work on: a desktop device, or a cloud machine in your own account ─────────
create table public.computers (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  kind text not null check (kind in ('local', 'cloud')),
  device_id uuid references public.devices on delete set null,
  provider text,          -- cloud: hetzner, digitalocean, ...
  region text,
  provider_ref text,      -- the provider's id for the machine (never a key)
  status text not null default 'ready',
  created_at timestamptz not null default now()
);

-- ───────── agents ─────────
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  role text not null default '',
  instructions text not null default '',
  color text not null,
  emotion text not null default 'neutral',
  outfit jsonb not null default '{}',
  voice text,
  model text not null default 'claude',
  computer_id uuid references public.computers on delete set null,
  perms jsonb not null default '{}',
  status text not null default 'idle',
  status_text text not null default 'Ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── conversations: one stream of messages per agent ─────────
-- body holds the message itself: text, steps cards, approvals, questions...
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  agent_id uuid not null references public.agents on delete cascade,
  sender text not null check (sender in ('me', 'agent', 'system')),
  kind text,
  body jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_agent_time on public.messages (agent_id, created_at);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  agent_id uuid not null references public.agents on delete cascade,
  name text not null,
  schedule text not null,  -- cron
  enabled boolean not null default true,
  last_run timestamptz,
  created_at timestamptz not null default now()
);

-- ───────── QR pairing: a PC shows a code, your phone scans it and is signed in ─────────
-- Codes are single use and expire after 5 minutes. Redeeming one happens in the
-- "pair" edge function, which is the only thing allowed to read this table.
create table public.pairing_codes (
  code text primary key default encode(gen_random_bytes(24), 'hex'),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  device_name text,
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz
);

-- ───────── only you see your things ─────────
do $$
declare t text;
begin
  foreach t in array array['devices', 'computers', 'agents', 'messages', 'routines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
alter table public.pairing_codes enable row level security;
-- you can make codes for yourself, but nobody can read them back through the API
create policy "make own codes" on public.pairing_codes for insert with check (owner = auth.uid());

-- keep updated_at fresh
create function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger agents_touch before update on public.agents for each row execute function public.touch();
create trigger messages_touch before update on public.messages for each row execute function public.touch();

-- live updates to every signed-in device
alter publication supabase_realtime add table public.agents, public.messages, public.devices, public.computers;
