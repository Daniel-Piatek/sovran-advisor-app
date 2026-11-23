-- Checks for cloud/quest.sql. Run on a THROWAWAY Postgres only, never the Sovran cloud:
--   createdb q_test && psql -v ON_ERROR_STOP=1 -d q_test -f cloud/quest.test.sql
-- Makes a stand-in library.students table, runs group-feed.sql and quest.sql twice (safe to run again), and checks that
-- only the guide publishes, that a student reads only their own group's weeks, and that publishing again replaces.
\set ON_ERROR_STOP 1
CREATE SCHEMA IF NOT EXISTS library;
CREATE TABLE IF NOT EXISTS library.students (id text PRIMARY KEY, label text, key_hash text, active boolean, added_on date, revoked_on date);
INSERT INTO library.students (id, key_hash, active) VALUES
  ('client-aaaaaaaaaaaa', repeat('a', 64), true),   -- SQ01
  ('client-cccccccccccc', repeat('c', 64), true),   -- SQ02
  ('client-eeeeeeeeeeee', repeat('e', 64), true)    -- in no group
  ON CONFLICT DO NOTHING;
\ir group-feed.sql
\ir quest.sql
\ir quest.sql

INSERT INTO group_feed.groups (code, title) VALUES ('SQ01', 'Sovran Quest 1'), ('SQ02', 'Sovran Quest 2') ON CONFLICT DO NOTHING;
INSERT INTO group_feed.members (student_id, group_code) VALUES ('client-aaaaaaaaaaaa', 'SQ01'), ('client-cccccccccccc', 'SQ02') ON CONFLICT DO NOTHING;
INSERT INTO group_feed.guides (key_hash, name) VALUES (repeat('f', 64), 'Daniel') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

DO $$
DECLARE A text := repeat('a', 64); C text := repeat('c', 64); E text := repeat('e', 64); G text := repeat('f', 64); r jsonb;
BEGIN
  PERFORM pg_temp.ok(group_feed.quest_publish(A, 'SQ01', 1, '{"title":"x"}')->>'error' = 'guideonly', 'a student cannot publish');
  PERFORM pg_temp.ok(group_feed.quest_publish(repeat('9', 64), 'SQ01', 1, '{}')->>'error' = 'nokey', 'an unknown key cannot publish');
  PERFORM pg_temp.ok(group_feed.quest_publish(G, 'XX01', 1, '{}')->>'error' = 'group', 'only to a group that exists');
  PERFORM pg_temp.ok(group_feed.quest_publish(G, 'SQ01', 1, '[1]')->>'error' = 'bad', 'a week is an object');
  r := group_feed.quest_publish(G, 'SQ01', 1, '{"title":"Seeing","homework":[{"text":"Write","where":"journal"}],"transcript":"T"}');
  PERFORM pg_temp.ok((r->>'first')::boolean, 'the first publish says so');
  PERFORM pg_temp.ok(NOT (group_feed.quest_publish(G, 'SQ01', 1, '{"title":"Seeing again"}')->>'first')::boolean, 'publishing again replaces');
  PERFORM group_feed.quest_publish(G, 'SQ01', 2, '{"title":"Two"}');
  PERFORM group_feed.quest_publish(G, 'SQ02', 1, '{"title":"Other group"}');

  r := group_feed.quest_weeks(A, 'SQ02');
  PERFORM pg_temp.ok(jsonb_array_length(r->'weeks') = 2, 'a student reads their own group only, whatever they ask for');
  PERFORM pg_temp.ok(r->'weeks'->0->>'number' = '2' AND r->'weeks'->1->>'title' = 'Seeing again', 'newest first, the latest version');
  PERFORM pg_temp.ok(r->'weeks'->0->>'group' = 'SQ01', 'each week says its group');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.quest_weeks(C)->'weeks') = 1, 'SQ02 sees its one week');
  PERFORM pg_temp.ok(group_feed.quest_weeks(E)->>'error' = 'nokey', 'a key in no group reads nothing');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.quest_weeks(G)->'weeks') = 3, 'the guide reads every group');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.quest_weeks(G, 'SQ02')->'weeks') = 1, 'or one group');
  r := group_feed.quest_weeks(A);
  PERFORM pg_temp.ok(r->'weeks'->1->'transcript' IS NULL AND (r->'weeks'->1->>'has_transcript')::boolean = false, 'the list carries no transcript');
  PERFORM group_feed.quest_publish(G, 'SQ01', 3, '{"title":"Three","transcript":"Daniel: hello"}');
  PERFORM pg_temp.ok((group_feed.quest_weeks(A)->'weeks'->0->>'has_transcript')::boolean, 'but says when there is one');
  PERFORM pg_temp.ok(group_feed.quest_transcript(A, 3)->>'transcript' = 'Daniel: hello', 'a student reads their group''s transcript');
  PERFORM pg_temp.ok(group_feed.quest_transcript(C, 3)->>'error' = 'gone', 'never another group''s');
  PERFORM pg_temp.ok(group_feed.quest_transcript(G, 3, 'SQ01')->>'transcript' = 'Daniel: hello', 'the guide names the group');
  PERFORM pg_temp.ok(group_feed.quest_transcript(E, 3)->>'error' = 'nokey', 'a key in no group reads none');
END $$;
