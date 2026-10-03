-- =====================================================================
-- GreenWise — database schema v1
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it ONCE on a fresh project.
-- =====================================================================

-- ---------- helper: keep updated_at fresh ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles (one row per user, created automatically) ----------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text check (char_length(full_name) <= 100),
  currency            text not null default 'NGN' check (char_length(currency) = 3),
  starting_balance    numeric(14,2) not null default 0,          -- money on hand when they started
  balance_as_of       date not null default current_date,        -- transactions from this date count
  emergency_buffer    numeric(14,2) not null default 0 check (emergency_buffer >= 0),
  focus_areas         text[] not null default '{}',              -- onboarding step 7 answers
  alert_settings      jsonb not null default
                        '{"budget_warn_pct": 80, "unplanned_per_week": 5, "large_purchase_pct": 20}'::jsonb,
  onboarding_complete boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------- income sources (supports irregular + multiple incomes) ----------
-- Amounts are per payment for weekly/biweekly/monthly, per MONTH for irregular.
create table public.income_sources (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  income_type       text not null check (income_type in
                      ('salary','business','freelance','allowance','commission','other')),
  frequency         text not null check (frequency in ('weekly','biweekly','monthly','irregular')),
  expected_amount   numeric(14,2) not null check (expected_amount >= 0),
  minimum_amount    numeric(14,2) not null check (minimum_amount >= 0),
  optimistic_amount numeric(14,2) check (optimistic_amount >= 0),
  next_pay_date     date,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (minimum_amount <= expected_amount),
  check (optimistic_amount is null or optimistic_amount >= expected_amount),
  unique (id, user_id)
);

-- ---------- categories (defaults seeded per user, fully customisable) ----------
create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  kind         text not null default 'expense' check (kind in ('expense','income')),
  is_essential boolean not null default false,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, kind, name),
  unique (id, user_id)
);

-- ---------- goals ----------
create table public.goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  target_amount   numeric(14,2) not null check (target_amount > 0),
  starting_amount numeric(14,2) not null default 0 check (starting_amount >= 0),
  deadline        date,
  priority        smallint not null default 3 check (priority between 1 and 5),
  status          text not null default 'active'
                    check (status in ('active','achieved','paused','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- debts (balance = opening_balance − recorded repayments) ----------
create table public.debts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  creditor            text not null check (char_length(creditor) between 1 and 80),
  original_amount     numeric(14,2) not null check (original_amount > 0),
  opening_balance     numeric(14,2) not null check (opening_balance >= 0),
  interest_rate       numeric(7,3) not null default 0 check (interest_rate between 0 and 1000), -- annual %
  minimum_payment     numeric(14,2) not null default 0 check (minimum_payment >= 0),
  repayment_frequency text not null default 'monthly'
                        check (repayment_frequency in ('weekly','biweekly','monthly','one_off')),
  next_due_date       date,
  start_date          date,
  custom_priority     smallint check (custom_priority >= 1),
  status              text not null default 'active' check (status in ('active','paid_off')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- recurring obligations (rent, school fees, bills...) ----------
create table public.obligations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  amount        numeric(14,2) not null check (amount > 0),
  category_id   uuid,
  frequency     text not null check (frequency in
                  ('once','weekly','biweekly','monthly','quarterly','yearly')),
  next_due_date date not null,
  is_essential  boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id)
);

-- ---------- transactions (the data layer — manual now, bank later) ----------
create table public.transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type             text not null check (type in
                     ('income','expense','savings','transfer','debt_repayment')),
  amount           numeric(14,2) not null check (amount > 0),
  category_id      uuid,
  description      text check (char_length(description) <= 200),
  occurred_on      date not null default current_date,
  necessity        text check (necessity in ('need','want')),
  is_planned       boolean,
  payment_method   text check (char_length(payment_method) <= 40),
  source           text not null default 'manual' check (source in ('manual','bank')),
  external_id      text,                        -- bank's transaction id (future, prevents duplicates)
  goal_id          uuid,                        -- savings towards a goal
  debt_id          uuid,                        -- repayment of a debt
  obligation_id    uuid,                        -- payment of a known obligation
  income_source_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, source, external_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id)
    on delete set null (goal_id),
  foreign key (debt_id, user_id) references public.debts (id, user_id)
    on delete set null (debt_id),
  foreign key (obligation_id, user_id) references public.obligations (id, user_id)
    on delete set null (obligation_id),
  foreign key (income_source_id, user_id) references public.income_sources (id, user_id)
    on delete set null (income_source_id)
);

-- ---------- monthly category budgets ----------
create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id   uuid not null,
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, category_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete cascade
);

-- ---------- accountability commitments ----------
create table public.commitments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('spend_limit','save_target','no_unplanned')),
  title       text not null check (char_length(title) between 1 and 120),
  category_id uuid,                  -- spend_limit on one category (null = all discretionary)
  goal_id     uuid,                  -- save_target linked to a goal (optional)
  amount      numeric(14,2) check (amount > 0),
  start_date  date not null default current_date,
  end_date    date not null,
  status      text not null default 'active'
                check (status in ('active','kept','broken','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date),
  check (kind = 'no_unplanned' or amount is not null),
  foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id)
    on delete set null (goal_id)
);

-- ---------- scale of preference ----------
create table public.priorities (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 80),
  amount            numeric(14,2) not null check (amount >= 0),
  due_date          date,
  necessity         text not null check (necessity in ('need','want')),
  urgency           smallint not null default 3 check (urgency between 1 and 5),
  delay_consequence smallint not null default 3 check (delay_consequence between 1 and 5),
  manual_rank       integer check (manual_rank >= 1),   -- user override
  status            text not null default 'open' check (status in ('open','done','dropped')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- "Can I afford it / Should I buy it" history ----------
create table public.purchase_decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item        text not null check (char_length(item) between 1 and 120),
  price       numeric(14,2) not null check (price > 0),
  reason      text check (char_length(reason) <= 300),
  necessity   text not null check (necessity in ('need','want')),
  needed_by   date,
  category_id uuid,
  result      jsonb not null default '{}'::jsonb,     -- snapshot of the engine's verdict
  outcome     text not null default 'pending'
                check (outcome in ('pending','bought','postponed','skipped')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id)
    on delete set null (category_id)
);

-- ---------- alerts are computed live; this only remembers dismissals ----------
create table public.alert_dismissals (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  alert_key    text not null check (char_length(alert_key) <= 200),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, alert_key)
);

-- ---------- indexes ----------
create index transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index transactions_goal_idx      on public.transactions (goal_id) where goal_id is not null;
create index transactions_debt_idx      on public.transactions (debt_id) where debt_id is not null;
create index income_sources_user_idx    on public.income_sources (user_id);
create index goals_user_idx             on public.goals (user_id);
create index debts_user_idx             on public.debts (user_id);
create index obligations_user_idx       on public.obligations (user_id);
create index commitments_user_idx       on public.commitments (user_id);
create index priorities_user_idx        on public.priorities (user_id);
create index purchase_decisions_user_idx on public.purchase_decisions (user_id);

-- ---------- row level security: every user sees only their own rows ----------
alter table public.profiles enable row level security;

create policy "own profile select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- no insert/delete policy: profiles are created by the signup trigger
-- and removed automatically when the account is deleted.

do $$
declare
  t text;
begin
  foreach t in array array[
    'income_sources','categories','goals','debts','obligations','transactions',
    'budgets','commitments','priorities','purchase_decisions','alert_dismissals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows select" on public.%I for select to authenticated
         using ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows insert" on public.%I for insert to authenticated
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows update" on public.%I for update to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "own rows delete" on public.%I for delete to authenticated
         using ((select auth.uid()) = user_id)', t);
  end loop;

  foreach t in array array[
    'profiles','income_sources','goals','debts','obligations','transactions',
    'budgets','commitments','priorities','purchase_decisions'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- logged-out visitors get nothing; logged-in users get CRUD, filtered by the policies above
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------- on signup: create profile + default categories ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100), ''));

  insert into public.categories (user_id, name, kind, is_essential)
  select new.id, c.name, c.kind, c.essential
  from (values
    ('Food','expense',true), ('Transport','expense',true), ('Housing','expense',true),
    ('Education','expense',true), ('Bills','expense',true), ('Health','expense',true),
    ('Shopping','expense',false), ('Entertainment','expense',false),
    ('Subscriptions','expense',false), ('Family','expense',false),
    ('Debt','expense',true), ('Savings','expense',false), ('Investment','expense',false),
    ('Other','expense',false),
    ('Salary','income',false), ('Business','income',false), ('Freelance','income',false),
    ('Allowance','income',false), ('Commission','income',false), ('Other income','income',false)
  ) as c(name, kind, essential);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
