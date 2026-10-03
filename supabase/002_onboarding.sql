-- =====================================================================
-- GreenWise — step 4: save onboarding in one go
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Everything is saved together or not at all, so a dropped connection
-- can never leave half an onboarding behind.
-- Runs as the signed-in user, so the row security rules still apply.
-- =====================================================================

create or replace function public.complete_onboarding(payload jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  today date := coalesce((payload ->> 'today')::date, current_date);
  r     jsonb;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  if (select onboarding_complete from public.profiles where id = uid) then
    raise exception 'Onboarding is already complete';
  end if;

  if jsonb_array_length(coalesce(payload -> 'income_sources', '[]')) = 0 then
    raise exception 'Add at least one income source';
  end if;

  update public.profiles set
    currency            = coalesce(payload ->> 'currency', currency),
    starting_balance    = greatest(coalesce((payload ->> 'starting_balance')::numeric, 0), 0),
    emergency_buffer    = greatest(coalesce((payload ->> 'emergency_buffer')::numeric, 0), 0),
    focus_areas         = array(
                            select x from jsonb_array_elements_text(coalesce(payload -> 'focus_areas', '[]')) x
                            where x in ('impulse','overspending','save_more','debt','irregular_income','goal')
                          ),
    balance_as_of       = today,
    onboarding_complete = true
  where id = uid;

  for r in select * from jsonb_array_elements(payload -> 'income_sources') loop
    insert into public.income_sources
      (user_id, name, income_type, frequency, expected_amount, minimum_amount, optimistic_amount, next_pay_date)
    values
      (uid, r ->> 'name', r ->> 'income_type', r ->> 'frequency',
       (r ->> 'expected_amount')::numeric, (r ->> 'minimum_amount')::numeric,
       nullif(r ->> 'optimistic_amount', '')::numeric, nullif(r ->> 'next_pay_date', '')::date);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(payload -> 'obligations', '[]')) loop
    insert into public.obligations
      (user_id, name, amount, frequency, next_due_date, is_essential, category_id)
    values
      (uid, r ->> 'name', (r ->> 'amount')::numeric, r ->> 'frequency', (r ->> 'next_due_date')::date,
       coalesce((r ->> 'is_essential')::boolean, true),
       (select c.id from public.categories c
         where c.user_id = uid and c.kind = 'expense' and c.name = r ->> 'category'));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(payload -> 'goals', '[]')) loop
    insert into public.goals (user_id, name, target_amount, starting_amount, deadline, priority)
    values
      (uid, r ->> 'name', (r ->> 'target_amount')::numeric,
       coalesce((r ->> 'starting_amount')::numeric, 0),
       nullif(r ->> 'deadline', '')::date, coalesce((r ->> 'priority')::smallint, 3));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(payload -> 'debts', '[]')) loop
    insert into public.debts
      (user_id, creditor, original_amount, opening_balance, interest_rate, minimum_payment,
       repayment_frequency, next_due_date, start_date)
    values
      (uid, r ->> 'creditor',
       greatest(coalesce(nullif(r ->> 'original_amount', '')::numeric, 0), (r ->> 'balance')::numeric),
       (r ->> 'balance')::numeric,
       coalesce(nullif(r ->> 'interest_rate', '')::numeric, 0),
       coalesce((r ->> 'minimum_payment')::numeric, 0),
       coalesce(r ->> 'repayment_frequency', 'monthly'),
       nullif(r ->> 'next_due_date', '')::date, today);
  end loop;
end;
$$;

revoke execute on function public.complete_onboarding(jsonb) from public, anon;
grant execute on function public.complete_onboarding(jsonb) to authenticated;
