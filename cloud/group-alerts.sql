-- Alerts (2026-11-22, the owner's wish): what is new for the person asking since a given moment, so their app can show
-- a Mac or Windows alert (and later the phone). Run after group-feed.sql and tell-daniel.sql. Safe to run again.
--
-- group_feed.alerts(key_hash, since) returns { now, items: [...] }, newest first, at most 30. The app keeps `now` and
-- asks again with it next time. Each item has a kind:
--   a student:  news    a new announcement, homework or reminder from Daniel
--               feed    a new post in their Circle by someone else
--               reply   a comment on their post, or a reply in a conversation they are part of (not their own)
--               due     homework due in the next two days that they have not ticked done (whatever `since` is; the app
--                       decides when to say it, and says it once)
--               answer  Daniel marked something they told him as dealt with (never Daniel's own note)
--   the guide:  report  a new Tell Daniel report
--               flag    a student let Daniel know about a post or comment
--               reply   a student commented on one of Daniel's posts
-- Words are cut to 160 characters: enough for an alert, the rest is read in the app.

CREATE OR REPLACE FUNCTION group_feed.alerts(p_key_hash text, p_since timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE w jsonb := group_feed.who(p_key_hash); me text; grp text; since timestamptz; items jsonb;
BEGIN
  IF w IS NULL THEN RETURN jsonb_build_object('error', 'nokey'); END IF;
  since := greatest(coalesce(p_since, now()), now() - interval '7 days');  -- never more than a week back
  IF (w->>'guide')::boolean THEN
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at') DESC), '[]') INTO items FROM (
      SELECT x FROM (
        SELECT jsonb_build_object('kind', 'report', 'report', r.id, 'report_kind', r.kind, 'place', r.place,
          'author', coalesce((SELECT name FROM group_feed.members WHERE student_id = r.student_id), 'A student'),
          'text', left(r.why, 160), 'at', r.created_at) x
          FROM tell_daniel.reports r WHERE r.created_at > since
        UNION ALL
        SELECT jsonb_build_object('kind', 'flag', 'post', f.post_id, 'comment', f.comment_id, 'tab', p.tab, 'group', p.group_code,
          'author', CASE WHEN f.comment_id IS NULL THEN group_feed.author_name(p.student_id, p.guide_name)
                         ELSE group_feed.author_name(c.student_id, c.guide_name) END,
          'text', left(CASE WHEN f.comment_id IS NULL THEN p.body ELSE c.body END, 160), 'at', f.created_at)
          FROM group_feed.flags f JOIN group_feed.posts p ON p.id = f.post_id LEFT JOIN group_feed.comments c ON c.id = f.comment_id
          WHERE f.created_at > since AND f.resolved_at IS NULL AND p.deleted_at IS NULL
        UNION ALL
        SELECT jsonb_build_object('kind', 'reply', 'post', p.id, 'comment', c.id, 'tab', p.tab, 'group', p.group_code,
          'author', group_feed.author_name(c.student_id, c.guide_name), 'text', left(c.body, 160), 'at', c.created_at)
          FROM group_feed.comments c JOIN group_feed.posts p ON p.id = c.post_id
          WHERE c.created_at > since AND c.student_id IS NOT NULL AND p.student_id IS NULL
            AND c.deleted_at IS NULL AND p.deleted_at IS NULL
      ) a ORDER BY (x->>'at') DESC LIMIT 30) b;
    RETURN jsonb_build_object('now', now(), 'items', items);
  END IF;

  me := w->>'student'; grp := w->>'group';
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'at') DESC), '[]') INTO items FROM (
    SELECT x FROM (
      SELECT jsonb_build_object('kind', CASE WHEN p.tab = 'news' THEN 'news' ELSE 'feed' END, 'post', p.id, 'tab', p.tab,
        'post_kind', p.kind, 'due_on', p.due_on, 'author', group_feed.author_name(p.student_id, p.guide_name),
        'text', left(p.body, 160), 'pictures', cardinality(p.pictures), 'at', p.created_at) x
        FROM group_feed.posts p
        WHERE p.created_at > since AND p.deleted_at IS NULL AND p.hidden_at IS NULL
          AND ((p.tab = 'news' AND (p.group_code IS NULL OR p.group_code = grp))
            OR (p.tab = 'feed' AND p.group_code = grp AND p.student_id IS DISTINCT FROM me))
      UNION ALL
      SELECT jsonb_build_object('kind', 'reply', 'post', p.id, 'comment', c.id, 'tab', p.tab,
        'author', group_feed.author_name(c.student_id, c.guide_name), 'text', left(c.body, 160), 'at', c.created_at,
        'on_mine', p.student_id = me)
        FROM group_feed.comments c JOIN group_feed.posts p ON p.id = c.post_id
        WHERE c.created_at > since AND c.deleted_at IS NULL AND c.hidden_at IS NULL
          AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND (p.group_code IS NULL OR p.group_code = grp)
          AND c.student_id IS DISTINCT FROM me
          AND (p.student_id = me
            OR (c.reply_to IS NOT NULL AND EXISTS (SELECT 1 FROM group_feed.comments m WHERE m.student_id = me AND m.deleted_at IS NULL
                  AND (m.id = c.reply_to OR m.reply_to = c.reply_to)))) -- the thread's first comment is theirs, or they replied in it
      UNION ALL
      SELECT jsonb_build_object('kind', 'due', 'post', p.id, 'tab', 'news', 'post_kind', p.kind, 'due_on', p.due_on,
        'author', group_feed.author_name(p.student_id, p.guide_name), 'text', left(p.body, 160), 'at', p.created_at)
        FROM group_feed.posts p
        WHERE p.kind = 'homework' AND p.tab = 'news' AND p.deleted_at IS NULL AND p.hidden_at IS NULL
          AND (p.group_code IS NULL OR p.group_code = grp)
          AND p.due_on BETWEEN current_date - 1 AND current_date + 2
          AND NOT EXISTS (SELECT 1 FROM group_feed.done d WHERE d.post_id = p.id AND d.student_id = me)
      UNION ALL
      SELECT jsonb_build_object('kind', 'answer', 'report', r.id, 'report_kind', r.kind, 'place', r.place,
        'text', left(r.why, 160), 'at', r.status_at)
        FROM tell_daniel.reports r WHERE r.student_id = me AND r.status = 'done' AND r.status_at > since
    ) a ORDER BY (x->>'at') DESC LIMIT 30) b;
  RETURN jsonb_build_object('now', now(), 'items', items);
END $$;

REVOKE ALL ON FUNCTION group_feed.alerts(text, timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION group_feed.alerts(text, timestamptz) FROM anon, authenticated';
  END IF;
END $$;
