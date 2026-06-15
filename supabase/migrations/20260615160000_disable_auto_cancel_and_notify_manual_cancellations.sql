create or replace function public.expire_pending_bookings()
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  -- Automatic cancellation of unpaid bookings is disabled.
  -- Pending bookings stay visible until an admin changes them manually.
  return;
end $$;

create or replace function public.admin_cancel_booking(p_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  booking record;
begin
  if not public.is_admin() then
    raise exception 'Nicht autorisiert.';
  end if;

  select b.id, b.first_name, b.last_name, b.email, b.starts_at, s.name as service_name
    into booking
  from public.bookings b
  join public.services s on s.id=b.service_id
  where b.id=p_id and b.status='confirmed';

  if booking is null then
    raise exception 'Termin wurde nicht gefunden.';
  end if;

  update public.bookings
  set status='cancelled'
  where id=p_id and status='confirmed';

  insert into public.notifications(booking_id,title,message,appointment_starts_at,service_name)
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
end $$;
