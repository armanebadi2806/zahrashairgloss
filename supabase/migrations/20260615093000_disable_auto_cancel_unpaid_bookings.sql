create or replace function public.expire_pending_bookings()
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  -- Automatic cancellation of unpaid bookings is disabled.
  -- Bookings remain in the calendar until an admin changes them manually.
  return;
end $$;
