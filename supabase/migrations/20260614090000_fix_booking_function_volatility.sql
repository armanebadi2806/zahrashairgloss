-- These functions perform expiry cleanup before returning availability.
-- They must be VOLATILE because that cleanup updates bookings and notifications.
alter function public.get_available_slots(text, date) volatile;
alter function public.get_bookable_dates(text) volatile;

-- Keep production databases that missed the confirmation migration compatible
-- with the current admin and notification functions.
alter table public.bookings
  add column if not exists confirmation_status text not null default 'awaiting_payment',
  add column if not exists confirmed_at timestamptz,
  add column if not exists reminder_queued_at timestamptz,
  add column if not exists reminder_channel text not null default 'email';

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
  if p_date is null or coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Bitte eine gueltige Uhrzeit im Format HH:MM waehlen.';
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

grant execute on function public.admin_create_booking(text,date,text,text,text,text,text,text) to authenticated;
