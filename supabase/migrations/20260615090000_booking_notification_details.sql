alter table public.notifications
  add column if not exists appointment_starts_at timestamptz,
  add column if not exists service_name text;

create or replace function public.fill_booking_notification_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_id is not null then
    select b.starts_at, s.name
      into new.appointment_starts_at, new.service_name
    from public.bookings b
    join public.services s on s.id = b.service_id
    where b.id = new.booking_id;
  end if;
  return new;
end
$$;

drop trigger if exists fill_booking_notification_details on public.notifications;
create trigger fill_booking_notification_details
before insert on public.notifications
for each row execute function public.fill_booking_notification_details();

update public.notifications n
set appointment_starts_at = b.starts_at,
    service_name = s.name
from public.bookings b
join public.services s on s.id = b.service_id
where n.booking_id = b.id
  and (n.appointment_starts_at is null or n.service_name is null);
