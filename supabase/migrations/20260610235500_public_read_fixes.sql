drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon,authenticated using (active=true);

create or replace function public.get_bookable_dates(p_service_id text)
returns table(date text)
language sql stable security definer set search_path=public
as $$
  select to_char(d,'YYYY-MM-DD') from generate_series(current_date,current_date+interval '90 days',interval '1 day')g(d)
  where exists(select 1 from public.get_available_slots(p_service_id,d::date))
  order by d limit 6
$$;
