-- CodeAssist application data. Supabase Auth owns the identities.
create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_id_user_unique unique (id, user_id)
);
create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 30000),
  created_at timestamptz not null default now(),
  constraint messages_conversation_user_fk foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

-- Provider references are inaccessible to browser roles. The server checks the
-- owner through RLS before reading or writing this service-role-only mapping.
create table if not exists public.conversation_provider_refs (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_conversation_id text not null unique,
  created_at timestamptz not null default now(),
  constraint provider_ref_conversation_user_fk foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);

create table if not exists public.chat_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null default (now() at time zone 'utc')::date,
  messages integer not null default 0 check (messages >= 0),
  primary key (user_id, usage_day)
);
create table if not exists public.chat_usage_global (
  usage_day date primary key default (now() at time zone 'utc')::date,
  messages integer not null default 0 check (messages >= 0)
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_provider_refs enable row level security;
alter table public.chat_usage enable row level security;
alter table public.chat_usage_global enable row level security;

grant select, insert, delete on public.conversations to authenticated;
grant update (title, updated_at) on public.conversations to authenticated;
grant select, delete on public.messages to authenticated;
revoke insert on public.messages from anon, authenticated;
revoke all on public.conversation_provider_refs from anon, authenticated;
revoke all on public.chat_usage from anon, authenticated;
revoke all on public.chat_usage_global from anon, authenticated;
grant all on public.messages, public.conversation_provider_refs, public.chat_usage, public.chat_usage_global to service_role;

drop policy if exists "users read own conversations" on public.conversations;
create policy "users read own conversations" on public.conversations
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users create own conversations" on public.conversations;
create policy "users create own conversations" on public.conversations
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "users update own conversations" on public.conversations;
create policy "users update own conversations" on public.conversations
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "users delete own conversations" on public.conversations;
create policy "users delete own conversations" on public.conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "users read own messages" on public.messages;
create policy "users read own messages" on public.messages
  for select to authenticated using (
    (select auth.uid()) = user_id and exists (
      select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );
drop policy if exists "users delete own messages" on public.messages;
create policy "users delete own messages" on public.messages
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Supabase service_role bypasses RLS; ordinary authenticated users get no policy.
drop policy if exists "provider refs are private" on public.conversation_provider_refs;
drop policy if exists "usage is private" on public.chat_usage;

create or replace function public.consume_chat_quota(p_daily_limit integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
  v_global_count integer;
  v_limit integer := least(greatest(coalesce(p_daily_limit, 30), 1), 30);
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('codeassist-global:' || v_day::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  select messages into v_global_count from public.chat_usage_global where usage_day = v_day;
  if coalesce(v_global_count, 0) >= 100 then raise exception 'global_daily_limit'; end if;
  select messages into v_count from public.chat_usage where user_id = v_user and usage_day = v_day;
  v_count := coalesce(v_count, 0);
  if v_count >= v_limit then raise exception 'daily_limit'; end if;
  insert into public.chat_usage (user_id, usage_day, messages) values (v_user, v_day, 1)
    on conflict (user_id, usage_day) do update set messages = public.chat_usage.messages + 1
    returning messages into v_count;
  insert into public.chat_usage_global (usage_day, messages) values (v_day, 1)
    on conflict (usage_day) do update set messages = public.chat_usage_global.messages + 1;
  return v_count;
end;
$$;
revoke all on function public.consume_chat_quota(integer) from public, anon;
grant execute on function public.consume_chat_quota(integer) to authenticated;

