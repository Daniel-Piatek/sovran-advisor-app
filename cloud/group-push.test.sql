-- Checks for cloud/group-push.sql. Run on a THROWAWAY Postgres only, never the Sovran cloud, after group-feed.test.sql,
-- tell-daniel.test.sql and group-alerts.test.sql (it uses their stand-in students and guide):
--   psql -v ON_ERROR_STOP=1 -d gf_test -f cloud/group-push.test.sql
\set ON_ERROR_STOP 1
\ir group-push.sql
\ir group-push.sql

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;
-- The checks run in one transaction, where now() stands still: before each new event, move what is there an hour back.
CREATE OR REPLACE FUNCTION pg_temp.later() RETURNS void LANGUAGE sql AS $$
  UPDATE group_feed.posts SET created_at = created_at - interval '1 hour';
  UPDATE group_feed.comments SET created_at = created_at - interval '1 hour';
  UPDATE group_feed.push_subs SET last_at = last_at - interval '1 hour' $$;

DO $$
DECLARE A text := repeat('a', 64); B text := repeat('b', 64); G text := repeat('f', 64); P text := repeat('7', 64);
        E text := 'https://web.push.apple.com/QGuQyavXutnMH-made-up'; E2 text := 'https://fcm.googleapis.com/fcm/send/made-up:APA91b';
        r jsonb; n int; pa bigint; pn bigint; s bigint;
BEGIN
  UPDATE group_feed.posts SET created_at = now() - interval '1 day', due_on = NULL;
  UPDATE group_feed.comments SET created_at = now() - interval '1 day';
  UPDATE tell_daniel.reports SET created_at = now() - interval '1 day', status_at = now() - interval '1 day',
    answered_at = CASE WHEN answered_at IS NULL THEN NULL ELSE now() - interval '1 day' END;
  UPDATE tell_daniel.messages SET created_at = now() - interval '1 day';
  INSERT INTO group_feed.push_vapid (public_key, private_jwk) VALUES ('made-up', '{}') ON CONFLICT DO NOTHING;
  PERFORM group_feed.phone_key(A, P);

  PERFORM pg_temp.ok(group_feed.push_sub(A, E, '{news}')->>'error' = 'nokey', 'only a phone keeps a subscription, not the computer''s key');
  PERFORM pg_temp.ok(group_feed.push_sub(P, 'https://evil.example/hook', '{news}')->>'error' = 'bad', 'only a real push service''s address');
  PERFORM pg_temp.ok(group_feed.push_sub(P, 'http://fcm.googleapis.com/x', '{news}')->>'error' = 'bad', 'and only https');
  r := group_feed.push_sub(P, E, '{news,reply,due,answer,update,nonsense}');
  PERFORM pg_temp.ok(r->>'on' = 'true' AND r->'kinds' = '["answer","due","news","reply"]'::jsonb, 'Maya''s phone says yes, with the kinds a phone has');
  PERFORM pg_temp.ok(group_feed.push_state(P, E)->>'on' = 'true', 'and the phone can see it is on');

  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_run(true)), 'nothing new: no phone is woken');
  PERFORM pg_temp.later();
  pa := (group_feed.post(B, 'feed', 'post', NULL, 'Jon''s walk', '{}', NULL, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_run(true)), 'a new Circle post is off by default: not woken');
  PERFORM pg_temp.later();
  pn := (group_feed.post(G, 'news', 'homework', NULL, 'Write one page', '{}', current_date + 1, NULL)->>'id')::bigint;
  SELECT count(*) INTO n FROM group_feed.push_run(true) x WHERE x.endpoint = E;
  PERFORM pg_temp.ok(n = 1, 'a new announcement wakes her phone');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_run(true)), 'once: the next run has nothing new');
  PERFORM pg_temp.later();
  PERFORM group_feed.post(G, 'news', 'reminder', NULL, 'Tomorrow at six', '{}', NULL, NULL);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_run(false)), 'a run too soon after the last does nothing');
  DELETE FROM group_feed.posts WHERE body = 'Tomorrow at six';
  r := group_feed.push_take(P, E);
  PERFORM pg_temp.ok(jsonb_array_length(r->'items') = 2 AND r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'news', 'post', pn))
    AND r->'items' @> jsonb_build_array(jsonb_build_object('kind', 'due', 'post', pn)), 'the phone fetches the announcement and that it is due tomorrow');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.push_take(P, E)->'items') = 0, 'and it is let go once fetched');
  PERFORM pg_temp.ok(group_feed.push_take(B, E)->'items' = '[]'::jsonb, 'nobody else can fetch Maya''s');

  PERFORM pg_temp.later();
  PERFORM group_feed.comment(B, (SELECT id FROM group_feed.posts WHERE student_id = 'client-aaaaaaaaaaaa' AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY id LIMIT 1), 'Lovely', NULL);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM group_feed.push_run(true)), 'a comment on her post wakes her phone');
  PERFORM pg_temp.ok((SELECT waiting->0->>'kind' FROM group_feed.push_subs WHERE endpoint = E) = 'reply', 'as a reply');

  PERFORM group_feed.push_sub(P, E2, '{feed}', E);
  PERFORM pg_temp.ok((SELECT array_agg(endpoint) FROM group_feed.push_subs WHERE key_hash = P) = ARRAY[E2], 'a new address replaces the old one');
  PERFORM pg_temp.later();
  PERFORM group_feed.post(B, 'feed', 'post', NULL, 'Another walk', '{}', NULL, NULL);
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM group_feed.push_run(true)), 'with Any new post switched on, a Circle post wakes it');

  s := (SELECT id FROM group_feed.push_subs WHERE endpoint = E2);
  PERFORM group_feed.push_result(s, false);
  PERFORM pg_temp.ok((SELECT fails FROM group_feed.push_subs WHERE id = s) = 1, 'a failed wake is counted');
  PERFORM group_feed.push_result(s, NULL);
  PERFORM pg_temp.ok((SELECT fails FROM group_feed.push_subs WHERE id = s) = 0, 'and forgotten when one goes');
  PERFORM group_feed.push_result(s, true);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_subs WHERE id = s), 'an address the service says is gone is taken away');

  PERFORM group_feed.push_sub(P, E, '{news}');
  PERFORM group_feed.manage(G, 'phone_off', 'client-aaaaaaaaaaaa', NULL);
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM group_feed.push_subs WHERE key_hash = P), 'Daniel switching her phone off ends its alerts too');
  PERFORM pg_temp.ok(group_feed.push_sub(P, E, '{news}')->>'error' = 'nokey', 'and it cannot come back by itself');
  RAISE NOTICE 'ALL GROUP PUSH CHECKS PASSED';
END $$;
