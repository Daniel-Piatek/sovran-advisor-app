-- The Sovran Quest shelf (2026-11-23, the owner's wish), kept in the Sovran cloud database. When Daniel approves a week in
-- APP Daniel's Quest weeks, the week (title, call day, daily practice link, homework, replay link, tidied transcript) is
-- put here for his group, exactly as written in the week's master Google Doc. A student's Sovran Central reads the weeks
-- of their own group, found from their key (group_feed.who), never from what the app asks for. Their own work and their
-- Done stay on their computer: nothing about a student is kept here. Needs cloud/group-feed.sql first.
-- The schema is not offered to the web API; only the group-feed web function (cloud/group-feed/index.ts) uses it.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS group_feed.quest_weeks (
  group_code   text NOT NULL REFERENCES group_feed.groups (code),
  number       integer NOT NULL CHECK (number BETWEEN 0 AND 200),
  week         jsonb NOT NULL CHECK (jsonb_typeof(week) = 'object' AND octet_length(week::text) <= 600000),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_code, number)
);
ALTER TABLE group_feed.quest_weeks ENABLE ROW LEVEL SECURITY; -- no policies: only the function's owner role gets in

-- Each student's own daily practice link (2026-11-24, the owner's wish: "each client will have their own unique magic link"
-- on Xperiencify). Daniel pastes it once in APP Daniel's Quest weeks; it goes to that student only (quest_weeks above),
-- whose Open today's practice opens it on the computer and on the phone. With none, the week's own link is used.
CREATE TABLE IF NOT EXISTS group_feed.quest_links (
  student_id text PRIMARY KEY,                               -- library.students.id
  url        text NOT NULL CHECK (url ~ '^https://[^[:space:]]+$' AND length(url) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE group_feed.quest_links ENABLE ROW LEVEL SECURITY; -- no policies: only the function's owner role gets in

-- Daniel publishes (or publishes again) one week to one group. → { ok, first } (first: it was not there before)
CREATE OR REPLACE FUNCTION group_feed.quest_publish(p_key_hash text, p_group text, p_number integer, p_week jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); was boolean;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  IF NOT (w->>'guide')::boolean THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  IF NOT EXISTS (SELECT 1 FROM group_feed.groups WHERE code = p_group) THEN RETURN jsonb_build_object('error', 'group'); END IF;
  was := EXISTS (SELECT 1 FROM group_feed.quest_weeks WHERE group_code = p_group AND number = p_number);
  INSERT INTO group_feed.quest_weeks (group_code, number, week) VALUES (p_group, p_number, p_week)
    ON CONFLICT (group_code, number) DO UPDATE SET week = excluded.week, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'first', NOT was);
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- The weeks a key may read, newest first, without their transcripts: a student's own group's; the guide's of one group
-- (or every group). → { weeks: [ { group, number, has_transcript, published_at, updated_at, ...week } ] }
CREATE OR REPLACE FUNCTION group_feed.quest_weeks(p_key_hash text, p_group text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); grp text;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  grp := CASE WHEN (w->>'guide')::boolean THEN nullif(p_group, '') ELSE w->>'group' END;
  RETURN jsonb_build_object('weeks', coalesce((SELECT jsonb_agg((q.week - 'transcript') || jsonb_build_object('group', q.group_code, 'number', q.number,
      'has_transcript', coalesce(q.week->>'transcript', '') <> '', 'published_at', q.published_at, 'updated_at', q.updated_at) ORDER BY q.number DESC, q.group_code)
    FROM group_feed.quest_weeks q WHERE grp IS NULL OR q.group_code = grp), '[]'::jsonb),
    -- A student's own daily practice link (quest_links), or null: their Open today's practice opens it.
    'practice_url', CASE WHEN (w->>'guide')::boolean THEN NULL ELSE (SELECT l.url FROM group_feed.quest_links l WHERE l.student_id = w->>'student') END);
END $$;

-- One week's transcript, only when it is read or searched (the app keeps no copy of it). → { transcript }
CREATE OR REPLACE FUNCTION group_feed.quest_transcript(p_key_hash text, p_number integer, p_group text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); grp text; t text;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  grp := CASE WHEN (w->>'guide')::boolean THEN nullif(p_group, '') ELSE w->>'group' END;
  IF grp IS NULL THEN RETURN jsonb_build_object('error', 'group'); END IF;
  SELECT q.week->>'transcript' INTO t FROM group_feed.quest_weeks q WHERE q.group_code = grp AND q.number = p_number;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  RETURN jsonb_build_object('transcript', coalesce(t, ''));
END $$;

-- The guide: each student of a group (or of every group) with their own practice link, if any.
-- → { students: [ { student_id, name, group, url } ] }
CREATE OR REPLACE FUNCTION group_feed.quest_links(p_key_hash text, p_group text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  RETURN jsonb_build_object('students', coalesce((SELECT jsonb_agg(jsonb_build_object('student_id', m.student_id, 'name', m.name,
      'group', m.group_code, 'url', l.url) ORDER BY m.group_code, m.joined_at)
    FROM group_feed.members m LEFT JOIN group_feed.quest_links l ON l.student_id = m.student_id
    WHERE nullif(p_group, '') IS NULL OR m.group_code = p_group), '[]'::jsonb));
END $$;

-- The guide sets (or, with no address, takes away) one student's own practice link. → { ok }
CREATE OR REPLACE FUNCTION group_feed.quest_link_set(p_key_hash text, p_student text, p_url text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  IF NOT EXISTS (SELECT 1 FROM group_feed.members WHERE student_id = p_student) THEN RETURN jsonb_build_object('error', 'nostudent'); END IF;
  IF nullif(btrim(p_url), '') IS NULL THEN
    DELETE FROM group_feed.quest_links WHERE student_id = p_student;
  ELSE
    INSERT INTO group_feed.quest_links (student_id, url) VALUES (p_student, btrim(p_url))
      ON CONFLICT (student_id) DO UPDATE SET url = excluded.url, updated_at = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA group_feed FROM anon, authenticated';
  END IF;
END $$;
