// A stand-in for the Sovran cloud's group-feed function (cloud/group-feed/index.ts), for the tests and the demo.
// It keeps one group in memory and follows the same main rules: only keys it knows, students post to the Circle only,
// a name before posting, your own posts to change. The real rules are checked against Postgres in cloud/group-feed.test.sql.

export function fakeGroupCloud({ students = {}, group = 'SQ01', title = 'Sovran Quest', posts = [] } = {}) {
  // students: { <library key>: { id, name } }
  const state = { posts: posts.map((p) => ({ comments: [], likes: [], done: [], flags: [], pictures: [], comments_on: true, ...p })), pictures: new Map(), nextId: 100, asked: [] };
  const who = (auth) => students[String(auth ?? '').replace(/^Bearer /, '')];
  const view = (p, me) => ({
    id: p.id, group, tab: p.tab, kind: p.kind, body: p.body, due_on: p.due_on ?? null, pictures: p.pictures, comments_on: p.comments_on,
    created_at: p.created_at, edited_at: p.edited_at ?? null, hidden: false, author: p.student ? (Object.values(students).find((s) => s.id === p.student)?.name ?? 'A student') : 'Daniel',
    by_guide: !p.student, mine: p.student === me.id, likes: p.likes.length, liked: p.likes.includes(me.id),
    done: p.kind === 'homework' ? p.done.includes(me.id) : null, flagged: p.flags.includes(me.id) ? 1 : 0,
    comments: p.comments.filter((c) => !c.deleted).map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, edited_at: null, hidden: false,
      author: c.student ? (Object.values(students).find((s) => s.id === c.student)?.name ?? 'A student') : 'Daniel', by_guide: !c.student, mine: c.student === me.id })),
  });
  const live = (tab) => state.posts.filter((p) => p.tab === tab && !p.deleted).sort((a, b) => b.id - a.id);
  const meOf = (s) => ({ guide: false, group, group_title: title, closed: false, name: s.name ?? null, paused: false });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const err = (code, status = 400) => json(status, { error: `fake: ${code}`, code });

  async function fetcher(url, init = {}) {
    const auth = init.headers?.authorization;
    const s = who(auth);
    const pic = String(url).match(/\/picture\/(.+)$/);
    if (pic) return s && state.pictures.has(pic[1]) ? new Response(state.pictures.get(pic[1])) : new Response('', { status: 404 });
    const msg = JSON.parse(init.body);
    state.asked.push(msg);
    if (!s) return err('nokey', 401);
    const post = (id) => state.posts.find((p) => p.id === id && !p.deleted);
    switch (msg.action) {
      case 'latest': return json(200, { me: meOf(s), feed_new_ids: live('feed').map((p) => p.id), news_new_ids: live('news').map((p) => p.id) });
      case 'read': {
        const list = live(msg.tab).filter((p) => !msg.before || p.id < msg.before).slice(0, msg.limit ?? 20);
        return json(200, { me: meOf(s), posts: list.map((p) => view(p, s)) });
      }
      case 'set_name': s.name = msg.name; return json(200, { name: msg.name });
      case 'post': {
        if (!s.name) return err('noname', 409);
        if (msg.tab !== 'feed') return err('guideonly', 403);
        const p = { id: ++state.nextId, tab: 'feed', kind: 'post', student: s.id, body: msg.body, pictures: msg.pictures ?? [], created_at: new Date().toISOString(),
          comments: [], likes: [], done: [], flags: [], comments_on: true };
        state.posts.push(p);
        return json(200, { id: p.id });
      }
      case 'edit_post': { const p = post(msg.id); if (!p || p.student !== s.id) return err('notyours', 403); Object.assign(p, { body: msg.body, pictures: msg.pictures, edited_at: new Date().toISOString() }); return json(200, { id: p.id }); }
      case 'delete_post': { const p = post(msg.id); if (!p || p.student !== s.id) return err('notyours', 403); p.deleted = true; return json(200, { deleted: p.id }); }
      case 'comment': { const p = post(msg.post); if (!p) return err('gone', 404); const c = { id: ++state.nextId, student: s.id, body: msg.body, created_at: new Date().toISOString() }; p.comments.push(c); return json(200, { id: c.id }); }
      case 'delete_comment': { for (const p of state.posts) for (const c of p.comments) if (c.id === msg.id && c.student === s.id) { c.deleted = true; return json(200, { deleted: c.id }); } return err('notyours', 403); }
      case 'like': { const p = post(msg.post); if (!p) return err('gone', 404); p.likes = p.likes.filter((x) => x !== s.id); if (msg.on) p.likes.push(s.id); return json(200, { likes: p.likes.length, liked: msg.on }); }
      case 'done': { const p = post(msg.post); if (!p || p.kind !== 'homework') return err('gone', 404); p.done = p.done.filter((x) => x !== s.id); if (msg.on) p.done.push(s.id); return json(200, { done: msg.on }); }
      case 'flag': { const p = post(msg.post); if (!p) return err('gone', 404); p.flags.push(s.id); return json(200, { flagged: true }); }
      case 'picture_put': {
        const bytes = Buffer.from(msg.jpeg, 'base64');
        const path = `${group}/${String(++state.nextId).padStart(22, 'p')}.jpg`;
        state.pictures.set(path, bytes);
        return json(200, { path });
      }
      default: return err('bad');
    }
  }
  return { fetcher, state };
}
