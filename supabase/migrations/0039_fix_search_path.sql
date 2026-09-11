do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_updated_at', 'extend_token_on_status_change', 'enforce_status_transition')
  loop
    execute format('alter function %s set search_path = public', r.fn);
  end loop;
end $$;