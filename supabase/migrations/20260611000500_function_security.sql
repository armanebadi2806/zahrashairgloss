revoke execute on function public.slot_candidates(text,date) from public,anon,authenticated;
revoke execute on function public.is_admin() from public,anon;
revoke execute on function public.admin_calendar(date,date) from public,anon;
revoke execute on function public.admin_blocks(date,date) from public,anon;
revoke execute on function public.admin_notifications() from public,anon;
revoke execute on function public.admin_mark_notifications_read() from public,anon;
revoke execute on function public.admin_create_block(date,text) from public,anon;
revoke execute on function public.admin_delete_block(bigint) from public,anon;
revoke execute on function public.admin_cancel_booking(uuid) from public,anon;
revoke execute on function public.admin_create_booking(text,date,text,text,text,text,text,text) from public,anon;
revoke execute on function public.admin_move_booking(uuid,date,text) from public,anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_calendar(date,date),public.admin_blocks(date,date),public.admin_notifications(),public.admin_mark_notifications_read(),public.admin_create_block(date,text),public.admin_delete_block(bigint),public.admin_cancel_booking(uuid),public.admin_create_booking(text,date,text,text,text,text,text,text),public.admin_move_booking(uuid,date,text) to authenticated;
