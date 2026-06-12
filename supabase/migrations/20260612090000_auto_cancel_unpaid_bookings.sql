create or replace function public.expire_pending_bookings()
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  with expired as (
    update public.bookings
    set status='cancelled'
    where status='confirmed'
      and payment_status='pending'
      and created_at < now() - interval '2 hours'
    returning id, first_name, last_name
  )
  insert into public.notifications(booking_id,title,message)
  select id,'Termin automatisch storniert',first_name||' '||last_name||' hat innerhalb von 2 Stunden keine Anzahlung gesendet.'
  from expired;
end $$;

create or replace function public.get_available_slots(p_service_id text,p_date date)
returns table(slot_time text)
language plpgsql stable security definer set search_path=public
as $$
begin
  perform public.expire_pending_bookings();
  return query
    select c.time_label from public.slot_candidates(p_service_id,p_date)c
    where c.starts_at>now()
      and not exists(select 1 from public.bookings b where b.status='confirmed' and b.starts_at<c.ends_at and b.ends_at>c.starts_at)
      and not exists(select 1 from public.holds h where h.status='active' and h.expires_at>now() and h.starts_at<c.ends_at and h.ends_at>c.starts_at)
      and not exists(select 1 from public.blocked_periods x where x.starts_at<c.ends_at and x.ends_at>c.starts_at)
    order by c.starts_at;
end $$;

create or replace function public.get_bookable_dates(p_service_id text)
returns table(date text)
language plpgsql stable security definer set search_path=public
as $$
begin
  perform public.expire_pending_bookings();
  return query
    select d::text from generate_series(current_date,current_date+interval '90 days',interval '1 day')g(d)
    where exists(select 1 from public.get_available_slots(p_service_id,d::date))
    order by d limit 6;
end $$;

create or replace function public.confirm_booking(p_hold_id uuid,p_first_name text,p_last_name text,p_email text,p_phone text,p_note text,p_terms_version text)
returns jsonb language plpgsql security definer set search_path=public
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
  insert into public.bookings(hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,deposit_cents,payment_status,terms_version,terms_accepted_at)
  values(h.id,h.service_id,h.starts_at,h.ends_at,trim(p_first_name),trim(p_last_name),lower(trim(p_email)),trim(p_phone),nullif(trim(coalesce(p_note,'')),''),3000,'pending',p_terms_version,now()) returning * into b;
  update public.holds set status='converted' where id=h.id;
  insert into public.notifications(booking_id,title,message) values(b.id,'Neue Online-Buchung',b.first_name||' '||b.last_name||' hat einen Termin gebucht. Anzahlung noch offen.');
  return jsonb_build_object('id',b.id,'startsAt',b.starts_at,'depositCents',b.deposit_cents,'paymentStatus',b.payment_status);
end $$;

create or replace function public.admin_calendar(p_from date,p_to date)
returns table(id uuid,service_id text,service_name text,service_short text,duration integer,starts_at timestamptz,ends_at timestamptz,first_name text,last_name text,email text,phone text,note text,payment_status text,deposit_cents integer)
language plpgsql security definer set search_path=public
as $$ begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  return query select b.id,b.service_id,s.name,s.short_name,s.duration_minutes,b.starts_at,b.ends_at,b.first_name,b.last_name,b.email,b.phone,b.note,b.payment_status,b.deposit_cents
  from public.bookings b join public.services s on s.id=b.service_id where b.status='confirmed' and b.starts_at<((p_to+1)::timestamp at time zone 'Europe/Berlin') and b.ends_at>(p_from::timestamp at time zone 'Europe/Berlin') order by b.starts_at;
end $$;

create or replace function public.admin_notifications()
returns setof public.notifications language plpgsql security definer set search_path=public
as $$ begin perform public.expire_pending_bookings(); if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if; return query select * from public.notifications order by created_at desc limit 30; end $$;

create or replace function public.admin_create_booking(
  p_service_id text,p_date date,p_time text,p_first_name text,p_last_name text,p_email text,p_phone text,p_note text
) returns uuid language plpgsql security definer set search_path=public
as $$
declare c record; h public.holds; b public.bookings;
begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_service_id||p_date::text||p_time));
  select * into c from public.slot_candidates(p_service_id,p_date) where time_label=p_time;
  if c is null or not exists(select 1 from public.get_available_slots(p_service_id,p_date) where slot_time=p_time) then raise exception 'Dieser Termin ist nicht mehr verfügbar.'; end if;
  insert into public.holds(service_id,starts_at,ends_at,expires_at,status) values(p_service_id,c.starts_at,c.ends_at,now(),'converted') returning * into h;
  insert into public.bookings(hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,deposit_cents,payment_status,terms_version,terms_accepted_at)
  values(h.id,p_service_id,c.starts_at,c.ends_at,trim(p_first_name),trim(p_last_name),lower(trim(coalesce(p_email,''))),trim(coalesce(p_phone,'')),nullif(trim(coalesce(p_note,'')),''),0,'manual','manual',now()) returning * into b;
  return b.id;
end $$;

create or replace function public.admin_move_booking(p_id uuid,p_date date,p_time text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare b public.bookings;c record;
begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  select * into b from public.bookings where id=p_id and status='confirmed' for update;
  if b is null then raise exception 'Termin wurde nicht gefunden.'; end if;
  perform pg_advisory_xact_lock(hashtext(b.service_id||p_date::text||p_time));
  update public.bookings set status='cancelled' where id=p_id;
  select * into c from public.slot_candidates(b.service_id,p_date) where time_label=p_time;
  if c is null or not exists(select 1 from public.get_available_slots(b.service_id,p_date) where slot_time=p_time) then raise exception 'Der neue Termin ist nicht mehr verfügbar.'; end if;
  update public.bookings set starts_at=c.starts_at,ends_at=c.ends_at,status='confirmed' where id=p_id;
  return p_id;
end $$;
