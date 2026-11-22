-- Group Feed (module group-feed), kept in the Sovran cloud database. Each Quest group (SQ01, SQ02, ...) has two tabs:
-- Announcements ('news'), where only D (the guide) posts homework, reminders and announcements, and Feed ('feed'),
-- where everyone in the group posts. A student is known by their library key (library.students), and their group by
-- group_feed.members, so a student can only ever read or write their own group: every function below finds the group
-- from the key, never from what the app asks for. D is known by a separate guide key (group_feed.guides).
-- The schema is not offered to the web API; only the group-feed web function (cloud/group-feed/index.ts) uses it.
-- Pictures are files in the private storage bucket group-feed, at <group>/<random>.jpg; the function lets a key holder
-- fetch one only if it belongs to a post they can see. Safe to run again.

CREATE SCHEMA IF NOT EXISTS group_feed;
REVOKE ALL ON SCHEMA group_feed FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA group_feed FROM anon, authenticated'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS group_feed.groups (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at  timestamptz                                    -- a finished Quest: readable, closed to new posts and comments
);

CREATE TABLE IF NOT EXISTS group_feed.members (
  student_id text PRIMARY KEY,                               -- library.students.id
  group_code text NOT NULL REFERENCES group_feed.groups (code) ON UPDATE CASCADE,
  name       text CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 40), -- the name others see; NULL until picked
  paused_at  timestamptz,                                    -- may read, may not post, comment or like
  joined_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_feed.guides (
  key_hash   text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'), -- SHA-256 of the guide key; the key itself is never stored
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_feed.posts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_code  text REFERENCES group_feed.groups (code) ON UPDATE CASCADE, -- NULL: an announcement for every group
  tab         text NOT NULL CHECK (tab IN ('feed', 'news')),
  kind        text NOT NULL CHECK (kind IN ('post', 'homework', 'reminder', 'announcement')),
  student_id  text,                                          -- NULL: written by the guide
  guide_name  text,
  body        text NOT NULL CHECK (length(body) <= 5000),
  due_on      date,                                          -- homework only
  pictures    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(pictures) <= 4),
  comments_on boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  hidden_at   timestamptz,                                   -- hidden by the guide; can be brought back
  deleted_at  timestamptz,
  CHECK ((student_id IS NULL) <> (guide_name IS NULL)),
  CHECK (student_id IS NULL OR (tab = 'feed' AND kind = 'post' AND group_code IS NOT NULL)),
  CHECK (tab = 'news' OR kind = 'post'),
  CHECK (deleted_at IS NOT NULL OR length(btrim(body)) > 0 OR cardinality(pictures) > 0)
);
CREATE INDEX IF NOT EXISTS posts_group_tab ON group_feed.posts (group_code, tab, id DESC);

CREATE TABLE IF NOT EXISTS group_feed.comments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id    bigint NOT NULL REFERENCES group_feed.posts (id) ON DELETE CASCADE,
  student_id text,
  guide_name text,
  body       text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  hidden_at  timestamptz,
  deleted_at timestamptz,
  reply_to   bigint REFERENCES group_feed.comments (id) ON DELETE CASCADE, -- a reply sits under this comment (one level)
  CHECK ((student_id IS NULL) <> (guide_name IS NULL))
);
-- Replies (2026-11-22, the owner's wish): a reply tucked under the comment it answers. Added to a live table here.
ALTER TABLE group_feed.comments ADD COLUMN IF NOT EXISTS reply_to bigint REFERENCES group_feed.comments (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS comments_post ON group_feed.comments (post_id, id);

CREATE TABLE IF NOT EXISTS group_feed.likes (
  post_id    bigint NOT NULL REFERENCES group_feed.posts (id) ON DELETE CASCADE,
  liker      text NOT NULL,                                 -- a student id, or 'guide'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, liker)
);

CREATE TABLE IF NOT EXISTS group_feed.done (                -- homework ticked done: seen by the student and the guide only
  post_id    bigint NOT NULL REFERENCES group_feed.posts (id) ON DELETE CASCADE,
  student_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, student_id)
);

CREATE TABLE IF NOT EXISTS group_feed.flags (               -- "Let Daniel know": seen by the guide only
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     bigint NOT NULL REFERENCES group_feed.posts (id) ON DELETE CASCADE,
  comment_id  bigint REFERENCES group_feed.comments (id) ON DELETE CASCADE,
  student_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS flags_once ON group_feed.flags (post_id, coalesce(comment_id, 0), student_id);

CREATE TABLE IF NOT EXISTS group_feed.pictures (
  path        text PRIMARY KEY CHECK (path ~ '^[A-Z0-9-]{2,20}/[A-Za-z0-9_-]{22}\.jpg$'), -- or ALL/... for every group
  uploader    text NOT NULL,                                 -- a student id, or 'guide'
  bytes       integer NOT NULL CHECK (bytes BETWEEN 1 AND 450000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['groups','members','guides','posts','comments','likes','done','flags','pictures'] LOOP
    EXECUTE format('ALTER TABLE group_feed.%I ENABLE ROW LEVEL SECURITY', t); -- no policies: only the function's owner role gets in
  END LOOP;
END $$;

-- ---------- who is asking ----------
-- From a key's SHA-256: the guide, or an active student with a group. NULL: neither (a wrong or switched-off key,
-- or a student who is not in a group yet).
CREATE OR REPLACE FUNCTION group_feed.who(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE g group_feed.guides%ROWTYPE; s text; m group_feed.members%ROWTYPE; gr group_feed.groups%ROWTYPE;
BEGIN
  SELECT * INTO g FROM group_feed.guides WHERE key_hash = p_key_hash;
  IF FOUND THEN RETURN jsonb_build_object('guide', true, 'name', g.name); END IF;
  SELECT id INTO s FROM library.students WHERE key_hash = p_key_hash AND active;
  IF s IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM group_feed.members WHERE student_id = s;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO gr FROM group_feed.groups WHERE code = m.group_code;
  RETURN jsonb_build_object('guide', false, 'student', s, 'group', m.group_code, 'group_title', gr.title,
    'closed', gr.closed_at IS NOT NULL, 'name', m.name, 'paused', m.paused_at IS NOT NULL);
END $$;

-- A student may write (post, comment, like): has a name, isn't paused, the group isn't closed.
CREATE OR REPLACE FUNCTION group_feed.may_write(w jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN w IS NULL THEN 'nokey'
    WHEN (w->>'guide')::boolean THEN NULL
    WHEN (w->>'paused')::boolean THEN 'paused'
    WHEN (w->>'closed')::boolean THEN 'closed'
    WHEN w->>'name' IS NULL THEN 'noname'
    ELSE NULL END $$;

-- The post if the asker may see it (their group's or every group's, not deleted; hidden ones only for the guide).
CREATE OR REPLACE FUNCTION group_feed.visible_post(w jsonb, p_id bigint) RETURNS group_feed.posts
LANGUAGE sql STABLE AS $$
  SELECT p.* FROM group_feed.posts p WHERE p.id = p_id AND p.deleted_at IS NULL AND w IS NOT NULL
    AND ((w->>'guide')::boolean OR (p.hidden_at IS NULL AND (p.group_code IS NULL OR p.group_code = w->>'group'))) $$;

CREATE OR REPLACE FUNCTION group_feed.author_name(p_student text, p_guide text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(p_guide, (SELECT name FROM group_feed.members WHERE student_id = p_student), 'A student') $$;

-- ---------- reading ----------
-- One page of a tab, newest first, with comments, like counts and the asker's own likes, ticks and flags.
-- p_group is only used for the guide (a student always gets their own group). p_before: the oldest id already shown.
CREATE OR REPLACE FUNCTION group_feed.read(p_key_hash text, p_tab text, p_group text, p_before bigint, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); is_guide boolean; me text; grp text; lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  IF p_tab NOT IN ('feed', 'news') THEN RETURN jsonb_build_object('error', 'bad'); END IF;
  is_guide := (w->>'guide')::boolean;
  me := CASE WHEN is_guide THEN 'guide' ELSE w->>'student' END;
  grp := CASE WHEN is_guide THEN p_group ELSE w->>'group' END;           -- guide: NULL or 'ALL' = every group
  IF grp = 'ALL' THEN grp := NULL; END IF;
  RETURN jsonb_build_object('me', w - 'student', 'posts', coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'id')::bigint DESC) FROM (
      SELECT jsonb_build_object(
        'id', p.id, 'group', p.group_code, 'tab', p.tab, 'kind', p.kind, 'body', p.body, 'due_on', p.due_on,
        'pictures', to_jsonb(p.pictures), 'comments_on', p.comments_on, 'created_at', p.created_at, 'edited_at', p.edited_at,
        'hidden', p.hidden_at IS NOT NULL,
        'author', group_feed.author_name(p.student_id, p.guide_name), 'by_guide', p.student_id IS NULL,
        'student', CASE WHEN is_guide THEN p.student_id END,                -- the guide's, to pause someone from their post
        'mine', CASE WHEN is_guide THEN p.student_id IS NULL ELSE p.student_id = me END,
        'likes', (SELECT count(*) FROM group_feed.likes l WHERE l.post_id = p.id),
        'liked', EXISTS (SELECT 1 FROM group_feed.likes l WHERE l.post_id = p.id AND l.liker = me),
        'done', CASE WHEN p.kind <> 'homework' THEN NULL WHEN is_guide THEN to_jsonb((SELECT count(*) FROM group_feed.done d WHERE d.post_id = p.id))
                     ELSE to_jsonb(EXISTS (SELECT 1 FROM group_feed.done d WHERE d.post_id = p.id AND d.student_id = me)) END,
        'flagged', CASE WHEN is_guide THEN (SELECT count(*) FROM group_feed.flags f WHERE f.post_id = p.id AND f.comment_id IS NULL AND f.resolved_at IS NULL)
                        ELSE EXISTS (SELECT 1 FROM group_feed.flags f WHERE f.post_id = p.id AND f.comment_id IS NULL AND f.student_id = me)::int END,
        'comments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'created_at', c.created_at,
            'edited_at', c.edited_at, 'hidden', c.hidden_at IS NOT NULL, 'reply_to', c.reply_to, 'author', group_feed.author_name(c.student_id, c.guide_name),
            'by_guide', c.student_id IS NULL, 'student', CASE WHEN is_guide THEN c.student_id END, 'mine', CASE WHEN is_guide THEN c.student_id IS NULL ELSE c.student_id = me END) ORDER BY c.id)
          FROM group_feed.comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND (is_guide OR c.hidden_at IS NULL)), '[]'::jsonb)
      ) x
      FROM group_feed.posts p
      WHERE p.tab = p_tab AND p.deleted_at IS NULL AND (is_guide OR p.hidden_at IS NULL)
        AND (CASE WHEN is_guide AND grp IS NULL THEN true
                  WHEN p_tab = 'news' THEN p.group_code IS NULL OR p.group_code = grp
                  ELSE p.group_code = grp END)
        AND (p_before IS NULL OR p.id < p_before)
      ORDER BY p.id DESC LIMIT lim) q), '[]'::jsonb));
END $$;

-- The newest post id in each tab, for the "new" counts (the app remembers what it has shown).
CREATE OR REPLACE FUNCTION group_feed.latest(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash);
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  IF (w->>'guide')::boolean THEN
    RETURN jsonb_build_object('me', w, 'flags', (SELECT count(*) FROM group_feed.flags WHERE resolved_at IS NULL));
  END IF;
  RETURN jsonb_build_object('me', w - 'student',
    'feed', (SELECT max(id) FROM group_feed.posts WHERE tab = 'feed' AND group_code = w->>'group' AND deleted_at IS NULL AND hidden_at IS NULL),
    'news', (SELECT max(id) FROM group_feed.posts WHERE tab = 'news' AND (group_code IS NULL OR group_code = w->>'group') AND deleted_at IS NULL AND hidden_at IS NULL),
    'feed_new_ids', (SELECT coalesce(jsonb_agg(id), '[]') FROM (SELECT id FROM group_feed.posts WHERE tab = 'feed' AND group_code = w->>'group' AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC LIMIT 50) a),
    'news_new_ids', (SELECT coalesce(jsonb_agg(id), '[]') FROM (SELECT id FROM group_feed.posts WHERE tab = 'news' AND (group_code IS NULL OR group_code = w->>'group') AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC LIMIT 50) a));
END $$;

-- A picture's path if the asker may see it (it belongs to a post they can see, or they uploaded it).
CREATE OR REPLACE FUNCTION group_feed.picture_ok(p_key_hash text, p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash);
BEGIN
  IF w IS NULL THEN RETURN false; END IF;
  IF (w->>'guide')::boolean THEN RETURN EXISTS (SELECT 1 FROM group_feed.pictures WHERE path = p_path); END IF;
  RETURN EXISTS (SELECT 1 FROM group_feed.pictures WHERE path = p_path AND uploader = w->>'student')
    OR EXISTS (SELECT 1 FROM group_feed.posts p WHERE p_path = ANY (p.pictures) AND p.deleted_at IS NULL AND p.hidden_at IS NULL
               AND (p.group_code IS NULL OR p.group_code = w->>'group'));
END $$;

-- ---------- writing ----------
-- Room for one more picture: returns {path} to upload to, or {error}. The function uploads, then calls picture_kept.
CREATE OR REPLACE FUNCTION group_feed.picture_slot(p_key_hash text, p_name text, p_group text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); who text; grp text;
BEGIN
  IF why IS NOT NULL THEN RETURN jsonb_build_object('error', why); END IF;
  IF p_name !~ '^[A-Za-z0-9_-]{22}$' THEN RETURN jsonb_build_object('error', 'bad'); END IF;
  who := CASE WHEN (w->>'guide')::boolean THEN 'guide' ELSE w->>'student' END;
  grp := CASE WHEN (w->>'guide')::boolean THEN coalesce(nullif(p_group, ''), 'ALL') ELSE w->>'group' END;
  IF who <> 'guide' AND (SELECT count(*) FROM group_feed.pictures WHERE uploader = who AND created_at > now() - interval '1 day') >= 40 THEN
    RETURN jsonb_build_object('error', 'toomany'); END IF;
  RETURN jsonb_build_object('path', grp || '/' || p_name || '.jpg');
END $$;

CREATE OR REPLACE FUNCTION group_feed.picture_kept(p_key_hash text, p_path text, p_bytes integer) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash);
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  INSERT INTO group_feed.pictures (path, uploader, bytes)
    VALUES (p_path, CASE WHEN (w->>'guide')::boolean THEN 'guide' ELSE w->>'student' END, p_bytes);
  RETURN jsonb_build_object('path', p_path);
END $$;

-- Pictures a post may carry: the asker's own uploads, not already on another post.
CREATE OR REPLACE FUNCTION group_feed.own_pictures(w jsonb, p_pictures text[], p_post bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT cardinality(coalesce(p_pictures, '{}')) <= 4 AND NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p_pictures, '{}')) x
    WHERE NOT EXISTS (SELECT 1 FROM group_feed.pictures pic WHERE pic.path = x
                      AND pic.uploader = CASE WHEN (w->>'guide')::boolean THEN 'guide' ELSE w->>'student' END)
       OR EXISTS (SELECT 1 FROM group_feed.posts p WHERE x = ANY (p.pictures) AND p.id IS DISTINCT FROM p_post)) $$;

-- A new post. Students: Feed tab only, their own group. Guide: any tab and kind, one group or every group (p_group NULL/'ALL').
CREATE OR REPLACE FUNCTION group_feed.post(p_key_hash text, p_tab text, p_kind text, p_group text, p_body text,
  p_pictures text[], p_due_on date, p_comments_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); new_id bigint; grp text;
BEGIN
  IF why IS NOT NULL THEN RETURN jsonb_build_object('error', why); END IF;
  IF NOT group_feed.own_pictures(w, p_pictures, NULL) THEN RETURN jsonb_build_object('error', 'pictures'); END IF;
  IF (w->>'guide')::boolean THEN
    grp := nullif(nullif(p_group, ''), 'ALL');
    IF p_tab = 'feed' AND grp IS NULL THEN RETURN jsonb_build_object('error', 'group'); END IF;
    IF grp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM group_feed.groups WHERE code = grp) THEN RETURN jsonb_build_object('error', 'group'); END IF;
    INSERT INTO group_feed.posts (group_code, tab, kind, guide_name, body, pictures, due_on, comments_on)
      VALUES (grp, p_tab, CASE WHEN p_tab = 'feed' THEN 'post' ELSE coalesce(p_kind, 'announcement') END, w->>'name',
              coalesce(p_body, ''), coalesce(p_pictures, '{}'), CASE WHEN p_kind = 'homework' THEN p_due_on END, coalesce(p_comments_on, true))
      RETURNING id INTO new_id;
  ELSE
    IF p_tab <> 'feed' THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
    IF (SELECT count(*) FROM group_feed.posts WHERE student_id = w->>'student' AND created_at > now() - interval '1 day') >= 20 THEN
      RETURN jsonb_build_object('error', 'toomany'); END IF;
    INSERT INTO group_feed.posts (group_code, tab, kind, student_id, body, pictures)
      VALUES (w->>'group', 'feed', 'post', w->>'student', coalesce(p_body, ''), coalesce(p_pictures, '{}'))
      RETURNING id INTO new_id;
  END IF;
  RETURN jsonb_build_object('id', new_id);
EXCEPTION WHEN check_violation OR invalid_text_representation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- Edit one's own post (words and pictures; the guide also the due date and comments switch).
CREATE OR REPLACE FUNCTION group_feed.edit_post(p_key_hash text, p_id bigint, p_body text, p_pictures text[], p_due_on date, p_comments_on boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); p group_feed.posts;
BEGIN
  IF why IS NOT NULL THEN RETURN jsonb_build_object('error', why); END IF;
  p := group_feed.visible_post(w, p_id);
  IF p.id IS NULL OR NOT (CASE WHEN (w->>'guide')::boolean THEN p.student_id IS NULL ELSE p.student_id = w->>'student' END) THEN
    RETURN jsonb_build_object('error', 'notyours'); END IF;
  IF NOT group_feed.own_pictures(w, p_pictures, p.id) THEN RETURN jsonb_build_object('error', 'pictures'); END IF;
  UPDATE group_feed.posts SET body = coalesce(p_body, ''), pictures = coalesce(p_pictures, '{}'), edited_at = now(),
    due_on = CASE WHEN (w->>'guide')::boolean AND kind = 'homework' THEN p_due_on ELSE due_on END,
    comments_on = CASE WHEN (w->>'guide')::boolean THEN coalesce(p_comments_on, comments_on) ELSE comments_on END
    WHERE id = p.id;
  RETURN jsonb_build_object('id', p.id);
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- Delete: a student their own post; the guide any post. Returns the pictures to remove from storage.
CREATE OR REPLACE FUNCTION group_feed.delete_post(p_key_hash text, p_id bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); p group_feed.posts;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  p := group_feed.visible_post(w, p_id);
  IF p.id IS NULL OR NOT ((w->>'guide')::boolean OR p.student_id = w->>'student') THEN RETURN jsonb_build_object('error', 'notyours'); END IF;
  UPDATE group_feed.posts SET deleted_at = now(), body = '', pictures = '{}' WHERE id = p.id;
  DELETE FROM group_feed.pictures WHERE path = ANY (p.pictures);
  RETURN jsonb_build_object('deleted', p.id, 'pictures', to_jsonb(p.pictures));
END $$;

-- A comment, or (p_reply_to) a reply under a comment on the same post. A reply to a reply goes under the same first
-- comment, so a thread is one level deep.
DROP FUNCTION IF EXISTS group_feed.comment(text, bigint, text);
CREATE OR REPLACE FUNCTION group_feed.comment(p_key_hash text, p_post bigint, p_body text, p_reply_to bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); p group_feed.posts; new_id bigint; parent group_feed.comments;
BEGIN
  IF why IS NOT NULL THEN RETURN jsonb_build_object('error', why); END IF;
  p := group_feed.visible_post(w, p_post);
  IF p.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF NOT p.comments_on AND NOT (w->>'guide')::boolean THEN RETURN jsonb_build_object('error', 'nocomments'); END IF;
  IF NOT (w->>'guide')::boolean AND (SELECT count(*) FROM group_feed.comments WHERE student_id = w->>'student' AND created_at > now() - interval '1 day') >= 100 THEN
    RETURN jsonb_build_object('error', 'toomany'); END IF;
  IF p_reply_to IS NOT NULL THEN
    SELECT * INTO parent FROM group_feed.comments WHERE id = p_reply_to AND post_id = p.id AND deleted_at IS NULL
      AND ((w->>'guide')::boolean OR hidden_at IS NULL);
    IF parent.id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  END IF;
  INSERT INTO group_feed.comments (post_id, student_id, guide_name, body, reply_to)
    VALUES (p.id, CASE WHEN (w->>'guide')::boolean THEN NULL ELSE w->>'student' END,
            CASE WHEN (w->>'guide')::boolean THEN w->>'name' END, p_body, coalesce(parent.reply_to, parent.id))
    RETURNING id INTO new_id;
  RETURN jsonb_build_object('id', new_id);
EXCEPTION WHEN check_violation OR not_null_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

CREATE OR REPLACE FUNCTION group_feed.edit_comment(p_key_hash text, p_id bigint, p_body text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); c group_feed.comments;
BEGIN
  IF why IS NOT NULL THEN RETURN jsonb_build_object('error', why); END IF;
  SELECT * INTO c FROM group_feed.comments WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL OR (group_feed.visible_post(w, c.post_id)).id IS NULL
     OR NOT (CASE WHEN (w->>'guide')::boolean THEN c.student_id IS NULL ELSE c.student_id = w->>'student' END) THEN
    RETURN jsonb_build_object('error', 'notyours'); END IF;
  UPDATE group_feed.comments SET body = p_body, edited_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('id', c.id);
EXCEPTION WHEN check_violation OR not_null_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

CREATE OR REPLACE FUNCTION group_feed.delete_comment(p_key_hash text, p_id bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); c group_feed.comments;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  SELECT * INTO c FROM group_feed.comments WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL OR (group_feed.visible_post(w, c.post_id)).id IS NULL
     OR NOT ((w->>'guide')::boolean OR c.student_id = w->>'student') THEN RETURN jsonb_build_object('error', 'notyours'); END IF;
  UPDATE group_feed.comments SET deleted_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('deleted', c.id);
END $$;

-- Like or unlike (p_on), tick homework done or not.
CREATE OR REPLACE FUNCTION group_feed.like(p_key_hash text, p_post bigint, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); why text := group_feed.may_write(w); me text;
BEGIN
  IF why IS NOT NULL AND why <> 'noname' THEN RETURN jsonb_build_object('error', why); END IF;
  IF (group_feed.visible_post(w, p_post)).id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  me := CASE WHEN (w->>'guide')::boolean THEN 'guide' ELSE w->>'student' END;
  IF p_on THEN INSERT INTO group_feed.likes (post_id, liker) VALUES (p_post, me) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM group_feed.likes WHERE post_id = p_post AND liker = me; END IF;
  RETURN jsonb_build_object('likes', (SELECT count(*) FROM group_feed.likes WHERE post_id = p_post), 'liked', p_on);
END $$;

CREATE OR REPLACE FUNCTION group_feed.mark_done(p_key_hash text, p_post bigint, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); p group_feed.posts;
BEGIN
  IF w IS NULL OR (w->>'guide')::boolean THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  p := group_feed.visible_post(w, p_post);
  IF p.id IS NULL OR p.kind <> 'homework' THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF p_on THEN INSERT INTO group_feed.done (post_id, student_id) VALUES (p.id, w->>'student') ON CONFLICT DO NOTHING;
  ELSE DELETE FROM group_feed.done WHERE post_id = p.id AND student_id = w->>'student'; END IF;
  RETURN jsonb_build_object('done', p_on);
END $$;

-- "Let Daniel know" about a post, or one comment on it.
CREATE OR REPLACE FUNCTION group_feed.flag(p_key_hash text, p_post bigint, p_comment bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash);
BEGIN
  IF w IS NULL OR (w->>'guide')::boolean THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  IF (group_feed.visible_post(w, p_post)).id IS NULL THEN RETURN jsonb_build_object('error', 'gone'); END IF;
  IF p_comment IS NOT NULL AND NOT EXISTS (SELECT 1 FROM group_feed.comments WHERE id = p_comment AND post_id = p_post) THEN
    RETURN jsonb_build_object('error', 'gone'); END IF;
  INSERT INTO group_feed.flags (post_id, comment_id, student_id) VALUES (p_post, p_comment, w->>'student') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('flagged', true);
END $$;

-- The student picks the name others see.
CREATE OR REPLACE FUNCTION group_feed.set_name(p_key_hash text, p_name text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE w jsonb := group_feed.who(p_key_hash);
BEGIN
  IF w IS NULL OR (w->>'guide')::boolean THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  UPDATE group_feed.members SET name = btrim(p_name) WHERE student_id = w->>'student';
  RETURN jsonb_build_object('name', btrim(p_name));
EXCEPTION WHEN check_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

-- ---------- the guide only ----------
CREATE OR REPLACE FUNCTION group_feed.is_guide(p_key_hash text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM group_feed.guides WHERE key_hash = p_key_hash) $$;

-- Hide or bring back a post or a comment (p_what 'post' | 'comment'); resolves its flags.
CREATE OR REPLACE FUNCTION group_feed.hide(p_key_hash text, p_what text, p_id bigint, p_on boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  IF p_what = 'post' THEN
    UPDATE group_feed.posts SET hidden_at = CASE WHEN p_on THEN now() END WHERE id = p_id;
    UPDATE group_feed.flags SET resolved_at = now() WHERE post_id = p_id AND comment_id IS NULL AND resolved_at IS NULL;
  ELSE
    UPDATE group_feed.comments SET hidden_at = CASE WHEN p_on THEN now() END WHERE id = p_id;
    UPDATE group_feed.flags SET resolved_at = now() WHERE comment_id = p_id AND resolved_at IS NULL;
  END IF;
  RETURN jsonb_build_object('hidden', p_on);
END $$;

-- What is flagged and not dealt with yet, newest first.
CREATE OR REPLACE FUNCTION group_feed.flags_open(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  RETURN jsonb_build_object('flags', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (
    SELECT jsonb_build_object('post_id', f.post_id, 'comment_id', f.comment_id, 'group', p.group_code,
      'author', CASE WHEN f.comment_id IS NULL THEN group_feed.author_name(p.student_id, p.guide_name)
                     ELSE group_feed.author_name(c.student_id, c.guide_name) END,
      'student_id', CASE WHEN f.comment_id IS NULL THEN p.student_id ELSE c.student_id END,
      'body', left(CASE WHEN f.comment_id IS NULL THEN p.body ELSE c.body END, 400),
      'count', count(*), 'at', max(f.created_at)) x
    FROM group_feed.flags f JOIN group_feed.posts p ON p.id = f.post_id LEFT JOIN group_feed.comments c ON c.id = f.comment_id
    WHERE f.resolved_at IS NULL AND p.deleted_at IS NULL
    GROUP BY f.post_id, f.comment_id, p.group_code, p.student_id, p.guide_name, p.body, c.student_id, c.guide_name, c.body) q), '[]'::jsonb));
END $$;

-- "It's fine": the flags on a post or comment are dealt with.
CREATE OR REPLACE FUNCTION group_feed.flags_clear(p_key_hash text, p_post bigint, p_comment bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  UPDATE group_feed.flags SET resolved_at = now() WHERE post_id = p_post AND comment_id IS NOT DISTINCT FROM p_comment AND resolved_at IS NULL;
  RETURN jsonb_build_object('cleared', true);
END $$;

-- The groups and their members (codes and the names they picked), with who ticked which homework.
CREATE OR REPLACE FUNCTION group_feed.groups_list(p_key_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  RETURN jsonb_build_object('groups', coalesce((SELECT jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title,
    'closed', g.closed_at IS NOT NULL, 'members', coalesce((SELECT jsonb_agg(jsonb_build_object('student_id', m.student_id,
      'name', m.name, 'paused', m.paused_at IS NOT NULL, 'key_on', coalesce((SELECT s.active FROM library.students s WHERE s.id = m.student_id), false),
      'done', coalesce((SELECT jsonb_agg(d.post_id) FROM group_feed.done d WHERE d.student_id = m.student_id), '[]'::jsonb)) ORDER BY m.joined_at)
      FROM group_feed.members m WHERE m.group_code = g.code), '[]'::jsonb)) ORDER BY g.created_at)
    FROM group_feed.groups g), '[]'::jsonb));
END $$;

-- Pause or un-pause a student; set their name; move them to a group; open or close a group; make a group.
CREATE OR REPLACE FUNCTION group_feed.manage(p_key_hash text, p_action text, p_student text, p_value text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT group_feed.is_guide(p_key_hash) THEN RETURN jsonb_build_object('error', 'guideonly'); END IF;
  CASE p_action
    WHEN 'pause'   THEN UPDATE group_feed.members SET paused_at = now() WHERE student_id = p_student;
    WHEN 'unpause' THEN UPDATE group_feed.members SET paused_at = NULL WHERE student_id = p_student;
    WHEN 'name'    THEN UPDATE group_feed.members SET name = nullif(btrim(p_value), '') WHERE student_id = p_student;
    WHEN 'move'    THEN
      IF NOT EXISTS (SELECT 1 FROM library.students WHERE id = p_student) THEN RETURN jsonb_build_object('error', 'nostudent'); END IF;
      INSERT INTO group_feed.members (student_id, group_code) VALUES (p_student, p_value)
        ON CONFLICT (student_id) DO UPDATE SET group_code = excluded.group_code;
    WHEN 'leave'   THEN DELETE FROM group_feed.members WHERE student_id = p_student;
    WHEN 'close'   THEN UPDATE group_feed.groups SET closed_at = now() WHERE code = p_value;
    WHEN 'open'    THEN UPDATE group_feed.groups SET closed_at = NULL WHERE code = p_value;
    WHEN 'new_group' THEN INSERT INTO group_feed.groups (code, title) VALUES (upper(p_student), p_value);
    ELSE RETURN jsonb_build_object('error', 'bad');
  END CASE;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation OR not_null_violation THEN RETURN jsonb_build_object('error', 'bad');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_feed FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA group_feed FROM anon, authenticated';
  END IF;
END $$;
