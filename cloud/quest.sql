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
    FROM group_feed.quest_weeks q WHERE grp IS NULL OR q.group_code = grp), '[]'::jsonb));
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA group_feed FROM anon, authenticated';
  END IF;
END $$;
