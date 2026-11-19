-- Tell Daniel (2026-11-19, the owner's wish), kept in the Sovran cloud database. A student presses Tell Daniel on an
-- Assistant answer, a note, a journal entry, a report passage or the app itself, picks what kind of thing it is
-- ("Something isn't working", "Something seems off here", "I have a question about this", "Other"), says why, and the
-- app sends it with what it was about (the question and answer, the library pieces used, the passage, the app version).
-- Each report waits here with a status (new, digging = "Needs digging", done = "Dealt with") for Daniel's Student reports
-- page in APP Daniel, and for Daniel's own Claude to read. A student is known by their library key (library.students),
-- whether or not they are in a group; Daniel by the guide key (group_feed.guides, so run cloud/group-feed.sql first).
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
CREATE INDEX IF NOT EXISTS reports_status ON tell_daniel.reports (status, id DESC);
ALTER TABLE tell_daniel.reports ENABLE ROW LEVEL SECURITY;   -- no policies: only the function's owner role gets in

-- A student sends one. Returns {id} or {error}.
CREATE OR REPLACE FUNCTION tell_daniel.tell(p_key_hash text, p_kind text, p_why text, p_place text, p_context jsonb, p_version text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s text; new_id bigint;
BEGIN
  SELECT id INTO s FROM library.students WHERE key_hash = p_key_hash AND active;
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
      'status', r.status, 'note', r.note, 'created_at', r.created_at, 'status_at', r.status_at) x
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tell_daniel FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tell_daniel FROM anon, authenticated';
  END IF;
END $$;
