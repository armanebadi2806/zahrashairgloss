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
    begin
      perform public.send_resend_email(
        booking.email,
        'Dein Termin wurde storniert',
        booking.first_name || ' ' || booking.last_name || ', dein Termin fuer ' || booking.service_name ||
        ' am ' || to_char(timezone('Europe/Berlin', booking.starts_at), 'DD.MM.YYYY HH24:MI') ||
        ' Uhr wurde storniert.'
      );
    exception
      when others then
        insert into public.notifications(booking_id, title, message, appointment_starts_at, service_name)
        values (
          p_id,
          'Storno-Mail fehlgeschlagen',
          'Der Termin wurde storniert, aber die Kundenmail konnte nicht gesendet werden: ' || coalesce(sqlerrm, 'Unbekannter Fehler'),
          booking.starts_at,
          booking.service_name
        );
    end;
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
      'Warteliste beachten',
      v_waitlist_count::text || ' Wartelisten-Eintraege passen zum frei gewordenen Termin von ' ||
      booking.first_name || ' ' || booking.last_name || '.',
      booking.starts_at,
      booking.service_name
    );
  end if;
end
$$;
