-- Alerts on the phone (2026-11-22, the owner's wish, part 3 of the Group Circle alerts plan): the same alerts as on the
-- computer can arrive on a student's phone, even with Sovran Go closed. Run after group-feed.sql, tell-daniel.sql and
-- group-alerts.sql. Safe to run again.
--
-- How it goes:
--   1. Sovran Go asks the phone "Allow alerts?". On a yes the phone's browser gives an address to wake it (a push
--      endpoint at Apple, Google or Mozilla), and Sovran Go keeps it here with the phone's own Group Circle key and the
--      student's switches (push_sub). A phone key switched off, or replaced, takes its subscription with it.
--   2. The web function group-feed calls push_run() after anything is written, and now and then otherwise. For each
--      phone it asks group_feed.alerts what is new since it last looked, keeps what the student's switches allow in
--      `waiting`, and returns the addresses to wake.
--   3. The function wakes each phone with an empty message: no words ever go through Apple's or Google's servers.
--      The phone then fetches what waits for it (push_take, with its own key) and shows it.
-- The sending key pair (VAPID) is made by the function the first time it is needed and kept in push_vapid.

CREATE TABLE IF NOT EXISTS group_feed.push_subs (
  id        bigserial PRIMARY KEY,
  key_hash  text NOT NULL REFERENCES group_feed.phone_keys(key_hash) ON DELETE CASCADE, -- the phone's own key
  endpoint  text NOT NULL UNIQUE CHECK (length(endpoint) <= 1000),
  kinds     text[] NOT NULL DEFAULT '{news,reply,due,answer}',  -- the switches that are on
  last_at   timestamptz NOT NULL DEFAULT now(),                  -- what is newer than this is not yet looked at
  due_said  bigint[] NOT NULL DEFAULT '{}',                      -- homework already said to be due
  waiting   jsonb NOT NULL DEFAULT '[]',                         -- alerts kept for the phone to fetch, at most 10
  fails     int NOT NULL DEFAULT 0,
  made_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE group_feed.push_subs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS push_subs_key ON group_feed.push_subs (key_hash);

CREATE TABLE IF NOT EXISTS group_feed.push_vapid (
  only_one   boolean PRIMARY KEY DEFAULT true CHECK (only_one),
  public_key text NOT NULL,      -- base64url, the raw P-256 point the phone needs
  private_jwk jsonb NOT NULL,    -- used only by the web function to sign
  last_run   timestamptz
);
ALTER TABLE group_feed.push_vapid ENABLE ROW LEVEL SECURITY;

-- The kinds a phone can switch on (as on the computer, without "a new version is ready": the phone updates itself).
CREATE OR REPLACE FUNCTION group_feed.push_kinds(p text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}') FROM unnest(p) k WHERE k IN ('news', 'feed', 'reply', 'due', 'answer') $$;

-- Only the push services of Apple, Google, Mozilla and Microsoft: the web function sends nowhere else.
CREATE OR REPLACE FUNCTION group_feed.push_endpoint_ok(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p ~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/[A-Za-z0-9_:./%=+-]+$'
    AND length(p) <= 1000 $$;

-- A phone keeps (or changes) its subscription; p_endpoint NULL with p_old takes one away. Only with a phone key.
CREATE OR REPLACE FUNCTION group_feed.push_sub(p_key_hash text, p_endpoint text, p_kinds text[], p_old text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_feed.phone_keys pk WHERE pk.key_hash = p_key_hash) OR group_feed.who(p_key_hash) IS NULL THEN
    RETURN jsonb_build_object('error', 'nokey');
  END IF;
  IF p_old IS NOT NULL AND p_old IS DISTINCT FROM p_endpoint THEN
    DELETE FROM group_feed.push_subs WHERE key_hash = p_key_hash AND endpoint = p_old;
  END IF;
  IF p_endpoint IS NULL THEN RETURN jsonb_build_object('on', false); END IF;
  IF NOT group_feed.push_endpoint_ok(p_endpoint) THEN RETURN jsonb_build_object('error', 'bad'); END IF;
  INSERT INTO group_feed.push_subs (key_hash, endpoint, kinds) VALUES (p_key_hash, p_endpoint, group_feed.push_kinds(p_kinds))
    ON CONFLICT (endpoint) DO UPDATE SET key_hash = EXCLUDED.key_hash, kinds = EXCLUDED.kinds, fails = 0;
  DELETE FROM group_feed.push_subs WHERE key_hash = p_key_hash AND endpoint <> p_endpoint; -- one phone, one address
  RETURN jsonb_build_object('on', true, 'kinds', to_jsonb(group_feed.push_kinds(p_kinds)));
END $$;

-- Looks at every phone: what is new for it, as its switches allow, is kept in `waiting`. Returns the phones to wake.
-- p_force false: does nothing if it ran in the last ten minutes (the function calls it now and then with false, and
-- with true after anything was written).
CREATE OR REPLACE FUNCTION group_feed.push_run(p_force boolean) RETURNS TABLE (sub_id bigint, endpoint text)
LANGUAGE plpgsql AS $$
DECLARE s record; r jsonb; fresh jsonb; dues bigint[];
BEGIN
  IF NOT p_force AND EXISTS (SELECT 1 FROM group_feed.push_vapid v WHERE v.last_run > now() - interval '10 minutes') THEN RETURN; END IF;
  UPDATE group_feed.push_vapid SET last_run = now();
  FOR s IN SELECT * FROM group_feed.push_subs FOR UPDATE SKIP LOCKED LOOP
    r := group_feed.alerts(s.key_hash, s.last_at);
    IF r ? 'error' THEN CONTINUE; END IF;
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'at'), '[]'),
           coalesce(array_agg((x->>'post')::bigint) FILTER (WHERE x->>'kind' = 'due'), '{}')
      INTO fresh, dues
      FROM jsonb_array_elements(r->'items') x
      WHERE x->>'kind' = ANY (s.kinds)
        AND (x->>'kind' <> 'due' OR ((x->>'due_on')::date = current_date + 1 AND NOT (x->>'post')::bigint = ANY (s.due_said)));
    UPDATE group_feed.push_subs SET last_at = (r->>'now')::timestamptz, due_said = (SELECT coalesce(array_agg(DISTINCT d), '{}') FROM unnest(due_said || dues) d),
      waiting = CASE WHEN jsonb_array_length(fresh) = 0 THEN waiting
                     ELSE (SELECT coalesce(jsonb_agg(w), '[]') FROM (SELECT w FROM jsonb_array_elements(waiting || fresh) WITH ORDINALITY t(w, n) ORDER BY n DESC LIMIT 10) z) END
      WHERE id = s.id;
    IF jsonb_array_length(fresh) > 0 THEN sub_id := s.id; endpoint := s.endpoint; RETURN NEXT; END IF;
  END LOOP;
END $$;

-- The phone fetches what waits for it, and it is let go. Newest first.
CREATE OR REPLACE FUNCTION group_feed.push_take(p_key_hash text, p_endpoint text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE got jsonb;
BEGIN
  IF group_feed.who(p_key_hash) IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  SELECT waiting INTO got FROM group_feed.push_subs WHERE key_hash = p_key_hash AND endpoint = p_endpoint FOR UPDATE;
  UPDATE group_feed.push_subs SET waiting = '[]' WHERE key_hash = p_key_hash AND endpoint = p_endpoint;
  RETURN jsonb_build_object('items', (SELECT coalesce(jsonb_agg(w ORDER BY w->>'at' DESC), '[]') FROM jsonb_array_elements(coalesce(got, '[]')) w));
END $$;

-- How a wake went: p_gone true (the push service says the address is gone) takes the subscription away; false (it
-- failed) counts up, and the 20th failure in a row takes it away; NULL (it went) starts the count again.
CREATE OR REPLACE FUNCTION group_feed.push_result(p_sub bigint, p_gone boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_gone IS NULL THEN UPDATE group_feed.push_subs SET fails = 0 WHERE id = p_sub; RETURN; END IF;
  DELETE FROM group_feed.push_subs WHERE id = p_sub AND (p_gone OR fails >= 19);
  UPDATE group_feed.push_subs SET fails = fails + 1 WHERE id = p_sub;
END $$;

-- What the phone's switches are now (so Sovran Go shows them).
CREATE OR REPLACE FUNCTION group_feed.push_state(p_key_hash text, p_endpoint text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN group_feed.who(p_key_hash) IS NULL THEN jsonb_build_object('error', 'nokey')
    ELSE jsonb_build_object('on', s.id IS NOT NULL, 'kinds', to_jsonb(coalesce(s.kinds, '{news,reply,due,answer}'::text[]))) END
  FROM (SELECT 1) one LEFT JOIN group_feed.push_subs s ON s.key_hash = p_key_hash AND s.endpoint = p_endpoint $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['push_kinds(text[])', 'push_endpoint_ok(text)', 'push_sub(text,text,text[],text)', 'push_run(boolean)',
    'push_take(text,text)', 'push_result(bigint,boolean)', 'push_state(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION group_feed.%s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION group_feed.%s FROM anon, authenticated', f);
    END IF;
  END LOOP;
END $$;
