create or replace function public.service_lane(p_service_id text)
returns text
language sql
immutable
set search_path=public
as $$
  select case when p_service_id='balayage' then 'balayage' else 'regular' end
$$;

create or replace function public.get_available_slots(p_service_id text,p_date date)
returns table(slot_time text)
language plpgsql
volatile
security definer
set search_path=public
as $$
begin
  perform public.expire_pending_bookings();
  return query
    select c.time_label
    from public.slot_candidates(p_service_id,p_date) c
    where c.starts_at>now()
      and not exists(
        select 1
        from public.bookings b
        join public.services s on s.id=b.service_id
        where b.status='confirmed'
          and public.service_lane(s.id)=public.service_lane(p_service_id)
          and b.starts_at<c.ends_at
          and b.ends_at>c.starts_at
      )
      and not exists(
        select 1
        from public.holds h
        join public.services s on s.id=h.service_id
        where h.status='active'
          and h.expires_at>now()
          and public.service_lane(s.id)=public.service_lane(p_service_id)
          and h.starts_at<c.ends_at
          and h.ends_at>c.starts_at
      )
      and not exists(
        select 1
        from public.blocked_periods x
        where x.starts_at<c.ends_at
          and x.ends_at>c.starts_at
      )
    order by c.starts_at;
end $$;

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
  if exists(
    select 1
    from public.bookings x
    join public.services s on s.id=x.service_id
    where x.status='confirmed'
      and public.service_lane(s.id)=public.service_lane(h.service_id)
      and x.starts_at<h.ends_at
      and x.ends_at>h.starts_at
  ) then
    raise exception 'Dieser Termin ist nicht mehr verfügbar.';
  end if;
  insert into public.bookings(hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,deposit_cents,payment_status,confirmation_status,terms_version,terms_accepted_at)
  values(h.id,h.service_id,h.starts_at,h.ends_at,trim(p_first_name),trim(p_last_name),lower(trim(p_email)),trim(p_phone),nullif(trim(coalesce(p_note,'')),''),3000,'pending','awaiting_payment',p_terms_version,now())
  returning * into b;
  update public.holds set status='converted' where id=h.id;
  insert into public.notifications(booking_id,title,message) values(b.id,'Neue Online-Buchung',b.first_name||' '||b.last_name||' hat einen Termin gebucht. Anzahlung noch offen.');
  return jsonb_build_object('id',b.id,'startsAt',b.starts_at,'depositCents',b.deposit_cents,'paymentStatus',b.payment_status,'confirmationStatus',b.confirmation_status);
end $$;

create or replace function public.admin_create_booking(
  p_service_id text,p_date date,p_time text,p_first_name text,p_last_name text,p_email text,p_phone text,p_note text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_duration integer;
  v_lane text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  h public.holds;
  b public.bookings;
begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  if extract(isodow from p_date) = 7 then
    raise exception 'Sonntags werden keine Termine angeboten.';
  end if;
  if p_date is null or coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Bitte eine gültige Uhrzeit im Format HH:MM wählen.';
  end if;
  select duration_minutes, public.service_lane(id) into v_duration, v_lane
  from public.services
  where id=p_service_id and active=true;
  if v_duration is null then raise exception 'Unbekannter Service.'; end if;
  v_start_local := p_date + p_time::time;
  v_end_local := v_start_local + make_interval(mins => v_duration);
  v_starts_at := v_start_local at time zone 'Europe/Berlin';
  v_ends_at := v_end_local at time zone 'Europe/Berlin';
  if exists(
    select 1
    from public.bookings b2
    join public.services s on s.id=b2.service_id
    where b2.status='confirmed'
      and public.service_lane(s.id)=v_lane
      and b2.starts_at<v_ends_at
      and b2.ends_at>v_starts_at
  ) then
    raise exception 'Zu dieser Uhrzeit besteht bereits ein anderer Termin.';
  end if;
  insert into public.holds(service_id,starts_at,ends_at,expires_at,status)
  values(p_service_id,v_starts_at,v_ends_at,now(),'converted')
  returning * into h;
  insert into public.bookings(hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,status,deposit_cents,payment_status,confirmation_status,terms_version,terms_accepted_at,confirmed_at)
  values(h.id,p_service_id,v_starts_at,v_ends_at,trim(p_first_name),trim(p_last_name),lower(trim(coalesce(p_email,''))),trim(coalesce(p_phone,'')),nullif(trim(coalesce(p_note,'')),''),'confirmed',0,'manual','confirmed','manual-admin',now(),now())
  returning * into b;
  return b.id;
end $$;

create or replace function public.admin_move_booking(p_id uuid,p_date date,p_time text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  b public.bookings;
  v_duration integer;
  v_lane text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  perform public.expire_pending_bookings();
  if not public.is_admin() then raise exception 'Nicht autorisiert.'; end if;
  if extract(isodow from p_date) = 7 then
    raise exception 'Sonntags werden keine Termine angeboten.';
  end if;
  if p_date is null or coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Bitte eine gültige Uhrzeit im Format HH:MM wählen.';
  end if;
  select * into b from public.bookings where id=p_id and status='confirmed' for update;
  if b is null then raise exception 'Termin wurde nicht gefunden.'; end if;
  select duration_minutes, public.service_lane(id) into v_duration, v_lane
  from public.services
  where id=b.service_id and active=true;
  v_start_local := p_date + p_time::time;
  v_end_local := v_start_local + make_interval(mins => v_duration);
  v_starts_at := v_start_local at time zone 'Europe/Berlin';
  v_ends_at := v_end_local at time zone 'Europe/Berlin';
  if exists(
    select 1
    from public.bookings b2
    join public.services s on s.id=b2.service_id
    where b2.status='confirmed'
      and b2.id<>p_id
      and public.service_lane(s.id)=v_lane
      and b2.starts_at<v_ends_at
      and b2.ends_at>v_starts_at
  ) then
    raise exception 'Zu dieser Uhrzeit besteht bereits ein anderer Termin.';
  end if;
  update public.bookings
  set starts_at=v_starts_at,
      ends_at=v_ends_at,
      status='confirmed'
  where id=p_id;
  return p_id;
end $$;

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

grant execute on function public.admin_create_booking(text,date,text,text,text,text,text,text) to authenticated;
grant execute on function public.admin_move_booking(uuid,date,text) to authenticated;
grant execute on function public.admin_create_blocks(date,date,text) to authenticated;
