// Supabase web function phone-drop: the door between a student's phone and their Sovran Advisor (module phone-drop).
// Deploy with JWT checking off: each call carries its own box token instead. The phone page may only leave a sealed
// note (action drop); the student's app may open a box, collect, mark as kept (which deletes) and close (open, take,
// done, close). The words are scrambled on the phone with a key that never reaches this function. The database side
// is cloud/phone-drop.sql.
import postgres from 'npm:postgres@3.4.5';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, 'content-type': 'application/json' } });
const BOX = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEALED = /^[A-Za-z0-9_-]{30,24000}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  let msg: any;
  try { msg = JSON.parse(await req.text()); } catch { return json(400, { error: 'Not valid JSON' }); }
  if (typeof msg !== 'object' || msg === null || !BOX.test(String(msg.box ?? ''))) return json(400, { error: 'No box.' });
  const box = msg.box;
  try {
    if (msg.action === 'drop') {
      if (!TOKEN.test(String(msg.drop ?? '')) || !SEALED.test(String(msg.sealed ?? ''))) return json(400, { error: 'Not a sealed note.' });
      const [{ r }] = await sql`SELECT phone_drop.drop_note(${box}, ${msg.drop}, ${msg.sealed}) AS r`;
      if (r === 'ok') return json(200, { kept: true });
      if (r === 'unknown') return json(404, { error: 'This link has been replaced. Open the new one from Settings on your computer.' });
      if (r === 'full') return json(429, { error: 'The drop box is full. Open Sovran Advisor on your computer so it collects what waits.' });
      return json(400, { error: 'Not a sealed note.' });
    }
    if (msg.action === 'open') {
      if (!HASH.test(String(msg.drop_hash ?? '')) || !HASH.test(String(msg.pull_hash ?? ''))) return json(400, { error: 'Send drop_hash and pull_hash.' });
      const [{ r }] = await sql`SELECT phone_drop.open_box(${box}, ${msg.drop_hash}, ${msg.pull_hash}) AS r`;
      if (r === 'ok') return json(200, { opened: true });
      if (r === 'busy' || r === 'full') return json(429, { error: 'The drop box can’t take a new phone just now. Try again in an hour.' });
      return json(400, { error: 'That box could not be made.' });
    }
    if (!TOKEN.test(String(msg.pull ?? ''))) return json(400, { error: 'Send the pull token.' });
    if (msg.action === 'take') {
      const [{ r }] = await sql`SELECT phone_drop.take_notes(${box}, ${msg.pull}) AS r`;
      return r === null ? json(404, { error: 'No such box.' }) : json(200, { notes: r });
    }
    if (msg.action === 'done') {
      const ids = Array.isArray(msg.ids) ? msg.ids.filter((x: unknown) => Number.isSafeInteger(x) && (x as number) > 0).slice(0, 50) : [];
      const [{ r }] = await sql`SELECT phone_drop.done_notes(${box}, ${msg.pull}, ${ids}::bigint[]) AS r`;
      return r < 0 ? json(404, { error: 'No such box.' }) : json(200, { deleted: r });
    }
    if (msg.action === 'close') {
      const [{ r }] = await sql`SELECT phone_drop.close_box(${box}, ${msg.pull}) AS r`;
      return json(200, { closed: r });
    }
    return json(400, { error: `Unknown action: ${msg.action}` });
  } catch {
    return json(500, { error: 'The drop box had a problem. Try again in a minute.' });
  }
});
