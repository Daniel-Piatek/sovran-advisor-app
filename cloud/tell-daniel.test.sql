-- Checks for cloud/tell-daniel.sql. Run on a THROWAWAY Postgres only, never the Sovran cloud, after group-feed.test.sql
-- (it uses that file's stand-in students and guide):
--   psql -v ON_ERROR_STOP=1 -d gf_test -f cloud/tell-daniel.test.sql
\set ON_ERROR_STOP 1
\ir tell-daniel.sql
\ir tell-daniel.sql

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

DO $$
DECLARE A text := repeat('a', 64); D text := repeat('d', 64); E text := repeat('e', 64); G text := repeat('f', 64); r1 bigint; r2 bigint; l jsonb;
BEGIN
  r1 := (tell_daniel.tell(A, 'off', 'This doesn''t sound like my report', 'assistant',
    '{"question":"What is my Tyrant?","answer":"…","library":["decode: part 2"]}'::jsonb, '0.9.1 (abc1234)')->>'id')::bigint;
  PERFORM pg_temp.ok(r1 IS NOT NULL, 'a student sends a report');
  r2 := (tell_daniel.tell(E, 'broken', '', 'app', '{}'::jsonb, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(r2 IS NOT NULL, 'a student in no group can send one too, and why can be empty');
  PERFORM pg_temp.ok(tell_daniel.tell(D, 'broken', 'x', 'app', '{}'::jsonb, NULL)->>'error' = 'unknown', 'a switched-off key cannot');
  PERFORM pg_temp.ok(tell_daniel.tell(A, 'other', '  ', 'app', '{}'::jsonb, NULL)->>'error' = 'bad', '"Other" needs words');
  PERFORM pg_temp.ok(tell_daniel.tell(A, 'rant', 'x', 'app', '{}'::jsonb, NULL)->>'error' = 'bad', 'only the four kinds');
  PERFORM pg_temp.ok(tell_daniel.tell(A, 'off', 'x', 'app', jsonb_build_object('big', repeat('x', 70000)), NULL)->>'error' = 'bad', 'what comes with it has a size limit');
  PERFORM pg_temp.ok(tell_daniel.list(A, NULL, NULL)->>'error' = 'guideonly', 'a student cannot read the list');
  l := tell_daniel.list(G, 'new', NULL);
  PERFORM pg_temp.ok(jsonb_array_length(l->'reports') = 2 AND (l->'counts'->>'new')::int = 2, 'Daniel sees both, newest first');
  PERFORM pg_temp.ok((l->'reports'->1->'context'->>'question') = 'What is my Tyrant?', 'with what it was about');
  PERFORM pg_temp.ok(tell_daniel.set_status(A, r1, 'done', NULL)->>'error' = 'guideonly', 'a student cannot mark one');
  PERFORM tell_daniel.set_status(G, r1, 'digging', 'Check part 2 of the decode');
  PERFORM tell_daniel.set_status(G, r2, 'done', NULL);
  l := tell_daniel.list(G, NULL, NULL);
  PERFORM pg_temp.ok((l->'counts'->>'new')::int = 0 AND (l->'counts'->>'digging')::int = 1 AND (l->'counts'->>'done')::int = 1, 'the counts follow the marks');
  PERFORM pg_temp.ok((SELECT note FROM tell_daniel.reports WHERE id = r1) = 'Check part 2 of the decode', 'Daniel''s note is kept');
  PERFORM pg_temp.ok(tell_daniel.set_status(G, r1, 'maybe', NULL)->>'error' = 'bad', 'only the three statuses');
  RAISE NOTICE 'ALL TELL DANIEL CHECKS PASSED';
END $$;
