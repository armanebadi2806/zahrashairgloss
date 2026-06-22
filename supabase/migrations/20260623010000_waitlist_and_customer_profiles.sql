create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  admin_note text not null default '',
  preferences text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_profiles_email_uidx
  on public.customer_profiles (lower(email))
  where email is not null and btrim(email) <> '';

create unique index if not exists customer_profiles_phone_uidx
  on public.customer_profiles (phone)
  where phone is not null and btrim(phone) <> '';

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references public.services(id),
  preferred_date date,
  time_window text not null default 'egal'
    check (time_window in ('egal', 'vormittag', 'nachmittag')),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  note text,
  status text not null default 'active'
    check (status in ('active', 'notified', 'booked', 'archived')),
  notified_at timestamptz,
  matched_booking_id uuid references public.bookings(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_entries_status_idx
  on public.waitlist_entries(status, service_id, preferred_date, created_at desc);

alter table public.customer_profiles enable row level security;
alter table public.waitlist_entries enable row level security;

revoke all on public.customer_profiles from anon, authenticated;
revoke all on public.waitlist_entries from anon, authenticated;

create or replace function public.upsert_customer_profile(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_first_name text := trim(coalesce(p_first_name, ''));
  v_last_name text := trim(coalesce(p_last_name, ''));
  v_profile_id uuid;
begin
  if v_first_name = '' or v_last_name = '' then
    return null;
  end if;

  select id
    into v_profile_id
  from public.customer_profiles
  where (v_email is not null and lower(email) = v_email)
     or (v_phone is not null and phone = v_phone)
  order by updated_at desc
  limit 1;

  if v_profile_id is null then
    insert into public.customer_profiles(first_name, last_name, email, phone)
    values (v_first_name, v_last_name, v_email, v_phone)
    returning id into v_profile_id;
  else
    update public.customer_profiles
    set first_name = v_first_name,
        last_name = v_last_name,
        email = coalesce(v_email, email),
        phone = coalesce(v_phone, phone),
        updated_at = now()
    where id = v_profile_id;
  end if;

  return v_profile_id;
end
$$;

create or replace function public.create_waitlist_entry(
  p_service_id text,
  p_preferred_date date,
  p_time_window text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_service record;
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_first_name text := trim(coalesce(p_first_name, ''));
  v_last_name text := trim(coalesce(p_last_name, ''));
  v_time_window text := case
    when p_time_window in ('egal', 'vormittag', 'nachmittag') then p_time_window
    else 'egal'
  end;
  v_id uuid;
begin
  if v_first_name = '' or v_last_name = '' or v_email is null or v_phone is null then
    raise exception 'Bitte Vorname, Nachname, E-Mail und Telefonnummer ausfüllen.';
  end if;

  select id, name
    into v_service
  from public.services
  where id = p_service_id and active = true;

  if v_service is null then
    raise exception 'Unbekannter Service.';
  end if;

  if exists (
    select 1
    from public.waitlist_entries
    where status = 'active'
      and service_id = p_service_id
      and lower(email) = v_email
      and phone = v_phone
      and coalesce(preferred_date::text, '') = coalesce(p_preferred_date::text, '')
      and time_window = v_time_window
  ) then
    raise exception 'Du stehst fuer diesen Wunsch bereits auf der Warteliste.';
  end if;

  insert into public.waitlist_entries(
    service_id, preferred_date, time_window, first_name, last_name, email, phone, note
  )
  values (
    p_service_id,
    p_preferred_date,
    v_time_window,
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  perform public.upsert_customer_profile(v_first_name, v_last_name, v_email, v_phone);

  insert into public.notifications(booking_id, title, message, service_name)
  values (
    null,
    'Neue Warteliste',
    v_first_name || ' ' || v_last_name || ' moechte fuer ' || v_service.name || ' informiert werden.',
    v_service.name
  );

  return v_id;
end
$$;

create or replace function public.admin_waitlist_entries()
returns table(
  id uuid,
  service_id text,
  service_name text,
  service_short text,
  preferred_date date,
  time_window text,
  first_name text,
  last_name text,
  email text,
  phone text,
  note text,
  status text,
  notified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  return query
  select
    w.id,
    w.service_id,
    s.name,
    s.short_name,
    w.preferred_date,
    w.time_window,
    w.first_name,
    w.last_name,
    w.email,
    w.phone,
    w.note,
    w.status,
    w.notified_at,
    w.created_at,
    w.updated_at
  from public.waitlist_entries w
  join public.services s on s.id = w.service_id
  order by
    case w.status
      when 'active' then 0
      when 'notified' then 1
      when 'booked' then 2
      else 3
    end,
    w.created_at desc;
end
$$;

create or replace function public.admin_update_waitlist_status(
  p_id uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status text := case
    when p_status in ('active', 'notified', 'booked', 'archived') then p_status
    else null
  end;
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  if v_status is null then
    raise exception 'Ungueltiger Wartelisten-Status.';
  end if;

  update public.waitlist_entries
  set status = v_status,
      notified_at = case when v_status = 'notified' then now() else null end,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Wartelisten-Eintrag wurde nicht gefunden.';
  end if;

  return p_id;
end
$$;

create or replace function public.admin_customer_profile_context(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_booking record;
  v_profile_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  select b.id, b.first_name, b.last_name, b.email, b.phone
    into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking is null then
    raise exception 'Termin wurde nicht gefunden.';
  end if;

  v_profile_id := public.upsert_customer_profile(
    v_booking.first_name,
    v_booking.last_name,
    v_booking.email,
    v_booking.phone
  );

  return jsonb_build_object(
    'profile',
    (
      select to_jsonb(p)
      from (
        select
          cp.id,
          cp.first_name as "firstName",
          cp.last_name as "lastName",
          cp.email,
          cp.phone,
          cp.admin_note as "adminNote",
          cp.preferences,
          cp.created_at as "createdAt",
          cp.updated_at as "updatedAt"
        from public.customer_profiles cp
        where cp.id = v_profile_id
      ) p
    ),
    'history',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'startsAt', b.starts_at,
          'status', b.status,
          'paymentStatus', b.payment_status,
          'serviceName', s.name,
          'serviceShort', s.short_name
        )
        order by b.starts_at desc
      )
      from public.bookings b
      join public.services s on s.id = b.service_id
      where (
        coalesce(trim(v_booking.email), '') <> '' and lower(b.email) = lower(v_booking.email)
      ) or (
        coalesce(trim(v_booking.phone), '') <> '' and b.phone = v_booking.phone
      )
    ), '[]'::jsonb),
    'waitlistEntries',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', w.id,
          'serviceId', w.service_id,
          'preferredDate', w.preferred_date,
          'timeWindow', w.time_window,
          'status', w.status,
          'createdAt', w.created_at
        )
        order by w.created_at desc
      )
      from public.waitlist_entries w
      where (
        coalesce(trim(v_booking.email), '') <> '' and lower(w.email) = lower(v_booking.email)
      ) or (
        coalesce(trim(v_booking.phone), '') <> '' and w.phone = v_booking.phone
      )
    ), '[]'::jsonb),
    'stats',
    jsonb_build_object(
      'totalBookings',
      (
        select count(*)
        from public.bookings b
        where b.status = 'confirmed'
          and (
            (coalesce(trim(v_booking.email), '') <> '' and lower(b.email) = lower(v_booking.email))
            or (coalesce(trim(v_booking.phone), '') <> '' and b.phone = v_booking.phone)
          )
      ),
      'cancellations',
      (
        select count(*)
        from public.bookings b
        where b.status = 'cancelled'
          and (
            (coalesce(trim(v_booking.email), '') <> '' and lower(b.email) = lower(v_booking.email))
            or (coalesce(trim(v_booking.phone), '') <> '' and b.phone = v_booking.phone)
          )
      )
    )
  );
end
$$;

create or replace function public.admin_save_customer_profile(
  p_booking_id uuid,
  p_admin_note text,
  p_preferences text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_booking record;
  v_profile_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  select b.first_name, b.last_name, b.email, b.phone
    into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  if v_booking is null then
    raise exception 'Termin wurde nicht gefunden.';
  end if;

  v_profile_id := public.upsert_customer_profile(
    v_booking.first_name,
    v_booking.last_name,
    v_booking.email,
    v_booking.phone
  );

  update public.customer_profiles
  set admin_note = coalesce(p_admin_note, ''),
      preferences = coalesce(p_preferences, ''),
      updated_at = now()
  where id = v_profile_id;

  return v_profile_id;
end
$$;

create or replace function public.confirm_booking(
  p_hold_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  h public.holds;
  b public.bookings;
begin
  if trim(coalesce(p_first_name, '')) = ''
    or trim(coalesce(p_last_name, '')) = ''
    or trim(coalesce(p_email, '')) = ''
    or trim(coalesce(p_phone, '')) = '' then
    raise exception 'Bitte alle Kontaktdaten vollständig ausfüllen.';
  end if;

  select * into h
  from public.holds
  where id = p_hold_id
  for update;

  if h is null or h.status <> 'active' or h.expires_at <= now() then
    raise exception 'Die Reservierungszeit ist abgelaufen.';
  end if;

  if exists(
    select 1
    from public.bookings x
    join public.services s on s.id = x.service_id
    join public.services hold_service on hold_service.id = h.service_id
    where x.status = 'confirmed'
      and public.service_lane(s.id) = public.service_lane(hold_service.id)
      and x.starts_at < h.ends_at
      and x.ends_at > h.starts_at
  ) then
    raise exception 'Dieser Termin ist nicht mehr verfügbar.';
  end if;

  insert into public.bookings(
    hold_id, service_id, starts_at, ends_at, first_name, last_name, email, phone, note,
    deposit_cents, payment_status, confirmation_status, terms_version, terms_accepted_at
  )
  values(
    h.id,
    h.service_id,
    h.starts_at,
    h.ends_at,
    trim(p_first_name),
    trim(p_last_name),
    lower(trim(p_email)),
    trim(p_phone),
    nullif(trim(coalesce(p_note, '')), ''),
    3000,
    'pending',
    'awaiting_payment',
    p_terms_version,
    now()
  )
  returning * into b;

  update public.holds set status = 'converted' where id = h.id;

  perform public.upsert_customer_profile(
    b.first_name,
    b.last_name,
    b.email,
    b.phone
  );

  insert into public.notifications(booking_id, title, message)
  values (
    b.id,
    'Neue Online-Buchung',
    b.first_name || ' ' || b.last_name || ' hat einen Termin gebucht. Anzahlung noch offen.'
  );

  return jsonb_build_object(
    'id', b.id,
    'startsAt', b.starts_at,
    'depositCents', b.deposit_cents,
    'paymentStatus', b.payment_status
  );
end
$$;

create or replace function public.admin_create_booking(
  p_service_id text,
  p_date date,
  p_time text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text
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
    raise exception 'Bitte eine gueltige Uhrzeit im Format HH:MM waehlen.';
  end if;

  select duration_minutes, public.service_lane(id)
    into v_duration, v_lane
  from public.services
  where id = p_service_id and active = true;

  if v_duration is null then
    raise exception 'Unbekannter Service.';
  end if;

  v_start_local := p_date + p_time::time;
  v_end_local := v_start_local + make_interval(mins => v_duration);
  v_starts_at := v_start_local at time zone 'Europe/Berlin';
  v_ends_at := v_end_local at time zone 'Europe/Berlin';

  if exists(
    select 1
    from public.bookings b2
    join public.services s on s.id = b2.service_id
    where b2.status = 'confirmed'
      and public.service_lane(s.id) = v_lane
      and b2.starts_at < v_ends_at
      and b2.ends_at > v_starts_at
  ) then
    raise exception 'Zu dieser Uhrzeit besteht bereits ein anderer Termin.';
  end if;

  insert into public.holds(service_id, starts_at, ends_at, expires_at, status)
  values (p_service_id, v_starts_at, v_ends_at, now(), 'converted')
  returning * into h;

  insert into public.bookings(
    hold_id, service_id, starts_at, ends_at, first_name, last_name, email, phone, note,
    status, deposit_cents, payment_status, confirmation_status, terms_version, terms_accepted_at, confirmed_at
  )
  values(
    h.id,
    p_service_id,
    v_starts_at,
    v_ends_at,
    trim(p_first_name),
    trim(p_last_name),
    lower(trim(coalesce(p_email, ''))),
    trim(coalesce(p_phone, '')),
    nullif(trim(coalesce(p_note, '')), ''),
    'confirmed',
    0,
    'manual',
    'confirmed',
    'manual-admin',
    now(),
    now()
  )
  returning * into b;

  perform public.upsert_customer_profile(
    b.first_name,
    b.last_name,
    b.email,
    b.phone
  );

  return b.id;
end
$$;

create or replace function public.admin_cancel_booking(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  booking record;
  v_waitlist_count integer;
  v_time_window text;
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  select
    b.id,
    b.first_name,
    b.last_name,
    b.email,
    b.phone,
    b.starts_at,
    s.id as service_id,
    s.name as service_name
  into booking
  from public.bookings b
  join public.services s on s.id = b.service_id
  where b.id = p_id and b.status = 'confirmed';

  if booking is null then
    raise exception 'Termin wurde nicht gefunden.';
  end if;

  update public.bookings
  set status = 'cancelled'
  where id = p_id and status = 'confirmed';

  insert into public.notifications(booking_id, title, message, appointment_starts_at, service_name)
  values (
    p_id,
    'Termin storniert',
    booking.first_name || ' ' || booking.last_name || ' wurde manuell storniert.',
    booking.starts_at,
    booking.service_name
  );

  if coalesce(trim(booking.email), '') <> ''
    and to_regprocedure('public.send_resend_email(text,text,text)') is not null then
    perform public.send_resend_email(
      booking.email,
      'Dein Termin wurde storniert',
      booking.first_name || ' ' || booking.last_name || ', dein Termin fuer ' || booking.service_name ||
      ' am ' || to_char(timezone('Europe/Berlin', booking.starts_at), 'DD.MM.YYYY HH24:MI') ||
      ' Uhr wurde storniert.'
    );
  end if;

  v_time_window := case
    when extract(hour from timezone('Europe/Berlin', booking.starts_at)) < 13 then 'vormittag'
    else 'nachmittag'
  end;

  select count(*)
    into v_waitlist_count
  from public.waitlist_entries w
  where w.status = 'active'
    and w.service_id = booking.service_id
    and (w.preferred_date is null or w.preferred_date = timezone('Europe/Berlin', booking.starts_at)::date)
    and (w.time_window = 'egal' or w.time_window = v_time_window);

  if coalesce(v_waitlist_count, 0) > 0 then
    insert into public.notifications(booking_id, title, message, appointment_starts_at, service_name)
    values (
      null,
      'Warteliste passt',
      v_waitlist_count || ' Wartelisten-Eintraege passen zu ' || booking.service_name || ' am ' ||
        to_char(timezone('Europe/Berlin', booking.starts_at), 'DD.MM.YYYY') || '.',
      booking.starts_at,
      booking.service_name
    );
  end if;
end
$$;

grant execute on function public.create_waitlist_entry(text,date,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.admin_waitlist_entries() to authenticated;
grant execute on function public.admin_update_waitlist_status(uuid,text) to authenticated;
grant execute on function public.admin_customer_profile_context(uuid) to authenticated;
grant execute on function public.admin_save_customer_profile(uuid,text,text) to authenticated;
