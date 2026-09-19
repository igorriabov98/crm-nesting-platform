ALTER TABLE public.user_auth_sync ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz;
CREATE FUNCTION public.crm_claim_auth_sync(p_token uuid,p_user_id uuid DEFAULT NULL) RETURNS SETOF public.user_auth_sync
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
  UPDATE public.user_auth_sync q SET lease_token=p_token,lease_until=now()+interval '2 minutes',attempts=attempts+1
  WHERE q.user_id IN (SELECT r.user_id FROM public.user_auth_sync r WHERE (p_user_id IS NULL OR r.user_id=p_user_id)
    AND (r.synced_at IS NULL OR r.synced_at<now()-interval '10 minutes')
    AND (r.lease_until IS NULL OR r.lease_until<now()) ORDER BY r.requested_at LIMIT 25 FOR UPDATE SKIP LOCKED)
  RETURNING q.*;
$function$;
CREATE FUNCTION public.crm_finish_auth_sync(p_user_id uuid,p_token uuid,p_generation uuid,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  UPDATE public.user_auth_sync SET synced_at=CASE WHEN generation=p_generation AND p_error IS NULL THEN now() ELSE NULL END,
    last_error=p_error,lease_token=NULL,lease_until=NULL WHERE user_id=p_user_id AND lease_token=p_token;
  IF NOT FOUND THEN
    -- A late response from an expired lease may have changed Auth after a newer worker.
    UPDATE public.user_auth_sync SET synced_at=NULL WHERE user_id=p_user_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_claim_auth_sync(uuid,uuid),public.crm_finish_auth_sync(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_auth_sync(uuid,uuid),public.crm_finish_auth_sync(uuid,uuid,uuid,text) TO service_role;
