import { createHash } from 'node:crypto';

// A stand-in for the Sovran cloud's group-feed function (cloud/group-feed/index.ts), for the tests and the demo.
// It keeps one group in memory and follows the same main rules: only keys it knows, students post to the Circle only,
// a name before posting, your own posts to change. The real rules are checked against Postgres in cloud/group-feed.test.sql.

export function fakeGroupCloud({ students = {}, group = 'SQ01', title = 'Sovran Quest', posts = [], guides = {}, groups = null } = {}) {
  // students: { <library key>: { id, name, group? } }; guides: { <guide key>: name }; groups: [{ code, title }] (default: just the one)
  const state = { posts: posts.map((p) => ({ comments: [], likes: [], done: [], flags: [], pictures: [], comments_on: true, group: p.tab === 'news' ? null : group, ...p })),
    pictures: new Map(), nextId: 100, asked: [], tells: [], phones: new Map(), guidePhones: new Map(), pushes: new Map(), groups: (groups ?? [{ code: group, title }]).map((g) => ({ closed: false, ...g })) };
  for (const s of Object.values(students)) { s.group ??= group; s.paused ??= false; }
  const keyOf = (auth) => String(auth ?? '').replace(/^Bearer /, '');
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const phoneOf = (key) => { const id = state.phones.get(sha(key)); return id ? Object.values(students).find((x) => x.id === id) : undefined; }; // a student's phone (Sovran Go)
  const guideName = (key) => guides[key] ?? state.guidePhones.get(sha(key)); // the guide key, or Daniel's phone (go Sovran)
  const who = (auth) => students[keyOf(auth)] ?? phoneOf(keyOf(auth)) ?? (guideName(keyOf(auth)) ? { id: 'guide', guide: true, name: guideName(keyOf(auth)) } : undefined);
  const nameOf = (id) => Object.values(students).find((s) => s.id === id)?.name ?? 'A student';
  const view = (p, me) => ({
    id: p.id, group: p.group, tab: p.tab, kind: p.kind, body: p.body, due_on: p.due_on ?? null, pictures: p.pictures, comments_on: p.comments_on,
    created_at: p.created_at, edited_at: p.edited_at ?? null, hidden: Boolean(p.hidden), author: p.student ? nameOf(p.student) : 'Daniel',
    by_guide: !p.student, mine: me.guide ? !p.student : p.student === me.id, student: me.guide ? p.student ?? null : undefined, likes: p.likes.length, liked: p.likes.includes(me.id),
    done: p.kind !== 'homework' ? null : me.guide ? p.done.length : p.done.includes(me.id), flagged: me.guide ? p.flags.filter((f) => !f.comment).length : p.flags.some((f) => f.by === me.id && !f.comment) ? 1 : 0,
    comments: p.comments.filter((c) => !c.deleted && (me.guide || !c.hidden)).map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, edited_at: null, hidden: Boolean(c.hidden), reply_to: c.reply_to ?? null,
      author: c.student ? nameOf(c.student) : 'Daniel', by_guide: !c.student, mine: me.guide ? !c.student : c.student === me.id, student: me.guide ? c.student ?? null : undefined })),
  });
  const live = (tab, me, pick = null) => state.posts.filter((p) => p.tab === tab && !p.deleted && (me.guide
    ? (!pick || pick === 'ALL' || p.group === pick || (tab === 'news' && !p.group))
    : !p.hidden && (p.group === me.group || (tab === 'news' && !p.group)))).sort((a, b) => b.id - a.id);
  const groupOf = (code) => state.groups.find((g) => g.code === code);
  const meOf = (s) => (s.guide ? { guide: true, name: s.name }
    : { guide: false, group: s.group, group_title: groupOf(s.group)?.title ?? null, closed: Boolean(groupOf(s.group)?.closed), name: s.name ?? null, paused: Boolean(s.paused) });
  const openFlags = () => state.posts.flatMap((p) => (p.deleted ? [] : p.flags.filter((f) => !f.resolved)).map((f) => ({ p, f })));
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
    const guideOnly = ['hide', 'flags', 'flags_clear', 'groups', 'manage'];
    if (guideOnly.includes(msg.action) && !s.guide) return err('guideonly', 403);
    switch (msg.action) {
      case 'latest': return s.guide && state.oldGuideLatest ? json(200, { me: meOf(s), flags: openFlags().length }) // the cloud before the guide-phone change
        : s.guide ? json(200, { me: meOf(s), flags: openFlags().length, news_new_ids: [],
          feed_new_ids: live('feed', s).filter((p) => p.student).map((p) => p.id),
          comment_new_ids: state.posts.filter((p) => !p.deleted).flatMap((p) => p.comments.filter((c) => c.student && !c.deleted).map((c) => c.id)) })
        : json(200, { me: meOf(s), feed_new_ids: live('feed', s).map((p) => p.id), news_new_ids: live('news', s).map((p) => p.id) });
      case 'read': {
        const list = live(msg.tab, s, msg.group).filter((p) => !msg.before || p.id < msg.before).slice(0, msg.limit ?? 20);
        return json(200, { me: meOf(s), posts: list.map((p) => view(p, s)) });
      }
      case 'phone_key': { // only with the library key itself, or the guide key (Daniel's phone is then the guide)
        if (guides[keyOf(auth)]) {
          for (const [h, name] of state.guidePhones) if (name === guides[keyOf(auth)]) state.guidePhones.delete(h);
          if (msg.phone_hash) state.guidePhones.set(msg.phone_hash, guides[keyOf(auth)]);
          return json(200, { phone: Boolean(msg.phone_hash), guide: true });
        }
        if (!students[keyOf(auth)]) return err('nokey', 401);
        for (const [h, id] of state.phones) if (id === s.id) state.phones.delete(h);
        if (msg.phone_hash) state.phones.set(msg.phone_hash, s.id);
        return json(200, { phone: Boolean(msg.phone_hash) });
      }
      // alerts on the phone (cloud/group-push.sql): a phone's address and switches; what waits for it is put in `waiting`
      case 'push_key': return json(200, { key: 'BPkQ1ozOsbX1H0Lb3n7qY8n6S0p0bW7j2rS0vYqJcQ0eYvK8m4v5mV9l8dYgk3vK5o8n2q1w6eJ8tC3yR7uZ0aU' });
      case 'push_sub': {
        if (!phoneOf(keyOf(auth))) return err('nokey', 401);
        if (msg.old) state.pushes.delete(msg.old);
        if (!msg.endpoint) return json(200, { on: false });
        const kinds = (msg.kinds ?? []).filter((k) => ['news', 'feed', 'reply', 'due', 'answer'].includes(k)).sort();
        state.pushes.set(msg.endpoint, { student: s.id, kinds, waiting: state.pushes.get(msg.endpoint)?.waiting ?? [] });
        return json(200, { on: true, kinds });
      }
      case 'push_state': { const p = state.pushes.get(msg.endpoint); return json(200, { on: Boolean(p), kinds: p?.kinds ?? ['answer', 'due', 'news', 'reply'] }); }
      case 'push_take': {
        const p = state.pushes.get(msg.endpoint);
        if (!p || p.student !== s.id) return json(200, { items: [] });
        const items = p.waiting; p.waiting = [];
        return json(200, { items });
      }
      case 'set_name': s.name = msg.name; return json(200, { name: msg.name });
      case 'post': {
        if (s.guide) {
          if (msg.tab === 'feed' && (!msg.group || msg.group === 'ALL')) return err('group');
          const p = { id: ++state.nextId, tab: msg.tab, kind: msg.kind, group: msg.group === 'ALL' ? null : msg.group, body: msg.body, pictures: msg.pictures ?? [], due_on: msg.due_on ?? null,
            comments_on: msg.comments_on !== false, created_at: new Date().toISOString(), comments: [], likes: [], done: [], flags: [] };
          state.posts.push(p);
          return json(200, { id: p.id });
        }
        if (s.paused) return err('paused', 403);
        if (!s.name) return err('noname', 409);
        if (msg.tab !== 'feed') return err('guideonly', 403);
        const p = { id: ++state.nextId, tab: 'feed', kind: 'post', group: s.group, student: s.id, body: msg.body, pictures: msg.pictures ?? [], created_at: new Date().toISOString(),
          comments: [], likes: [], done: [], flags: [], comments_on: true };
        state.posts.push(p);
        return json(200, { id: p.id });
      }
      case 'edit_post': {
        const p = post(msg.id); if (!p || (s.guide ? p.student : p.student !== s.id)) return err('notyours', 403);
        Object.assign(p, { body: msg.body, pictures: msg.pictures, edited_at: new Date().toISOString() });
        if (s.guide) { if (msg.due_on !== undefined) p.due_on = msg.due_on; if (typeof msg.comments_on === 'boolean') p.comments_on = msg.comments_on; }
        return json(200, { id: p.id });
      }
      case 'delete_post': { const p = post(msg.id); if (!p || (!s.guide && p.student !== s.id)) return err('notyours', 403); p.deleted = true; return json(200, { deleted: p.id }); }
      case 'comment': { const p = post(msg.post); if (!p) return err('gone', 404); const parent = msg.reply_to ? p.comments.find((x) => x.id === msg.reply_to && !x.deleted) : null; if (msg.reply_to && !parent) return err('gone', 404);
        const c = { id: ++state.nextId, student: s.guide ? null : s.id, body: msg.body, created_at: new Date().toISOString(), reply_to: parent ? (parent.reply_to ?? parent.id) : null }; p.comments.push(c); return json(200, { id: c.id }); }
      case 'delete_comment': { for (const p of state.posts) for (const c of p.comments) if (c.id === msg.id && (s.guide || c.student === s.id)) { c.deleted = true; return json(200, { deleted: c.id }); } return err('notyours', 403); }
      case 'like': { const p = post(msg.post); if (!p) return err('gone', 404); p.likes = p.likes.filter((x) => x !== s.id); if (msg.on) p.likes.push(s.id); return json(200, { likes: p.likes.length, liked: msg.on }); }
      case 'done': { const p = post(msg.post); if (!p || p.kind !== 'homework') return err('gone', 404); p.done = p.done.filter((x) => x !== s.id); if (msg.on) p.done.push(s.id); return json(200, { done: msg.on }); }
      case 'flag': { const p = post(msg.post); if (!p) return err('gone', 404); p.flags.push({ by: s.id, comment: msg.comment ?? null, at: new Date().toISOString() }); return json(200, { flagged: true }); }
      case 'hide': {
        for (const p of state.posts) {
          if (msg.what === 'post' && p.id === msg.id) { p.hidden = msg.on; p.flags.filter((f) => !f.comment).forEach((f) => { f.resolved = true; }); }
          for (const c of p.comments) if (msg.what === 'comment' && c.id === msg.id) { c.hidden = msg.on; p.flags.filter((f) => f.comment === c.id).forEach((f) => { f.resolved = true; }); }
        }
        return json(200, { hidden: msg.on });
      }
      case 'flags': {
        const byItem = new Map();
        for (const { p, f } of openFlags()) {
          const k = `${p.id}/${f.comment ?? 0}`;
          const c = f.comment ? p.comments.find((x) => x.id === f.comment) : null;
          const row = byItem.get(k) ?? { post_id: p.id, comment_id: f.comment ?? null, group: p.group, author: (c ? c.student : p.student) ? nameOf(c ? c.student : p.student) : 'Daniel',
            student_id: (c ? c.student : p.student) ?? null, body: (c ? c.body : p.body).slice(0, 400), count: 0, at: f.at };
          row.count += 1; byItem.set(k, row);
        }
        return json(200, { flags: [...byItem.values()] });
      }
      case 'flags_clear': { const p = post(msg.post); p?.flags.filter((f) => (f.comment ?? null) === (msg.comment ?? null)).forEach((f) => { f.resolved = true; }); return json(200, { cleared: true }); }
      case 'groups': return json(200, { groups: state.groups.map((g) => ({ ...g, members: Object.values(students).filter((m) => m.group === g.code)
        .map((m) => ({ student_id: m.id, name: m.name ?? null, paused: Boolean(m.paused), key_on: true, phone: [...state.phones.values()].includes(m.id), done: state.posts.filter((p) => p.done.includes(m.id)).map((p) => p.id) })) })) });
      // Alerts (cloud/group-alerts.sql): what is new since a moment, in the same shape, with the main rules
      case 'alerts': {
        const since = Math.max(msg.since ? Date.parse(msg.since) : Date.now(), Date.now() - 7 * 86_400_000);
        const after = (at) => at && Date.parse(at) > since;
        const cut = (t) => String(t ?? '').slice(0, 160);
        const items = [];
        if (s.guide) {
          for (const r of state.tells) if (after(r.created_at)) items.push({ kind: 'report', report: r.id, report_kind: r.kind, place: r.place, author: r.student, text: cut(r.why), at: r.created_at });
          for (const p of state.posts) if (!p.deleted) {
            for (const f of p.flags) if (!f.resolved && after(f.at)) items.push({ kind: 'flag', post: p.id, comment: f.comment ?? null, tab: p.tab, author: p.student ? nameOf(p.student) : 'Daniel', text: cut(p.body), at: f.at });
            if (!p.student) for (const c of p.comments) if (c.student && !c.deleted && after(c.created_at)) items.push({ kind: 'reply', post: p.id, comment: c.id, tab: p.tab, author: nameOf(c.student), text: cut(c.body), at: c.created_at });
          }
        } else {
          const today = new Date(); const day = (n) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
          for (const tab of ['news', 'feed']) for (const p of live(tab, s)) {
            if (after(p.created_at) && p.student !== s.id) items.push({ kind: tab, post: p.id, tab, post_kind: p.kind, due_on: p.due_on ?? null, author: p.student ? nameOf(p.student) : 'Daniel', text: cut(p.body), pictures: p.pictures.length, at: p.created_at });
            for (const c of p.comments) {
              if (c.deleted || c.hidden || c.student === s.id || !after(c.created_at)) continue;
              const inThread = c.reply_to && p.comments.some((m) => m.student === s.id && !m.deleted && (m.id === c.reply_to || m.reply_to === c.reply_to));
              if (p.student === s.id || inThread) items.push({ kind: 'reply', post: p.id, comment: c.id, tab, author: c.student ? nameOf(c.student) : 'Daniel', text: cut(c.body), at: c.created_at, on_mine: p.student === s.id });
            }
            if (tab === 'news' && p.kind === 'homework' && p.due_on >= day(-1) && p.due_on <= day(2) && !p.done.includes(s.id))
              items.push({ kind: 'due', post: p.id, tab: 'news', post_kind: p.kind, due_on: p.due_on, author: 'Daniel', text: cut(p.body), at: p.created_at });
          }
          for (const r of state.tells) if (r.student_id === s.id && r.status === 'done' && after(r.status_at)) items.push({ kind: 'answer', report: r.id, report_kind: r.kind, place: r.place, text: cut(r.why), at: r.status_at });
        }
        items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return json(200, { now: new Date().toISOString(), items: items.slice(0, 30) });
      }
      // Tell Daniel (cloud/tell-daniel.sql)
      case 'tell': {
        if (s.guide) return err('unknown', 401);
        if (!['broken', 'off', 'question', 'other'].includes(msg.kind) || (msg.kind === 'other' && !String(msg.why ?? '').trim())) return err('bad');
        const r = { id: ++state.nextId, student_id: s.id, student: s.name ?? s.id, group: s.group, kind: msg.kind, why: msg.why, place: msg.place, context: msg.context,
          app_version: msg.version, status: 'new', note: null, created_at: new Date().toISOString(), status_at: null };
        state.tells.push(r);
        return json(200, { id: r.id });
      }
      case 'tells': {
        if (!s.guide) return err('guideonly', 403);
        const count = (st) => state.tells.filter((r) => r.status === st).length;
        return json(200, { reports: state.tells.filter((r) => !msg.status || r.status === msg.status).sort((a, b) => b.id - a.id),
          counts: { new: count('new'), digging: count('digging'), done: count('done') } });
      }
      case 'tell_status': {
        if (!s.guide) return err('guideonly', 403);
        const r = state.tells.find((x) => x.id === msg.id); if (!r) return err('gone', 404);
        Object.assign(r, { status: msg.status, status_at: new Date().toISOString(), note: msg.note ?? r.note });
        return json(200, { id: r.id, status: r.status });
      }
      case 'manage': {
        const m = Object.values(students).find((x) => x.id === msg.student);
        const g = groupOf(msg.value);
        switch (msg.what) {
          case 'pause': case 'unpause': if (m) m.paused = msg.what === 'pause'; break;
          case 'name': if (m) m.name = msg.value || null; break;
          case 'move': if (!m) return err('nostudent', 404); m.group = msg.value; break;
          case 'leave': if (m) m.group = null; break;
          case 'phone_off': for (const [h, id] of state.phones) if (id === msg.student) state.phones.delete(h); break;
          case 'close': case 'open': if (g) g.closed = msg.what === 'close'; break;
          case 'new_group': state.groups.push({ code: String(msg.student).toUpperCase(), title: msg.value, closed: false }); break;
          default: return err('bad');
        }
        return json(200, { ok: true });
      }
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
