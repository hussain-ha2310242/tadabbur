-- Tadabbur's database on Supabase: the whole schema in one file.
-- It is already applied to the project; keep this file in step with any change
-- (it is how a fresh project would be set up: paste it into the SQL editor).
--
-- Every personal row has an owner (a Supabase auth user) and row level
-- security lets each person see and change only their own rows. The shared
-- caches (glosses, word info, translations, word forms) belong to no one:
-- anyone signed in can read them, only the server functions write them.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  timezone text not null default 'Asia/Qatar',
  created_at timestamptz not null default now()
);

create table public.texts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  body text not null,
  tokens_json jsonb not null, -- [{text, tokens: [{word, diac, lemma, lemma_key, root, pos, gloss}]}]
  title_tokens jsonb, -- the title's words, analysed like one sentence: {text, tokens}
  importance smallint not null default 2 check (importance between 1 and 3),
  source text,
  url text check (url is null or url ~* '^https?://'),
  created_at timestamptz not null default now(),
  -- what the home page needs, kept up to date by Postgres
  sentence_count int generated always as (jsonb_array_length(tokens_json)) stored,
  word_keys jsonb generated always as (
    jsonb_path_query_array(tokens_json,
      '$[*].tokens[*] ? (!exists(@.pos ? (@ == "punc" || @ == "digit")) && exists(@.lemma_key ? (@ != ""))).lemma_key')
  ) stored,
  excerpt text generated always as (left(btrim(regexp_replace(left(body, 400), '\s+', ' ', 'g')), 160)) stored
);
create index texts_user_idx on public.texts (user_id);

create table public.words (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lemma_key text not null,
  display text not null,
  is_phrase boolean not null default false,
  root text,
  pos text,
  gloss text,
  notes text,
  status text not null default 'not_known' check (status in ('not_known', 'hard', 'easy', 'known')),
  importance smallint not null default 0 check (importance between 0 and 3),
  card_json jsonb, -- the FSRS card (ts-fsrs)
  due timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, lemma_key)
);
create index words_due_idx on public.words (user_id, status, due);

create table public.tags (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  unique (user_id, name)
);

create table public.text_tags (
  text_id bigint not null references public.texts (id) on delete cascade,
  tag_id bigint not null references public.tags (id) on delete cascade,
  primary key (text_id, tag_id)
);
create index text_tags_tag_idx on public.text_tags (tag_id);

-- Claude-produced study data for a note: sentence translations and word meanings in context
create table public.note_analysis (
  text_id bigint primary key references public.texts (id) on delete cascade,
  analysis_json jsonb not null,
  created_at timestamptz not null default now()
);

-- your edits to a word's meaning or root; they win over everything else
create table public.meaning_overrides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lemma_key text not null,
  gloss text,
  root text,
  primary key (user_id, lemma_key)
);

-- phrases and notes on a span of words (it may cross sentences); each is also a flashcard
create table public.annotations (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text_id bigint not null references public.texts (id) on delete cascade,
  start_si integer not null,
  start_ti integer not null,
  end_si integer not null,
  end_ti integer not null,
  quote text not null,
  meaning text,
  comment text not null default '',
  status text not null default 'not_known' check (status in ('not_known', 'hard', 'easy', 'known')),
  importance smallint not null default 0 check (importance between 0 and 3),
  card_json jsonb,
  due timestamptz,
  created_at timestamptz not null default now()
);
create index annotations_text_idx on public.annotations (text_id);
create index annotations_due_idx on public.annotations (user_id, status, due);

-- what each person studied each day, in their own time zone: the streak
create table public.activity (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  reviews integer not null default 0,
  marks integer not null default 0,
  texts integer not null default 0,
  new_words integer not null default 0, -- words and phrases you started learning
  cleared boolean not null default false, -- nothing was left to review (as last seen)
  goal_new smallint, -- the daily goal in force that day; null before goals existed
  goal_reviews smallint,
  primary key (user_id, day)
);

create table public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  primary key (user_id, key)
);

-- shared caches
create table public.glosses (
  lemma_key text primary key,
  gloss text not null
);
create table public.word_info (
  lemma_key text primary key,
  info_json jsonb not null,
  created_at timestamptz not null default now()
);
create table public.translations (
  key text primary key,
  translation text not null
);
create table public.word_forms (
  form text primary key, -- a word as written
  info jsonb not null, -- {lemma, root, pos, gloss, diac}
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.texts enable row level security;
alter table public.words enable row level security;
alter table public.tags enable row level security;
alter table public.text_tags enable row level security;
alter table public.note_analysis enable row level security;
alter table public.meaning_overrides enable row level security;
alter table public.annotations enable row level security;
alter table public.activity enable row level security;
alter table public.settings enable row level security;
alter table public.glosses enable row level security;
alter table public.word_info enable row level security;
alter table public.translations enable row level security;
alter table public.word_forms enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own texts" on public.texts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own words" on public.words for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tags" on public.tags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own text tags" on public.text_tags for all to authenticated
  using (exists (select 1 from public.texts t where t.id = text_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.texts t where t.id = text_id and t.user_id = (select auth.uid())));
create policy "own note analysis" on public.note_analysis for all to authenticated
  using (exists (select 1 from public.texts t where t.id = text_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from public.texts t where t.id = text_id and t.user_id = (select auth.uid())));
create policy "own overrides" on public.meaning_overrides for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own annotations" on public.annotations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own activity" on public.activity for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "read glosses" on public.glosses for select to authenticated using (true);
create policy "read word info" on public.word_info for select to authenticated using (true);
create policy "read translations" on public.translations for select to authenticated using (true);
create policy "read word forms" on public.word_forms for select to authenticated using (true);

-- ---------------------------------------------------------------- functions

-- a profile for every new account, named from the sign-up details when given
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- one study event today, in the user's own time zone. Kinds: reviews, marks,
-- texts, new_words (words and phrases you started learning), cleared and
-- uncleared (whether anything is left to review: the app records the state it
-- last saw, so the day ends with the latest), goal (the goal changed: only
-- re-stamps today)
create or replace function public.log_activity(kind text, n int default 1)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  d date;
  gn smallint;
  gr smallint;
  -- only the app's own goal signals stamp a day with the goal; other events
  -- leave the stamp as it is (so an older app never stamps a day it cannot meet)
  stamp boolean := kind in ('new_words', 'cleared', 'uncleared', 'goal');
begin
  if uid is null or n <= 0 then return; end if;
  if kind not in ('reviews', 'marks', 'texts', 'new_words', 'cleared', 'uncleared', 'goal') then
    raise exception 'unknown activity kind: %', kind;
  end if;
  d := (now() at time zone coalesce((select p.timezone from public.profiles p where p.id = uid), 'Asia/Qatar'))::date;
  gn := coalesce((select least(greatest(s.value::int, 1), 500) from public.settings s
                   where s.user_id = uid and s.key = 'goal_new' and s.value ~ '^[0-9]{1,4}$'), 5);
  gr := coalesce((select least(greatest(s.value::int, 1), 500) from public.settings s
                   where s.user_id = uid and s.key = 'goal_reviews' and s.value ~ '^[0-9]{1,4}$'), 10);
  insert into public.activity (user_id, day, reviews, marks, texts, new_words, cleared, goal_new, goal_reviews)
  values (uid, d,
          case when kind = 'reviews' then n else 0 end,
          case when kind = 'marks' then n else 0 end,
          case when kind = 'texts' then n else 0 end,
          case when kind = 'new_words' then n else 0 end,
          kind = 'cleared',
          case when stamp then gn end,
          case when stamp then gr end)
  on conflict (user_id, day) do update set
    reviews = public.activity.reviews + excluded.reviews,
    marks = public.activity.marks + excluded.marks,
    texts = public.activity.texts + excluded.texts,
    new_words = public.activity.new_words + excluded.new_words,
    cleared = case kind when 'cleared' then true when 'uncleared' then false else public.activity.cleared end,
    goal_new = coalesce(excluded.goal_new, public.activity.goal_new),
    goal_reviews = coalesce(excluded.goal_reviews, public.activity.goal_reviews);
end $$;

-- the home page: every note with its progress, tags and whether it has study data
create or replace function public.texts_overview()
returns table (id bigint, title text, importance smallint, created_at timestamptz, source text, url text,
               sentences int, words int, to_learn int, excerpt text, tags jsonb, has_analysis boolean)
language sql stable security invoker set search_path = '' as $$
  with known as (
    select w.lemma_key from public.words w where w.user_id = auth.uid() and w.status = 'known'
  )
  select t.id, t.title, t.importance, t.created_at, t.source, t.url, t.sentence_count,
         (select count(distinct k)::int from jsonb_array_elements_text(t.word_keys) k),
         (select count(distinct k)::int from jsonb_array_elements_text(t.word_keys) k
            where k not in (select lemma_key from known)),
         t.excerpt,
         coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
                     from public.text_tags tt join public.tags g on g.id = tt.tag_id
                    where tt.text_id = t.id), '[]'::jsonb),
         exists (select 1 from public.note_analysis na where na.text_id = t.id)
    from public.texts t
   where t.user_id = auth.uid()
   order by t.importance desc, t.id desc
$$;

-- your level for each word of one text
create or replace function public.text_statuses(p_text_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(w.lemma_key, w.status), '{}'::jsonb)
    from public.words w
   where w.user_id = auth.uid()
     and w.lemma_key in (select jsonb_array_elements_text(t.word_keys) from public.texts t where t.id = p_text_id)
$$;

-- your level and stars for each word of one text, the title included:
-- { lemma_key: { "s": status, "i": importance } }
create or replace function public.text_marks(p_text_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with keys as (
    select jsonb_array_elements_text(t.word_keys) k from public.texts t where t.id = p_text_id
    union
    select jsonb_path_query(t.title_tokens,
             '$.tokens[*] ? (!exists(@.pos ? (@ == "punc" || @ == "digit")) && exists(@.lemma_key ? (@ != ""))).lemma_key') #>> '{}'
      from public.texts t where t.id = p_text_id and t.title_tokens is not null
  )
  select coalesce(jsonb_object_agg(w.lemma_key, jsonb_build_object('s', w.status, 'i', w.importance)), '{}'::jsonb)
    from public.words w
   where w.user_id = auth.uid() and w.lemma_key in (select k from keys)
$$;

-- every word of a text into the wallet as known, the title's words too
create or replace function public.mark_all_known(p_text_id bigint)
returns int language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  insert into public.words (user_id, lemma_key, display, root, pos, gloss, status)
  select distinct on (tok->>'lemma_key')
         auth.uid(), tok->>'lemma_key', coalesce(tok->>'lemma', tok->>'word'), tok->>'root', tok->>'pos', tok->>'gloss', 'known'
    from public.texts t,
         jsonb_path_query(
           case when t.title_tokens is null then t.tokens_json else t.tokens_json || jsonb_build_array(t.title_tokens) end,
           '$[*].tokens[*] ? (!exists(@.pos ? (@ == "punc" || @ == "digit")) && exists(@.lemma_key ? (@ != "")))') tok
   where t.id = p_text_id and t.user_id = auth.uid()
  on conflict (user_id, lemma_key) do update set status = 'known';
  get diagnostics n = row_count;
  perform public.log_activity('marks');
  return n;
end $$;

-- the numbers on the home line and the profile
create or replace function public.study_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n)
                             from (select w.status, count(*) n from public.words w
                                    where w.user_id = auth.uid() and not w.is_phrase group by w.status) s), '{}'::jsonb),
    'phrases', (select count(*) from public.words w where w.user_id = auth.uid() and w.is_phrase),
    'due', (select count(*) from public.words w
             where w.user_id = auth.uid() and w.status <> 'known' and (w.due is null or w.due <= now()))
         + (select count(*) from public.annotations a
             where a.user_id = auth.uid() and a.status <> 'known' and (a.due is null or a.due <= now())),
    'texts', (select count(*) from public.texts t where t.user_id = auth.uid()),
    'reviews', (select coalesce(sum(a.reviews), 0) from public.activity a where a.user_id = auth.uid())
  )
$$;

revoke execute on function public.log_activity(text, int) from public, anon;
revoke execute on function public.texts_overview() from public, anon;
revoke execute on function public.text_statuses(bigint) from public, anon;
revoke execute on function public.text_marks(bigint) from public, anon;
revoke execute on function public.mark_all_known(bigint) from public, anon;
revoke execute on function public.study_counts() from public, anon;
grant execute on function public.log_activity(text, int) to authenticated;
grant execute on function public.texts_overview() to authenticated;
grant execute on function public.text_statuses(bigint) to authenticated;
grant execute on function public.text_marks(bigint) to authenticated;
grant execute on function public.mark_all_known(bigint) to authenticated;
grant execute on function public.study_counts() to authenticated;

-- ---------------------------------------------------------------- limits and leaving

-- how many Fanar calls each person made today, per kind; only take_quota writes it
create table public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null,
  n integer not null default 0,
  primary key (user_id, day, kind)
);
alter table public.usage enable row level security;
create policy "read own usage" on public.usage for select to authenticated using (user_id = (select auth.uid()));

-- count one call of `kind` for the caller today; true while under the cap
create or replace function public.take_quota(p_kind text, p_cap integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.usage (user_id, day, kind, n)
  values (auth.uid(), (now() at time zone 'utc')::date, left(p_kind, 20), 1)
  on conflict (user_id, day, kind) do update set n = public.usage.n + 1
  returning n into used;
  return used <= p_cap;
end $$;
revoke execute on function public.take_quota(text, integer) from public, anon;
grant execute on function public.take_quota(text, integer) to authenticated;

-- a person can remove their own account; their notes, words and history go with it (on delete cascade)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- storage

-- spoken sentences, saved once (private: only the server functions read and write it)
insert into storage.buckets (id, name, public) values ('tts', 'tts', false) on conflict (id) do nothing;
