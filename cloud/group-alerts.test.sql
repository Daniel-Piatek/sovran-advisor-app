-- Checks for cloud/group-alerts.sql. Run on a THROWAWAY Postgres only, never the Sovran cloud, after group-feed.test.sql
-- and tell-daniel.test.sql (it uses their stand-in students and guide):
--   psql -v ON_ERROR_STOP=1 -d gf_test -f cloud/group-alerts.test.sql
\set ON_ERROR_STOP 1
\ir group-alerts.sql
\ir group-alerts.sql

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;
CREATE OR REPLACE FUNCTION pg_temp.kinds(r jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(x->>'kind', ',' ORDER BY x->>'kind'), '') FROM jsonb_array_elements(r->'items') x $$;

DO $$
DECLARE A text := repeat('a', 64); B text := repeat('b', 64); C text := repeat('c', 64); D text := repeat('d', 64); G text := repeat('f', 64);
        t0 timestamptz := now() - interval '1 minute'; r jsonb; pa bigint; pn bigint; ph bigint; ca bigint; cb bigint; rep bigint;
BEGIN
  -- Everything made by earlier checks counts as old: move it back in time.
  UPDATE group_feed.posts SET created_at = now() - interval '1 day', due_on = NULL;
  UPDATE group_feed.comments SET created_at = now() - interval '1 day';
  UPDATE group_feed.flags SET created_at = now() - interval '1 day';
  UPDATE tell_daniel.reports SET created_at = now() - interval '1 day', status_at = now() - interval '1 day';
  DELETE FROM group_feed.done;
  PERFORM group_feed.manage(G, 'move', 'client-cccccccccccc', 'SQ02');

  PERFORM pg_temp.ok(group_feed.alerts(D, t0)->>'error' = 'nokey', 'a switched-off key gets no alerts');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(A, t0)) = '', 'nothing new yet');
  PERFORM pg_temp.ok(group_feed.alerts(A, NULL)->>'now' IS NOT NULL, 'the first ask returns the moment to ask from next time');

  pa := (group_feed.post(A, 'feed', 'post', NULL, 'My first drawing', '{}', NULL, NULL)->>'id')::bigint;
  pn := (group_feed.post(G, 'news', 'announcement', 'SQ01', 'Welcome, everyone', '{}', NULL, NULL)->>'id')::bigint;
  ph := (group_feed.post(G, 'news', 'homework', NULL, 'Read chapter 2', '{}', current_date + 1, NULL)->>'id')::bigint;
  r := group_feed.alerts(A, t0);
  PERFORM pg_temp.ok(pg_temp.kinds(r) = 'due,news,news', 'Maya: the announcement, the homework, and the homework is due');
  PERFORM pg_temp.ok(NOT r->'items' @> jsonb_build_array(jsonb_build_object('post', pa, 'kind', 'feed')), 'never her own post');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(B, t0)) = 'due,feed,news,news', 'Jon also sees Maya''s new post');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(C, t0)) = 'due,news', 'Ana in SQ02: only the homework for every group');

  cb := (group_feed.comment(B, pa, 'Lovely colours', NULL)->>'id')::bigint;
  r := group_feed.alerts(A, t0);
  PERFORM pg_temp.ok(r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'reply', 'comment', cb, 'author', 'Jon')), 'Maya hears Jon commented on her post');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(B, t0)) = 'due,feed,news,news', 'Jon does not hear about his own comment');

  ca := (group_feed.comment(A, pa, 'Thank you!', cb)->>'id')::bigint;
  PERFORM pg_temp.ok(group_feed.alerts(B, t0)->'items' @> jsonb_build_array(jsonb_build_object('kind', 'reply', 'comment', ca)), 'Jon hears Maya replied to his comment');
  PERFORM group_feed.comment(G, pa, 'Wonderful work', cb);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(group_feed.alerts(B, t0)->'items') x WHERE x->>'kind' = 'reply') = 2,
    'and hears Daniel''s reply in the same conversation');

  PERFORM group_feed.mark_done(A, ph, true);
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(A, t0)) NOT LIKE '%due%', 'homework ticked done is not due any more');
  PERFORM pg_temp.ok(group_feed.alerts(A, now() + interval '1 hour')->'items' = '[]'::jsonb, 'nothing after the moment asked about');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(B, now() + interval '1 hour')) = 'due', 'but due homework is always said');

  PERFORM group_feed.hide(G, 'post', pn, true);
  PERFORM pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(group_feed.alerts(B, t0)->'items') x WHERE x->>'kind' = 'news') = 1, 'a hidden post is not alerted');

  rep := (tell_daniel.tell(A, 'question', 'What does my Gremlin mean?', 'report', '{}'::jsonb, NULL)->>'id')::bigint;
  r := group_feed.alerts(G, t0);
  PERFORM pg_temp.ok(r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'report', 'report', rep, 'author', 'Maya')), 'Daniel hears about the new report');
  PERFORM pg_temp.ok(r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'reply', 'author', 'Maya')) = false, 'not about comments on a student''s post');
  PERFORM group_feed.comment(B, ph, 'Thanks Daniel', NULL);
  PERFORM group_feed.flag(B, pa, NULL);
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(G, t0)) = 'flag,reply,report', 'Daniel hears a flag and a comment on his post');

  PERFORM tell_daniel.set_status(G, rep, 'digging', 'private: check the decode');
  PERFORM pg_temp.ok(pg_temp.kinds(group_feed.alerts(A, t0)) NOT LIKE '%answer%', 'Needs digging is not an answer');
  PERFORM tell_daniel.set_status(G, rep, 'done', NULL);
  r := group_feed.alerts(A, t0);
  PERFORM pg_temp.ok(r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'answer', 'report', rep)), 'Maya hears Daniel dealt with it');
  PERFORM pg_temp.ok(r::text NOT LIKE '%private%', 'Daniel''s own note never goes to the student');
  RAISE NOTICE 'ALL GROUP ALERTS CHECKS PASSED';
END $$;
