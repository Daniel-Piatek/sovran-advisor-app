-- Tell Daniel (2026-11-19, the owner's wish), kept in the Sovran cloud database. A student presses Tell Daniel on an
-- Assistant answer, a note, a journal entry, a report passage or the app itself, picks what kind of thing it is
-- ("Something isn't working", "Something seems off here", "I have a question about this", "Other"), says why, and the
-- app sends it with what it was about (the question and answer, the library pieces used, the passage, the app version).
-- Each report waits here with a status (new, digging = "Needs digging", done = "Dealt with") for Daniel's Student reports
-- page in APP Daniel, and for Daniel's own Claude to read. A student is known by their library key (library.students),
-- whether or not they are in a group, or by their phone's own key (group_feed.phone_keys, go Sovran); Daniel by the guide key (group_feed.guides, so run cloud/group-feed.sql first).
-- The schema is not offered to the web API; only the group-feed web function (cloud/group-feed/index.ts) uses it.
-- Safe to run again.

CREATE SCHEMA IF NOT EXISTS tell_daniel;
REVOKE ALL ON SCHEMA tell_daniel FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA tell_daniel FROM anon, authenticated'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS tell_daniel.reports (
  id          bigserial PRIMARY KEY,
  student_id  text NOT NULL,                                 -- library.students.id
  kind        text NOT NULL CHECK (kind IN ('broken', 'off', 'question', 'other')),
  why         text NOT NULL DEFAULT '' CHECK (length(why) <= 4000),
  place       text NOT NULL CHECK (place IN ('assistant', 'note', 'journal', 'report', 'group', 'app')),
  context     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 60000),
  app_version text CHECK (app_version IS NULL OR length(app_version) <= 80),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'digging', 'done')),
  note        text CHECK (note IS NULL OR length(note) <= 4000), -- Daniel's own note on it
  created_at  timestamptz NOT NULL DEFAULT now(),
  status_at   timestamptz,
  CHECK (kind <> 'other' OR length(btrim(why)) > 0)          -- "Other" needs words
);
-- Claude's diagnosis (2026-11-22, the owner's wish: each report goes straight to Claude, which works out what is going on
-- and writes it here, so Daniel reads it beside the student's words). Written only by tell_daniel.diagnose.
ALTER TABLE tell_daniel.reports ADD COLUMN IF NOT EXISTS diagnosis text CHECK (diagnosis IS NULL OR length(diagnosis) <= 20000);
ALTER TABLE tell_daniel.reports ADD COLUMN IF NOT EXISTS diagnosis_kind text
  CHECK (diagnosis_kind IS NULL OR diagnosis_kind IN ('bug', 'data', 'question', 'misunderstanding', 'fixed', 'other'));
ALTER TABLE tell_daniel.reports ADD COLUMN IF NOT EXISTS diagnosis_pr text CHECK (diagnosis_pr IS NULL OR (diagnosis_pr ~ '^https://github\.com/[^ ]+$' AND length(diagnosis_pr) <= 300));
ALTER TABLE tell_daniel.reports ADD COLUMN IF NOT EXISTS diagnosed_at timestamptz;
CREATE INDEX IF NOT EXISTS reports_status ON tell_daniel.reports (status, id DESC);
ALTER TABLE tell_daniel.reports ENABLE ROW LEVEL SECURITY;   -- no policies: only the function's owner role gets in

-- A student sends one. Returns {id} or {error}.
CREATE OR REPLACE FUNCTION tell_daniel.tell(p_key_hash text, p_kind text, p_why text, p_place text, p_context jsonb, p_version text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s text; new_id bigint;
BEGIN
  SELECT id INTO s FROM library.students WHERE key_hash = p_key_hash AND active;
  IF s IS NULL THEN -- the student's go Sovran (Stuck? Ask Daniel on Sovran Quest, 2026-11-23): their phone's own key
    SELECT st.id INTO s FROM group_feed.phone_keys pk JOIN library.students st ON st.id = pk.student_id AND st.active
      WHERE pk.key_hash = p_key_hash;
  END IF;
  IF s IS NULL THEN RETURN jsonb_build_object('error', 'unknown'); END IF;
  IF (SELECT count(*) FROM tell_daniel.reports WHERE student_id = s AND created_at > now() - interval '1 day') >= 30 THEN
    RETURN jsonb_build_object('error', 'toomany'); END IF;
  INSERT INTO tell_daniel.reports (student_id, kind, why, place, context, app_version)
    VALUES (s, p_kind, btrim(coalesce(p_why, '')), p_place, coalesce(p_context, '{}'::jsonb), nullif(btrim(coalesce(p_version, '')), ''))
    RETURNING id INTO new_id;
  RETURN jsonb_build_object('id', new_id);
EXCEPTION WHEN check_violation OR not_null_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- Daniel's list, newest first: one status or every one (p_status NULL), 50 at a time (p_before: the last id shown).
CREATE OR REPLACE FUNCTION tell_daniel.list(p_key_hash text, p_status text, p_before bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  RETURN jsonb_build_object('reports', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'id')::bigint DESC) FROM (
    SELECT jsonb_build_object('id', r.id, 'student_id', r.student_id,
      'student', coalesce(m.name, st.label, r.student_id), 'group', m.group_code,
      'kind', r.kind, 'why', r.why, 'place', r.place, 'context', r.context, 'app_version', r.app_version,
      'status', r.status, 'note', r.note, 'created_at', r.created_at, 'status_at', r.status_at,
      'diagnosis', r.diagnosis, 'diagnosis_kind', r.diagnosis_kind, 'diagnosis_pr', r.diagnosis_pr, 'diagnosed_at', r.diagnosed_at) x
    FROM tell_daniel.reports r
    LEFT JOIN group_feed.members m ON m.student_id = r.student_id
    LEFT JOIN library.students st ON st.id = r.student_id
    WHERE (p_status IS NULL OR r.status = p_status) AND (p_before IS NULL OR r.id < p_before)
    ORDER BY r.id DESC LIMIT 50) q), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object('new', count(*) FILTER (WHERE status = 'new'), 'digging', count(*) FILTER (WHERE status = 'digging'),
      'done', count(*) FILTER (WHERE status = 'done')) FROM tell_daniel.reports));
END $$;

-- Daniel marks one: new, digging (Needs digging) or done (Dealt with), with a note of his own if he likes.
CREATE OR REPLACE FUNCTION tell_daniel.set_status(p_key_hash text, p_id bigint, p_status text, p_note text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  UPDATE tell_daniel.reports SET status = p_status, status_at = now(), note = coalesce(nullif(btrim(p_note), ''), note) WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  RETURN jsonb_build_object('id', p_id, 'status', p_status);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- Claude writes its diagnosis (run by Daniel's own Claude through the Supabase connector, never by an app). A New report
-- becomes Needs digging; one Daniel already marked keeps his status.
CREATE OR REPLACE FUNCTION tell_daniel.diagnose(p_id bigint, p_kind text, p_text text, p_pr text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tell_daniel.reports SET diagnosis = btrim(p_text), diagnosis_kind = p_kind, diagnosis_pr = nullif(btrim(coalesce(p_pr, '')), ''),
    diagnosed_at = now(), status = CASE WHEN status = 'new' THEN 'digging' ELSE status END,
    status_at = CASE WHEN status = 'new' THEN now() ELSE status_at END
  WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  RETURN jsonb_build_object('id', p_id, 'diagnosed', true);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- Waking Claude the moment a report lands (2026-11-22). Daniel made a Claude scheduled task with an API trigger; its Fire
-- URL is kept here and its token in Supabase Vault as 'tell_daniel_wake_token' (put there by Daniel, never seen by an
-- agent). A new report sends one POST through pg_net with only the report's number; the task reads the rest itself.
-- Anything missing or failing leaves the report as it is (the next run picks up every report not yet diagnosed).
CREATE TABLE IF NOT EXISTS tell_daniel.wake (
  only_one  boolean PRIMARY KEY DEFAULT true CHECK (only_one),
  fire_url  text CHECK (fire_url ~ '^https://api\.anthropic\.com/v1/claude_code/routines/trig_[A-Za-z0-9]{10,60}/fire$'),
  on_off    boolean NOT NULL DEFAULT true
);
ALTER TABLE tell_daniel.wake ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS tell_daniel.wakes (
  id         bigserial PRIMARY KEY,
  report_id  bigint NOT NULL,
  request_id bigint,                                         -- net._http_response.id, to see how Anthropic answered
  problem    text,
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tell_daniel.wakes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION tell_daniel.wake_claude() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE url text; token text; req bigint;
BEGIN
  SELECT fire_url INTO url FROM tell_daniel.wake WHERE on_off;
  IF url IS NULL THEN RETURN NEW; END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regnamespace('net') IS NULL THEN
    INSERT INTO tell_daniel.wakes (report_id, problem) VALUES (NEW.id, 'no vault or pg_net'); RETURN NEW; END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1' INTO token USING 'tell_daniel_wake_token';
  IF coalesce(token, '') = '' THEN INSERT INTO tell_daniel.wakes (report_id, problem) VALUES (NEW.id, 'no token in Vault'); RETURN NEW; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)' INTO req
    USING url, jsonb_build_object('text', 'Tell Daniel report ' || NEW.id),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(token), 'anthropic-beta', 'experimental-cc-routine-2026-04-01',
                             'anthropic-version', '2023-06-01', 'Content-Type', 'application/json');
  INSERT INTO tell_daniel.wakes (report_id, request_id) VALUES (NEW.id, req);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO tell_daniel.wakes (report_id, problem) VALUES (NEW.id, left(SQLERRM, 300));
  RETURN NEW;                                                -- a report is never lost because waking failed
END $$;
DROP TRIGGER IF EXISTS wake_claude ON tell_daniel.reports;
CREATE TRIGGER wake_claude AFTER INSERT ON tell_daniel.reports FOR EACH ROW EXECUTE FUNCTION tell_daniel.wake_claude();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tell_daniel FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tell_daniel FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA tell_daniel FROM anon, authenticated';
  END IF;
END $$;
