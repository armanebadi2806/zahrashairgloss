insert into public.services(id,name,short_name,duration_minutes,active)
values ('consultation','Probe/Beratung','Probe/Beratung',30,true)
on conflict (id) do update
set name=excluded.name,
    short_name=excluded.short_name,
    duration_minutes=excluded.duration_minutes,
    active=true;
