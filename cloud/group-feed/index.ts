// Supabase web function group-feed: the door to Group (module group-feed). Deploy with JWT checking off: each call
// carries a key instead, as "Authorization: Bearer <key>". A student's key is their Sovran Library key (sovran_...);
// D's is a guide key (guide_...); a student's phone has its own (phone_..., Group Circle only). Only the SHA-256 of a key reaches the database, and every rule (which group a
// student sees, who may post announcements, pausing, closing) is in cloud/group-feed.sql, which finds the group from
// the key and never from what the app asks for.
//
// POST {action, ...}            JSON in, JSON out (actions below)
// POST {action:'tell', kind, why, place, context, version}; {action:'tells', status?, before?}; {action:'tell_status', id, status, note?}
//      Tell Daniel (cloud/tell-daniel.sql)
// POST {action:'alerts', since?}  what is new for this key since that moment: {now, items} (cloud/group-alerts.sql)
// POST {action:'push_key'} | {action:'push_sub', endpoint, kinds, old?} | {action:'push_state'|'push_take', endpoint}
//      alerts on the phone (cloud/group-push.sql, push.js): a phone keeps its push address, then fetches what waits
// POST {action:'picture_put', jpeg: <base64>}   a picture the app already shrank; returns {path}
// GET  .../group-feed/picture/<group>/<name>.jpg   the picture's bytes, if the key holder may see it
// Pictures live in the private storage bucket group-feed, reached with the service role key the function is given.
import postgres from 'npm:postgres@3.4.5';
import { makeVapid, wake } from './push.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });
const STORAGE = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/group-feed`;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, 'content-type': 'application/json' } });
const SUBJECT = 'https://daniel-piatek.github.io/sovran-advisor-app/'; // Sovran Go's own page, named in every wake
const WRITES = new Set(['post', 'comment', 'tell_status']); // after these, phones are looked at straight away
const KEY = /^(sovran|guide|phone)_[A-Za-z0-9_-]{20,200}$/; // phone_: a student's phone (Sovran Go), Group Circle only
const PATH = /^[A-Z0-9-]{2,20}\/[A-Za-z0-9_-]{22}\.jpg$/;
const MAX_PICTURE = 450000; // the app sends about 200 KB; this leaves room and refuses anything big
const ERRORS: Record<string, [number, string]> = {
  nokey: [401, 'This key is not in a group, or has been switched off.'],
  noname: [409, 'Pick the name your group will see first.'],
  paused: [403, 'Posting is paused for you. Daniel can tell you more.'],
  closed: [403, 'This group has finished. You can still read everything.'],
  guideonly: [403, 'Only Daniel can do that.'],
  notyours: [403, 'You can only change what you wrote.'],
  gone: [404, 'That post is no longer there.'],
  nocomments: [403, 'Questions are turned off for this one.'],
  toomany: [429, 'That’s a lot for one day. Try again tomorrow.'],
  pictures: [400, 'Those pictures can’t go on this post.'],
  group: [400, 'Pick a group.'],
  nostudent: [404, 'No such student.'],
  bad: [400, 'That didn’t look right. Check the words and try again.'],
  unknown: [401, 'This Sovran Library key isn’t known, or has been switched off.'],
};

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const id = (x: unknown) => (Number.isSafeInteger(x) && (x as number) > 0 ? (x as number) : null);
const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const moment = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:?\d{2})$/.test(x) && x.length <= 40 ? x : null);
const day = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const paths = (x: unknown) => (Array.isArray(x) ? x.filter((p) => typeof p === 'string' && PATH.test(p)).slice(0, 4) : []);
const name22 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);

function answer(r: any) {
  if (r && typeof r === 'object' && r.error) { const [code, message] = ERRORS[r.error] ?? [400, 'That didn’t work.']; return json(code, { error: message, code: r.error }); }
  return json(200, r);
}

// The sending key pair, made the first time it is needed and kept in the database.
async function vapid() {
  let [row] = await sql`SELECT public_key, private_jwk FROM group_feed.push_vapid`;
  if (!row) {
    const made = await makeVapid();
    await sql`INSERT INTO group_feed.push_vapid (public_key, private_jwk) VALUES (${made.public_key}, ${sql.json(made.private_jwk)}) ON CONFLICT DO NOTHING`;
    [row] = await sql`SELECT public_key, private_jwk FROM group_feed.push_vapid`;
  }
  return row;
}

// Wakes the phones that have something new (group_feed.push_run decides, and keeps what they will fetch).
async function pushRun(force: boolean) {
  try {
    const keys = await vapid();
    const due = await sql`SELECT sub_id, endpoint FROM group_feed.push_run(${force})`;
    for (const { sub_id, endpoint } of due) {
      const how = await wake(endpoint, keys, SUBJECT);
      await sql`SELECT group_feed.push_result(${sub_id}, ${how === 'sent' ? null : how === 'gone'})`;
    }
  } catch { /* the next call tries again */ }
}
const later = (work: Promise<unknown>) => { const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(work); };
const endpoint = (x: unknown) => (typeof x === 'string' && x.startsWith('https://') && x.length <= 1000 ? x : null);

async function removePictures(list: string[]) {
  if (!list.length) return;
  await fetch(STORAGE, { method: 'DELETE', headers: { authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: list }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const auth = req.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!KEY.test(key)) return json(401, { error: 'Send your key.' });
  const h = await sha256Hex(key);
  try {
    if (req.method === 'GET') {
      const m = new URL(req.url).pathname.match(/\/picture\/([A-Z0-9-]{2,20}\/[A-Za-z0-9_-]{22}\.jpg)$/);
      if (!m) return json(404, { error: 'Not found.' });
      const [{ ok }] = await sql`SELECT group_feed.picture_ok(${h}, ${m[1]}) AS ok`;
      if (!ok) return json(404, { error: 'Not found.' });
      const got = await fetch(`${STORAGE}/${m[1]}`, { headers: { authorization: `Bearer ${SERVICE}` } });
      if (!got.ok) return json(404, { error: 'Not found.' });
      // A picture never changes once kept, so the app keeps its own copy and asks only once.
      return new Response(got.body, { status: 200, headers: { ...cors, 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } });
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    let msg: any;
    try { msg = JSON.parse(await req.text()); } catch { return json(400, { error: 'Not valid JSON' }); }
    if (typeof msg !== 'object' || msg === null) return json(400, { error: 'Not valid JSON' });
    const res = await act(h, msg);
    later(pushRun(WRITES.has(msg.action) && res.ok));
    return res;
  } catch {
    return json(500, { error: 'Group had a problem. Try again in a minute.' });
  }
});

async function act(h: string, msg: any): Promise<Response> {
    const one = async (q: Promise<any>) => answer((await q)[0].r);
    switch (msg.action) {
      case 'latest': return one(sql`SELECT group_feed.latest(${h}) AS r`);
      // what is new for this key since a moment (cloud/group-alerts.sql), for the app's alerts
      case 'alerts': return one(sql`SELECT group_feed.alerts(${h}, ${moment(msg.since)}::timestamptz) AS r`);
      case 'read': return one(sql`SELECT group_feed.read(${h}, ${text(msg.tab, 8)}, ${text(msg.group, 20) || null}, ${id(msg.before)}, ${id(msg.limit) ?? 20}) AS r`);
      // the student's computer registers its phone's key (only with the library key itself; null takes it away)
      case 'phone_key': return one(sql`SELECT group_feed.phone_key(${h}, ${typeof msg.phone_hash === 'string' && /^[0-9a-f]{64}$/.test(msg.phone_hash) ? msg.phone_hash : null}) AS r`);
      case 'set_name': return one(sql`SELECT group_feed.set_name(${h}, ${text(msg.name, 80)}) AS r`);
      case 'post': return one(sql`SELECT group_feed.post(${h}, ${text(msg.tab, 8)}, ${text(msg.kind, 20) || null}, ${text(msg.group, 20) || null},
        ${text(msg.body, 5001)}, ${paths(msg.pictures)}::text[], ${day(msg.due_on)}::date, ${msg.comments_on === false ? false : true}) AS r`);
      case 'edit_post': return one(sql`SELECT group_feed.edit_post(${h}, ${id(msg.id)}, ${text(msg.body, 5001)}, ${paths(msg.pictures)}::text[],
        ${day(msg.due_on)}::date, ${typeof msg.comments_on === 'boolean' ? msg.comments_on : null}) AS r`);
      case 'delete_post': {
        const [{ r }] = await sql`SELECT group_feed.delete_post(${h}, ${id(msg.id)}) AS r`;
        if (!r.error) await removePictures(r.pictures ?? []);
        return answer({ deleted: r.deleted, error: r.error });
      }
      case 'comment': return one(sql`SELECT group_feed.comment(${h}, ${id(msg.post)}, ${text(msg.body, 2001)}, ${msg.reply_to == null ? null : id(msg.reply_to)}::bigint) AS r`);
      case 'edit_comment': return one(sql`SELECT group_feed.edit_comment(${h}, ${id(msg.id)}, ${text(msg.body, 2001)}) AS r`);
      case 'delete_comment': return one(sql`SELECT group_feed.delete_comment(${h}, ${id(msg.id)}) AS r`);
      case 'like': return one(sql`SELECT group_feed.like(${h}, ${id(msg.post)}, ${msg.on !== false}) AS r`);
      case 'done': return one(sql`SELECT group_feed.mark_done(${h}, ${id(msg.post)}, ${msg.on !== false}) AS r`);
      case 'flag': return one(sql`SELECT group_feed.flag(${h}, ${id(msg.post)}, ${id(msg.comment)}) AS r`);
      case 'picture_put': {
        const b64 = text(msg.jpeg, MAX_PICTURE * 2);
        let bytes: Uint8Array;
        try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return answer({ error: 'bad' }); }
        if (bytes.length < 100 || bytes.length > MAX_PICTURE || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return answer({ error: 'bad' });
        const [{ r }] = await sql`SELECT group_feed.picture_slot(${h}, ${name22()}, ${text(msg.group, 20) || null}) AS r`;
        if (r.error) return answer(r);
        const put = await fetch(`${STORAGE}/${r.path}`, { method: 'POST', headers: { authorization: `Bearer ${SERVICE}`, 'content-type': 'image/jpeg', 'x-upsert': 'false' }, body: bytes });
        if (!put.ok) return json(502, { error: 'The picture could not be kept. Try again in a minute.' });
        return one(sql`SELECT group_feed.picture_kept(${h}, ${r.path}, ${bytes.length}) AS r`);
      }
      // the guide only (the database refuses anyone else)
      case 'hide': return one(sql`SELECT group_feed.hide(${h}, ${msg.what === 'comment' ? 'comment' : 'post'}, ${id(msg.id)}, ${msg.on !== false}) AS r`);
      case 'flags': return one(sql`SELECT group_feed.flags_open(${h}) AS r`);
      case 'flags_clear': return one(sql`SELECT group_feed.flags_clear(${h}, ${id(msg.post)}, ${id(msg.comment)}) AS r`);
      case 'groups': return one(sql`SELECT group_feed.groups_list(${h}) AS r`);
      // Tell Daniel (cloud/tell-daniel.sql): a student sends one; the guide reads the list and marks each one
      case 'tell': {
        const context = msg.context && typeof msg.context === 'object' && !Array.isArray(msg.context) ? msg.context : {};
        return one(sql`SELECT tell_daniel.tell(${h}, ${text(msg.kind, 20)}, ${text(msg.why, 4001)}, ${text(msg.place, 20)}, ${sql.json(context)}, ${text(msg.version, 80) || null}) AS r`);
      }
      case 'tells': return one(sql`SELECT tell_daniel.list(${h}, ${['new', 'digging', 'done'].includes(msg.status) ? msg.status : null}, ${id(msg.before)}) AS r`);
      case 'tell_status': return one(sql`SELECT tell_daniel.set_status(${h}, ${id(msg.id)}, ${text(msg.status, 10)}, ${text(msg.note, 4001) || null}) AS r`);
      case 'manage': return one(sql`SELECT group_feed.manage(${h}, ${text(msg.what, 20)}, ${text(msg.student, 40) || null}, ${text(msg.value, 80) || null}) AS r`);
      // alerts on the phone (cloud/group-push.sql): only a phone's own key keeps a push address
      case 'push_key': return json(200, { key: (await vapid()).public_key });
      case 'push_sub': return one(sql`SELECT group_feed.push_sub(${h}, ${endpoint(msg.endpoint)}, ${Array.isArray(msg.kinds) ? msg.kinds.filter((k: unknown) => typeof k === 'string').slice(0, 10) : []}::text[], ${endpoint(msg.old)}) AS r`);
      case 'push_state': return one(sql`SELECT group_feed.push_state(${h}, ${endpoint(msg.endpoint) ?? ''}) AS r`);
      case 'push_take': return one(sql`SELECT group_feed.push_take(${h}, ${endpoint(msg.endpoint) ?? ''}) AS r`);
      default: return json(400, { error: `Unknown action: ${msg.action}` });
    }
}
