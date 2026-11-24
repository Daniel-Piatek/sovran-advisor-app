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
  -- go Sovran: Stuck? Ask Daniel on Sovran Quest, with the phone's own key (2026-11-23)
  PERFORM group_feed.phone_key(A, repeat('6', 64));
  PERFORM pg_temp.ok(tell_daniel.tell(repeat('6', 64), 'question', 'Stuck on homework 2', 'app', '{"from":"go Sovran"}'::jsonb, NULL)->>'id' IS NOT NULL, 'a student''s phone asks too');
  PERFORM pg_temp.ok((SELECT student_id FROM tell_daniel.reports ORDER BY id DESC LIMIT 1) = (SELECT id FROM library.students WHERE key_hash = A), 'as that student');
  PERFORM pg_temp.ok(tell_daniel.tell(repeat('5', 64), 'question', 'x', 'app', '{}'::jsonb, NULL)->>'error' = 'unknown', 'a phone key nobody registered cannot');
  -- Claude's diagnosis
  PERFORM pg_temp.ok(tell_daniel.diagnose(r2, 'bug', 'The Help page failed to load on 0.9.1.', 'https://github.com/Daniel-Piatek/sovran-advisor-app/pull/99')->>'diagnosed' = 'true', 'Claude writes a diagnosis');
  PERFORM pg_temp.ok((SELECT status FROM tell_daniel.reports WHERE id = r2) = 'done', 'a report Daniel already marked keeps his mark');
  PERFORM pg_temp.ok(tell_daniel.diagnose(r2, 'guess', 'x', NULL)->>'error' = 'bad', 'only the known diagnosis kinds');
  PERFORM pg_temp.ok(tell_daniel.diagnose(r2, 'bug', 'x', 'javascript:alert(1)')->>'error' = 'bad', 'a PR link must be a GitHub address');
  l := tell_daniel.list(G, 'done', NULL);
  PERFORM pg_temp.ok(l->'reports'->0->>'diagnosis_kind' = 'bug' AND l->'reports'->0->>'diagnosis_pr' LIKE 'https://github.com/%', 'the list carries the diagnosis');
  -- Waking Claude: nothing set up, nothing sent
  r1 := (tell_daniel.tell(A, 'question', 'Why gold?', 'report', '{}'::jsonb, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM tell_daniel.wakes WHERE report_id = r1), 'with no Fire URL nothing is sent');
  PERFORM tell_daniel.diagnose(r1, 'question', 'A question for Daniel.', NULL);
  PERFORM pg_temp.ok((SELECT status FROM tell_daniel.reports WHERE id = r1) = 'digging', 'a New report becomes Needs digging');
  -- Replies and Ask Claude (2026-11-24)
  PERFORM pg_temp.ok(tell_daniel.reply(G, r1, 'Gold is for the crown. Does that help?')->>'id' IS NOT NULL, 'Daniel replies on a report');
  PERFORM pg_temp.ok(tell_daniel.reply(G, r1, '   ')->>'error' = 'bad', 'a reply needs words');
  PERFORM pg_temp.ok(tell_daniel.reply(G, 999999, 'x')->>'error' = 'gone', 'only on a report that is there');
  l := tell_daniel.mine(A);
  PERFORM pg_temp.ok(l->'reports'->0->>'id' = r1::text AND l->'reports'->0->'messages'->0->>'from_daniel' = 'true', 'the student sees Daniel''s reply on their report');
  PERFORM pg_temp.ok(l::text NOT LIKE '%A question for Daniel%' AND l::text NOT LIKE '%Check part 2%', 'never Claude''s diagnosis or Daniel''s note');
  PERFORM pg_temp.ok(tell_daniel.mine(repeat('6', 64))->'reports'->0->>'id' = r1::text, 'their phone sees the same');
  PERFORM pg_temp.ok(tell_daniel.mine(D)->>'error' = 'unknown', 'a switched-off key sees nothing');
  PERFORM pg_temp.ok(tell_daniel.reply(E, r1, 'Not mine')->>'error' = 'gone', 'another student cannot answer on it');
  PERFORM tell_daniel.seen(A, r1);
  PERFORM pg_temp.ok((SELECT read_at FROM tell_daniel.messages WHERE report_id = r1 AND from_daniel) IS NOT NULL, 'opening it marks Daniel''s reply read');
  PERFORM tell_daniel.set_status(G, r1, 'done', NULL);
  PERFORM pg_temp.ok(tell_daniel.reply(A, r1, 'Yes, thank you!')->>'id' IS NOT NULL, 'the student answers back');
  PERFORM pg_temp.ok((SELECT status FROM tell_daniel.reports WHERE id = r1) = 'digging', 'an answer on a dealt-with report puts it back to Needs digging');
  l := tell_daniel.list(G, NULL, NULL);
  PERFORM pg_temp.ok((SELECT x FROM jsonb_array_elements(l->'reports') x WHERE (x->>'id')::bigint = r1)->'messages'->1->>'body' = 'Yes, thank you!', 'Daniel sees the conversation under the report');
  PERFORM pg_temp.ok(tell_daniel.ask_claude(A, r1, 'Why?')->>'error' = 'guideonly', 'only Daniel asks Claude');
  PERFORM pg_temp.ok(tell_daniel.ask_claude(G, r1, 'Did the reports page break for him?')->>'asked' = 'true', 'Daniel asks Claude about a report');
  PERFORM pg_temp.ok(tell_daniel.claude_answers(r1, 'No: his key went in later.', 'Hi, please try again now.')->>'answered' = 'true', 'Claude answers, with a draft reply');
  l := tell_daniel.list(G, NULL, NULL);
  PERFORM pg_temp.ok((SELECT x FROM jsonb_array_elements(l->'reports') x WHERE (x->>'id')::bigint = r1)->>'claude_draft' = 'Hi, please try again now.', 'Daniel reads Claude''s answer and draft');
  PERFORM pg_temp.ok(tell_daniel.mine(A)::text NOT LIKE '%his key went in%' AND tell_daniel.mine(A)::text NOT LIKE '%Did the reports page%', 'the student never sees Daniel''s question to Claude or its answer');
  RAISE NOTICE 'ALL TELL DANIEL CHECKS PASSED';
END $$;

-- Waking Claude, with stand-ins for Supabase Vault and pg_net (only made where they are missing, as in a local test)
DO $$ BEGIN
  IF to_regnamespace('net') IS NULL THEN
    CREATE SCHEMA net; CREATE TABLE net.sent (id bigserial, url text, body jsonb, headers jsonb);
    CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS
      $f$ INSERT INTO net.sent (url, body, headers) VALUES (url, body, headers) RETURNING id $f$;
  END IF;
END $$;
DO $$
DECLARE A text := repeat('a', 64); r bigint; w record; s record;
BEGIN
  IF to_regclass('net.sent') IS NULL THEN RAISE NOTICE 'skip: a real pg_net here'; RETURN; END IF;
  INSERT INTO tell_daniel.wake (fire_url) VALUES ('https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire')
    ON CONFLICT (only_one) DO UPDATE SET fire_url = EXCLUDED.fire_url, on_off = true;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    r := (tell_daniel.tell(A, 'broken', 'No vault yet', 'app', '{}'::jsonb, NULL)->>'id')::bigint;
    PERFORM pg_temp.ok((SELECT problem FROM tell_daniel.wakes WHERE report_id = r) = 'no vault or pg_net', 'no Vault: the report is kept and the gap is noted');
    CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
  END IF;
  r := (tell_daniel.tell(A, 'broken', 'No token yet', 'app', '{}'::jsonb, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok((SELECT problem FROM tell_daniel.wakes WHERE report_id = r) = 'no token in Vault', 'no token: the report is kept and the gap is noted');
  INSERT INTO vault.decrypted_secrets VALUES ('tell_daniel_wake_token', ' sk-ant-oat01-made-up ');
  r := (tell_daniel.tell(A, 'broken', 'The Planner froze', 'app', '{"secret":"never sent"}'::jsonb, NULL)->>'id')::bigint;
  SELECT * INTO w FROM tell_daniel.wakes WHERE report_id = r;
  SELECT * INTO s FROM net.sent WHERE id = w.request_id;
  PERFORM pg_temp.ok(w.problem IS NULL AND s.url LIKE 'https://api.anthropic.com/%/fire', 'a new report wakes Claude at the Fire URL');
  PERFORM pg_temp.ok(s.body = jsonb_build_object('text', 'Tell Daniel report ' || r), 'only the report''s number is sent, none of its words');
  PERFORM pg_temp.ok(s.headers->>'Authorization' = 'Bearer sk-ant-oat01-made-up' AND s.headers->>'anthropic-beta' = 'experimental-cc-routine-2026-04-01', 'with the token and the beta header');
  UPDATE tell_daniel.wake SET on_off = false;
  r := (tell_daniel.tell(A, 'broken', 'Off now', 'app', '{}'::jsonb, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM tell_daniel.wakes WHERE report_id = r), 'switched off: nothing is sent');
  BEGIN INSERT INTO tell_daniel.wake (only_one, fire_url) VALUES (false, 'x'); PERFORM pg_temp.ok(false, 'one row only');
  EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok(true, 'the wake settings are one row, with a real Fire URL'); END;
  RAISE NOTICE 'ALL WAKE CHECKS PASSED';
END $$;
