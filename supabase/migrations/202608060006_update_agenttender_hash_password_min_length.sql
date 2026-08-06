begin;

-- Minimum length 8 for user passwords (uppercase, lowercase, number, special validated in app).
create or replace function public.agenttender_hash_password(plain_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if plain_password is null or length(plain_password) < 8 then
    raise exception 'Password does not meet minimum length requirements';
  end if;
  return crypt(plain_password, gen_salt('bf', 12));
end;
$$;

revoke all on function public.agenttender_hash_password(text) from public;
grant execute on function public.agenttender_hash_password(text) to service_role;

commit;
