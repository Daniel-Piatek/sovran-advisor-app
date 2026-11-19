-- Checks for cloud/group-feed.sql. Run on a THROWAWAY Postgres only, never the Sovran cloud:
--   createdb gf_test && psql -v ON_ERROR_STOP=1 -d gf_test -f cloud/group-feed.test.sql
-- It makes a stand-in library.students table, runs group-feed.sql twice (it must be safe to run again), and checks
-- that groups stay apart, that only the guide posts announcements, and the rules on names, pausing and closing.
\set ON_ERROR_STOP 1
CREATE SCHEMA IF NOT EXISTS library;
CREATE TABLE IF NOT EXISTS library.students (id text PRIMARY KEY, label text, key_hash text, active boolean, added_on date, revoked_on date);
INSERT INTO library.students (id, key_hash, active) VALUES
  ('client-aaaaaaaaaaaa', repeat('a', 64), true),   -- SQ01
  ('client-bbbbbbbbbbbb', repeat('b', 64), true),   -- SQ01
  ('client-cccccccccccc', repeat('c', 64), true),   -- SQ02
  ('client-dddddddddddd', repeat('d', 64), false),  -- SQ01, key switched off
  ('client-eeeeeeeeeeee', repeat('e', 64), true)    -- in no group
  ON CONFLICT DO NOTHING;
\ir group-feed.sql
\ir group-feed.sql

INSERT INTO group_feed.groups (code, title) VALUES ('SQ01', 'Sovran Quest 1'), ('SQ02', 'Sovran Quest 2') ON CONFLICT DO NOTHING;
INSERT INTO group_feed.members (student_id, group_code) VALUES ('client-aaaaaaaaaaaa', 'SQ01'), ('client-bbbbbbbbbbbb', 'SQ01'),
  ('client-cccccccccccc', 'SQ02'), ('client-dddddddddddd', 'SQ01') ON CONFLICT DO NOTHING;
INSERT INTO group_feed.guides (key_hash, name) VALUES (repeat('f', 64), 'Daniel') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

DO $$
DECLARE A text := repeat('a', 64); B text := repeat('b', 64); C text := repeat('c', 64); D text := repeat('d', 64);
        E text := repeat('e', 64); G text := repeat('f', 64); r jsonb; p1 bigint; p2 bigint; n1 bigint; c1 bigint; pic text;
BEGIN
  PERFORM pg_temp.ok(group_feed.who(D) IS NULL, 'a switched-off key gets nothing');
  PERFORM pg_temp.ok(group_feed.who(E) IS NULL, 'a key in no group gets nothing');
  PERFORM pg_temp.ok(group_feed.read(D, 'feed', NULL, NULL, 20)->>'error' = 'nokey', 'a switched-off key cannot read');
  PERFORM pg_temp.ok(group_feed.who(A)->>'student' IS NOT NULL AND group_feed.read(A, 'feed', NULL, NULL, 20)->'me'->>'student' IS NULL,
    'the student id is not sent back to the app');

  r := group_feed.post(A, 'feed', 'post', NULL, 'hello', '{}', NULL, NULL);
  PERFORM pg_temp.ok(r->>'error' = 'noname', 'a student must pick a name before posting');
  PERFORM pg_temp.ok(group_feed.set_name(A, '  Maya ')->>'name' = 'Maya', 'name is trimmed');
  PERFORM pg_temp.ok(group_feed.set_name(A, repeat('x', 41))->>'error' = 'bad', 'a name over 40 characters is refused');
  PERFORM group_feed.set_name(B, 'Jon'); PERFORM group_feed.set_name(C, 'Ana');

  p1 := (group_feed.post(A, 'feed', 'post', 'SQ02', 'Took my Tyrant for a walk', '{}', NULL, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(p1 IS NOT NULL, 'a student posts to Sharing');
  PERFORM pg_temp.ok((SELECT group_code FROM group_feed.posts WHERE id = p1) = 'SQ01', 'a student post goes to their own group, whatever the app asks');
  PERFORM pg_temp.ok(group_feed.post(A, 'news', 'homework', NULL, 'Do this', '{}', NULL, NULL)->>'error' = 'guideonly', 'a student cannot post an announcement');

  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(B, 'feed', NULL, NULL, 20)->'posts') = 1, 'same group sees the post');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(C, 'feed', 'SQ01', NULL, 20)->'posts') = 0, 'other group does not, even asking for SQ01');
  PERFORM pg_temp.ok(group_feed.comment(C, p1, 'peek')->>'error' = 'gone', 'other group cannot comment');
  PERFORM pg_temp.ok(group_feed.like(C, p1, true)->>'error' = 'gone', 'other group cannot like');
  PERFORM pg_temp.ok(group_feed.delete_post(B, p1)->>'error' = 'notyours', 'a student cannot delete someone else''s post');
  PERFORM pg_temp.ok(group_feed.edit_post(B, p1, 'changed', '{}', NULL, NULL)->>'error' = 'notyours', 'nor edit it');

  c1 := (group_feed.comment(B, p1, 'Love this')->>'id')::bigint;
  PERFORM pg_temp.ok(c1 IS NOT NULL, 'same group comments');
  PERFORM pg_temp.ok((group_feed.like(B, p1, true)->>'likes')::int = 1, 'a like counts');
  PERFORM pg_temp.ok((group_feed.like(B, p1, true)->>'likes')::int = 1, 'liking twice still counts once');
  r := group_feed.read(A, 'feed', NULL, NULL, 20)->'posts'->0;
  PERFORM pg_temp.ok((r->>'mine')::boolean AND r->>'author' = 'Maya' AND jsonb_array_length(r->'comments') = 1, 'the author sees it as theirs, with the comment');

  -- announcements
  n1 := (group_feed.post(G, 'news', 'homework', 'SQ01', 'Week 2: meet your Tyrant', '{}', '2026-11-22', true)->>'id')::bigint;
  p2 := (group_feed.post(G, 'news', 'reminder', 'ALL', 'Live call Thursday', '{}', NULL, true)->>'id')::bigint;
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(A, 'news', NULL, NULL, 20)->'posts') = 2, 'SQ01 sees its homework and the all-groups reminder');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(C, 'news', NULL, NULL, 20)->'posts') = 1, 'SQ02 sees only the all-groups reminder');
  PERFORM pg_temp.ok((group_feed.read(A, 'news', NULL, NULL, 20)->'posts'->0->>'by_guide')::boolean, 'announcements show as the guide''s');
  PERFORM pg_temp.ok(group_feed.mark_done(A, n1, true)->>'done' = 'true', 'a student ticks homework done');
  PERFORM pg_temp.ok((group_feed.read(A, 'news', NULL, NULL, 20)->'posts'->1->>'done')::boolean, 'and sees their tick');
  PERFORM pg_temp.ok((group_feed.read(B, 'news', NULL, NULL, 20)->'posts'->1->>'done')::boolean = false, 'another student does not see it');
  PERFORM pg_temp.ok((group_feed.read(G, 'news', 'SQ01', NULL, 20)->'posts'->1->>'done')::int = 1, 'the guide sees how many ticked');
  PERFORM pg_temp.ok(group_feed.comment(A, n1, 'Can I write two pages?')->>'id' IS NOT NULL, 'a student asks a question under an announcement');
  PERFORM group_feed.edit_post(G, n1, 'Week 2: meet your Tyrant', '{}', '2026-11-22', false);
  PERFORM pg_temp.ok(group_feed.comment(B, n1, 'me too')->>'error' = 'nocomments', 'the guide can turn questions off');
  PERFORM pg_temp.ok(group_feed.post(G, 'feed', 'post', NULL, 'to nobody', '{}', NULL, NULL)->>'error' = 'group', 'the guide picks a group for Sharing');

  -- pictures
  r := group_feed.picture_slot(A, 'abcdefghijklmnopqrstuv', 'SQ02');
  pic := r->>'path';
  PERFORM pg_temp.ok(pic = 'SQ01/abcdefghijklmnopqrstuv.jpg', 'a student''s picture goes in their group''s folder');
  PERFORM group_feed.picture_kept(A, pic, 190000);
  PERFORM pg_temp.ok(group_feed.post(B, 'feed', 'post', NULL, 'stolen', ARRAY[pic], NULL, NULL)->>'error' = 'pictures', 'nobody else can put your picture on a post');
  p2 := (group_feed.post(A, 'feed', 'post', NULL, '', ARRAY[pic], NULL, NULL)->>'id')::bigint;
  PERFORM pg_temp.ok(p2 IS NOT NULL, 'a post can be just a picture');
  PERFORM pg_temp.ok(group_feed.picture_ok(B, pic), 'the group may fetch it');
  PERFORM pg_temp.ok(NOT group_feed.picture_ok(C, pic), 'another group may not');
  PERFORM pg_temp.ok(group_feed.post(A, 'feed', 'post', NULL, 'again', ARRAY[pic], NULL, NULL)->>'error' = 'pictures', 'a picture is on one post only');
  PERFORM pg_temp.ok(group_feed.post(A, 'feed', 'post', NULL, '', '{}', NULL, NULL)->>'error' = 'bad', 'an empty post is refused');

  -- flags and the guide's tools
  PERFORM group_feed.flag(B, p2, NULL);
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.flags_open(G)->'flags') = 1, 'the guide sees a flag');
  PERFORM pg_temp.ok(group_feed.flags_open(A)->>'error' = 'guideonly', 'a student cannot see flags');
  PERFORM group_feed.hide(G, 'post', p2, true);
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(B, 'feed', NULL, NULL, 20)->'posts') = 1, 'a hidden post leaves every student''s app');
  PERFORM pg_temp.ok(NOT group_feed.picture_ok(B, pic), 'and so does its picture');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.flags_open(G)->'flags') = 0, 'hiding deals with the flag');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(G, 'feed', 'SQ01', NULL, 20)->'posts') = 2, 'the guide still sees it, to bring it back');
  PERFORM pg_temp.ok(group_feed.hide(A, 'post', p1, true)->>'error' = 'guideonly', 'a student cannot hide');
  PERFORM pg_temp.ok(group_feed.read(G, 'feed', 'SQ01', NULL, 20)->'posts'->-1->>'student' LIKE 'client-%', 'the guide sees who wrote a post, to pause them');
  PERFORM pg_temp.ok(NOT (group_feed.read(B, 'feed', NULL, NULL, 20)->'posts'->0 ? 'student') OR group_feed.read(B, 'feed', NULL, NULL, 20)->'posts'->0->>'student' IS NULL, 'a student never sees another''s id');

  PERFORM group_feed.manage(G, 'pause', 'client-bbbbbbbbbbbb', NULL);
  PERFORM pg_temp.ok(group_feed.comment(B, p1, 'x')->>'error' = 'paused', 'a paused student cannot comment');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(B, 'feed', NULL, NULL, 20)->'posts') = 1, 'but can still read');
  PERFORM group_feed.manage(G, 'unpause', 'client-bbbbbbbbbbbb', NULL);

  PERFORM group_feed.manage(G, 'close', NULL, 'SQ01');
  PERFORM pg_temp.ok(group_feed.post(A, 'feed', 'post', NULL, 'after', '{}', NULL, NULL)->>'error' = 'closed', 'a closed group takes no new posts');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(A, 'feed', NULL, NULL, 20)->'posts') = 1, 'but stays readable');
  PERFORM group_feed.manage(G, 'open', NULL, 'SQ01');

  PERFORM pg_temp.ok((group_feed.delete_post(A, p1)->>'deleted')::bigint = p1, 'a student deletes their own post');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(B, 'feed', NULL, NULL, 20)->'posts') = 0, 'and it is gone for everyone');
  PERFORM pg_temp.ok((SELECT body FROM group_feed.posts WHERE id = p1) = '', 'its words are wiped');

  PERFORM group_feed.manage(G, 'move', 'client-cccccccccccc', 'SQ01');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.read(C, 'news', NULL, NULL, 20)->'posts') = 2, 'moving a student to SQ01 shows them SQ01');
  PERFORM pg_temp.ok(jsonb_array_length(group_feed.groups_list(G)->'groups') = 2, 'the guide lists the groups');
  RAISE NOTICE 'ALL GROUP FEED CHECKS PASSED';
END $$;
