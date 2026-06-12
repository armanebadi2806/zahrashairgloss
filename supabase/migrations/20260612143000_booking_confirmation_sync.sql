alter table public.bookings
  add column if not exists confirmation_status text not null default 'awaiting_payment',
  add column if not exists confirmed_at timestamptz,
  add column if not exists reminder_queued_at timestamptz,
  add column if not exists reminder_channel text not null default 'email';

drop policy if exists bookings_admin_update on public.bookings;
create policy bookings_admin_update
on public.bookings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.confirm_booking(
  p_hold_id uuid,p_first_name text,p_last_name text,p_email text,p_phone text,p_note text,p_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare h public.holds; b public.bookings;
begin
  perform public.expire_pending_bookings();
  if trim(coalesce(p_first_name,''))='' or trim(coalesce(p_last_name,''))='' or trim(coalesce(p_email,''))='' or trim(coalesce(p_phone,''))='' then
    raise exception 'Bitte alle Kontaktdaten vollständig ausfüllen.';
  end if;
  select * into h from public.holds where id=p_hold_id for update;
  if h is null or h.status<>'active' or h.expires_at<=now() then raise exception 'Die Reservierungszeit ist abgelaufen.'; end if;
  if exists(select 1 from public.bookings x where x.status='confirmed' and x.starts_at<h.ends_at and x.ends_at>h.starts_at) then raise exception 'Dieser Termin ist nicht mehr verfügbar.'; end if;
  insert into public.bookings(hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,deposit_cents,payment_status,confirmation_status,terms_version,terms_accepted_at)
  values(h.id,h.service_id,h.starts_at,h.ends_at,trim(p_first_name),trim(p_last_name),lower(trim(p_email)),trim(p_phone),nullif(trim(coalesce(p_note,'')),''),3000,'pending','awaiting_payment',p_terms_version,now()) returning * into b;
  update public.holds set status='converted' where id=h.id;
  insert into public.notifications(booking_id,title,message) values(b.id,'Neue Online-Buchung',b.first_name||' '||b.last_name||' hat einen Termin gebucht. Anzahlung noch offen.');
  return jsonb_build_object('id',b.id,'startsAt',b.starts_at,'depositCents',b.deposit_cents,'paymentStatus',b.payment_status,'confirmationStatus',b.confirmation_status);
end $$;

create or replace function public.admin_calendar(p_from date,p_to date)
returns table(id uuid,service_id text,service_name text,service_short text,duration integer,starts_at timestamptz,ends_at timestamptz,first_name text,last_name text,email text,phone text,note text,payment_status text,confirmation_status text,confirmed_at timestamptz,reminder_queued_at timestamptz,reminder_channel text,deposit_cents integer)
language plpgsql
security definer
set search_path=public
as $$ begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  return query
    select b.id,b.service_id,s.name,s.short_name,s.duration_minutes,b.starts_at,b.ends_at,b.first_name,b.last_name,b.email,b.phone,b.note,b.payment_status,b.confirmation_status,b.confirmed_at,b.reminder_queued_at,b.reminder_channel,b.deposit_cents
    from public.bookings b
    join public.services s on s.id=b.service_id
    where b.status='confirmed'
      and b.starts_at<((p_to+1)::timestamp at time zone 'Europe/Berlin')
      and b.ends_at>(p_from::timestamp at time zone 'Europe/Berlin')
    order by b.starts_at;
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

grant execute on function public.admin_calendar(date,date) to authenticated;
grant execute on function public.admin_mark_booking_paid(uuid) to authenticated;
