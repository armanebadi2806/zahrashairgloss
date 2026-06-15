grant select, update on public.bookings to authenticated;

drop policy if exists bookings_admin_read on public.bookings;
create policy bookings_admin_read
on public.bookings
for select
to authenticated
using (public.is_admin());

drop policy if exists bookings_admin_update on public.bookings;
create policy bookings_admin_update
on public.bookings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.get_bookable_dates(p_service_id text)
returns table(date text)
language plpgsql
volatile
security definer
set search_path=public
as $$
begin
  perform public.expire_pending_bookings();
  return query
    select d::text
    from generate_series(current_date,current_date+interval '90 days',interval '1 day') g(d)
    where exists(select 1 from public.get_available_slots(p_service_id,d::date))
    order by d
    limit 12;
end $$;

create or replace function public.admin_mark_booking_paid(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare booking record;
begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  select id, first_name, last_name into booking
  from public.bookings
  where id=p_id and status='confirmed' and payment_status='pending';
  if booking is null then raise exception 'Die Anzahlung konnte nicht bestätigt werden.'; end if;
  update public.bookings
  set payment_status='paid',
      confirmation_status='confirmed',
      confirmed_at=now()
  where id=p_id and status='confirmed' and payment_status='pending';
  insert into public.notifications(booking_id,title,message)
  values(p_id,'Anzahlung bestätigt',booking.first_name||' '||booking.last_name||' wurde als bezahlt markiert.');
end $$;

grant execute on function public.admin_mark_booking_paid(uuid) to authenticated;
