create or replace function public.admin_create_blocks(
  p_from_date date,
  p_to_date date,
  p_reason text default 'Frei'
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_reason text := coalesce(nullif(trim(p_reason),''),'Frei');
  v_inserted integer := 0;
begin
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  if p_from_date is null or p_to_date is null then raise exception 'Bitte einen gültigen Zeitraum wählen.'; end if;
  if p_from_date > p_to_date then raise exception 'Das Enddatum muss am selben Tag oder nach dem Startdatum liegen.'; end if;
  if exists(
    select 1
    from public.bookings b
    where b.status='confirmed'
      and b.starts_at<((p_to_date + 1)::timestamp at time zone 'Europe/Berlin')
      and b.ends_at>(p_from_date::timestamp at time zone 'Europe/Berlin')
  ) then
    raise exception 'In diesem Zeitraum bestehen bereits Termine. Bitte diese zuerst verschieben oder stornieren.';
  end if;
  insert into public.blocked_periods(starts_at,ends_at,reason)
  select
    day::timestamp at time zone 'Europe/Berlin',
    (day + interval '1 day')::timestamp at time zone 'Europe/Berlin',
    v_reason
  from generate_series(p_from_date,p_to_date,interval '1 day') as day
  where not exists(
    select 1
    from public.blocked_periods x
    where x.starts_at<((day + interval '1 day')::timestamp at time zone 'Europe/Berlin')
      and x.ends_at>(day::timestamp at time zone 'Europe/Berlin')
  );
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

grant execute on function public.admin_create_blocks(date,date,text) to authenticated;
