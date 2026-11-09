-- Recording AI usage is the server's job alone. Before, any signed-in person could call
-- reserve_ai_usage themselves with caps and costs of their choosing, writing usage rows in
-- their own name. Now only the server (the service role) can, and it says whose usage it is.

drop function public.reserve_ai_usage(uuid, text, numeric, numeric, integer, numeric);
drop function public.settle_ai_usage(uuid, uuid, text, integer, integer, numeric);

create function public.reserve_ai_usage(
  p_user_id uuid,
  p_note_id uuid,
  p_model text,
  p_estimate_usd numeric,
  p_monthly_cap_usd numeric,
  p_hourly_limit integer,
  p_global_cap_usd numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  new_id uuid;
  new_token uuid := gen_random_uuid();
begin
  -- The person has to belong to the workspace the note is in.
  if p_user_id is null or not exists (
    select 1
    from public.meeting_notes n
    join public.workspace_members m on m.workspace_id = n.workspace_id
    where n.id = p_note_id and m.user_id = p_user_id
  ) then
    raise exception 'note not found' using errcode = '42501';
  end if;
  if p_model is null or char_length(p_model) > 100 or p_estimate_usd is null or p_estimate_usd < 0 or p_estimate_usd > 10
    or p_monthly_cap_usd is null or p_hourly_limit is null then
    raise exception 'bad usage values' using errcode = '22023';
  end if;

  -- One reservation at a time per person, so the counts below can't go stale.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_user_id::text));

  if (select count(*) from public.ai_usage where user_id = p_user_id and created_at > now() - interval '1 hour') >= p_hourly_limit then
    raise exception 'ai_hourly_limit' using errcode = 'P0001';
  end if;
  if (select coalesce(sum(cost_usd), 0) from public.ai_usage where user_id = p_user_id and created_at >= month_start) >= p_monthly_cap_usd then
    raise exception 'ai_monthly_cap' using errcode = 'P0001';
  end if;
  if p_global_cap_usd is not null then
    perform pg_advisory_xact_lock(hashtext('ai_usage:all'));
    if (select coalesce(sum(cost_usd), 0) from public.ai_usage where created_at >= month_start) >= p_global_cap_usd then
      raise exception 'ai_global_cap' using errcode = 'P0001';
    end if;
  end if;

  insert into public.ai_usage (user_id, note_id, model, cost_usd, settle_token)
    values (p_user_id, p_note_id, p_model, p_estimate_usd, new_token)
    returning id into new_id;
  return jsonb_build_object('id', new_id, 'token', new_token);
end;
$$;

create function public.settle_ai_usage(
  p_user_id uuid,
  p_usage_id uuid,
  p_token uuid,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_model is null or char_length(p_model) > 100 or p_input_tokens < 0 or p_output_tokens < 0 or p_cost_usd < 0 then
    raise exception 'bad usage values' using errcode = '22023';
  end if;
  update public.ai_usage
    set model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens, cost_usd = p_cost_usd, settle_token = null
    where id = p_usage_id and user_id = p_user_id and settle_token is not null and settle_token = p_token;
  if not found then
    raise exception 'usage not open' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function
  public.reserve_ai_usage(uuid, uuid, text, numeric, numeric, integer, numeric),
  public.settle_ai_usage(uuid, uuid, uuid, text, integer, integer, numeric)
from public, anon, authenticated;
grant execute on function
  public.reserve_ai_usage(uuid, uuid, text, numeric, numeric, integer, numeric),
  public.settle_ai_usage(uuid, uuid, uuid, text, integer, integer, numeric)
to service_role;
