create or replace function public.admin_create_booking(
  p_service_id text,p_date date,p_time text,p_first_name text,p_last_name text,p_email text,p_phone text,p_note text
) returns uuid language plpgsql security definer set search_path=public
as $$
declare c record; h public.holds; b public.bookings;
begin
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

grant execute on function public.admin_create_booking(text,date,text,text,text,text,text,text),public.admin_move_booking(uuid,date,text) to authenticated;
