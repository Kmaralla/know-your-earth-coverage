create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null check (char_length(handle) >= 3),
  display_name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists coverage_world (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  country_code text not null,
  created_at timestamptz not null default now(),
  unique (user_id, country_code)
);

create table if not exists coverage_country (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  country_code text not null,
  state_id text not null default '',
  city_id text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists connections (
  id bigint generated always as identity primary key,
  sender_id uuid not null references profiles (id) on delete cascade,
  receiver_id uuid not null references profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'rejected', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sender_id, receiver_id),
  check (sender_id <> receiver_id)
);

alter table profiles enable row level security;
alter table coverage_world enable row level security;
alter table coverage_country enable row level security;
alter table connections enable row level security;

drop policy if exists "profiles_public_read" on profiles;
create policy "profiles_public_read"
on profiles for select
using (true);

drop policy if exists "profiles_owner_write" on profiles;
create policy "profiles_owner_write"
on profiles for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "coverage_owner_manage_world" on coverage_world;
create policy "coverage_owner_manage_world"
on coverage_world for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "coverage_directional_read_world" on coverage_world;
create policy "coverage_directional_read_world"
on coverage_world for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from connections c
    where c.sender_id = coverage_world.user_id
      and c.receiver_id = auth.uid()
      and c.status = 'accepted'
  )
);

drop policy if exists "coverage_owner_manage_country" on coverage_country;
create policy "coverage_owner_manage_country"
on coverage_country for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "coverage_directional_read_country" on coverage_country;
create policy "coverage_directional_read_country"
on coverage_country for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from connections c
    where c.sender_id = coverage_country.user_id
      and c.receiver_id = auth.uid()
      and c.status = 'accepted'
  )
);

drop policy if exists "connections_sender_or_receiver_read" on connections;
create policy "connections_sender_or_receiver_read"
on connections for select
using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "connections_sender_insert" on connections;
create policy "connections_sender_insert"
on connections for insert
with check (auth.uid() = sender_id);

drop policy if exists "connections_sender_update" on connections;
create policy "connections_sender_update"
on connections for update
using (auth.uid() = sender_id);

drop policy if exists "connections_receiver_update_status" on connections;
create policy "connections_receiver_update_status"
on connections for update
using (auth.uid() = receiver_id);

-- ── Groups ────────────────────────────────────────────────────────

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) >= 1),
  created_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table groups enable row level security;
alter table group_members enable row level security;

-- Groups: creator can always see it; members can see it too
drop policy if exists "groups_select" on groups;
create policy "groups_select" on groups for select
using (
  auth.uid() = created_by
  or exists (
    select 1 from group_members gm
    where gm.group_id = groups.id and gm.user_id = auth.uid()
  )
);

drop policy if exists "groups_insert" on groups;
create policy "groups_insert" on groups for insert
with check (auth.uid() = created_by);

drop policy if exists "groups_delete" on groups;
create policy "groups_delete" on groups for delete
using (auth.uid() = created_by);

-- Group members: any member of the group can read the member list
drop policy if exists "group_members_select" on group_members;
create policy "group_members_select" on group_members for select
using (
  exists (
    select 1 from group_members gm2
    where gm2.group_id = group_members.group_id and gm2.user_id = auth.uid()
  )
);

-- Only the group creator can add members
drop policy if exists "group_members_insert" on group_members;
create policy "group_members_insert" on group_members for insert
with check (
  exists (
    select 1 from groups g
    where g.id = group_members.group_id and g.created_by = auth.uid()
  )
);

-- Group creator can remove members
drop policy if exists "group_members_delete" on group_members;
create policy "group_members_delete" on group_members for delete
using (
  exists (
    select 1 from groups g
    where g.id = group_members.group_id and g.created_by = auth.uid()
  )
);
