begin;

-- The deployed guard previously accepted only Supabase Auth (`current_user =
-- 'authenticated'` and `auth.uid()`).  Tender Automation intentionally uses
-- agenttender_users + agenttender_user_sessions instead.  Validate the opaque
-- HTTP-only session token supplied by the already-authorized server action;
-- never trust client-provided actor or user-id headers.
create or replace function public.agenttender_guard_go_terminal_transition()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_workspace uuid;
  v_status text;
  v_total integer;
  v_incomplete integer;
  v_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
  v_session_token text := v_headers ->> 'x-agenttender-session-token';
  v_actor_user_id uuid;
begin
  if tg_op = 'UPDATE'
    and old.qualification_status = 'GO'
    and new.qualification_status is distinct from old.qualification_status
    and new.qualification_status in ('NO_GO', 'FINISHED') then
    if v_session_token is not null and v_session_token <> '' then
      select s.user_id
        into v_actor_user_id
      from public.agenttender_user_sessions s
      join public.agenttender_users u on u.id = s.user_id
      where s.token_hash = encode(extensions.digest(v_session_token, 'sha256'), 'hex')
        and s.revoked_at is null
        and s.expires_at > now()
        and u.is_active = true
      limit 1;
    end if;

    if v_actor_user_id is null then
      raise exception 'GO_TERMINAL_MANUAL_ONLY: authenticated user action required';
    end if;

    select w.id, w.checklist_preparation_status
      into v_workspace, v_status
    from public.agenttender_bid_workspaces w
    where w.tender_id = new.id
    order by w.created_at desc
    limit 1;
    if v_workspace is null or v_status <> 'READY' then
      raise exception 'GO_TERMINAL_CHECKLIST_NOT_READY';
    end if;

    select count(*), count(*) filter (
      where completion_status not in (
        'COMPLETED_TENDER_DOCUMENT',
        'COMPLETED_COMPANY_DOCUMENT'
      )
    )
      into v_total, v_incomplete
    from public.agenttender_bid_checklist_items
    where workspace_id = v_workspace
      and is_archived = false;
    if v_total = 0 or v_incomplete > 0 then
      raise exception 'GO_TERMINAL_CHECKLIST_INCOMPLETE: % of % incomplete',
        v_incomplete, v_total;
    end if;
  end if;
  return new;
end;
$$;

commit;
