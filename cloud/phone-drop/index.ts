// Supabase web function phone-drop: the door between a student's phone and their Sovran Central (module phone-drop).
// Deploy with JWT checking off: each call carries its own box token instead. The phone page may only leave a sealed
// note (action drop); the student's app may open a box, collect, mark as kept (which deletes) and close (open, take,
// done, close), register its public key for saved chats (register; cloud/library-save/) and put sealed copies of the student's
// reports and highlights on the box's shelf (shelf_put), which the phone reads with its own token (shelf). The words are scrambled on the phone with a key that never reaches this function. The database side
// is cloud/phone-drop.sql.
import postgres from 'npm:postgres@3.4.5';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, 'content-type': 'application/json' } });
const BOX = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const HASH = /^[0-9a-f]{64}$/;
const SEALED = /^[A-Za-z0-9_-]{30,170000}$/; // 20,000 characters of any kind, sealed, fit
const LIBRARY_KEY = /^sovran_[A-Za-z0-9_-]{20,200}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
const SHELF_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const SHELF_SEALED = /^[A-Za-z0-9_-]{30,1400000}$/; // a whole report, sealed (about a megabyte of text at most)
// As library-mcp hashes a library key (core.js sha256Hex).
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
      if (r === 'full') return json(429, { error: 'The drop box is full. Open Sovran Central on your computer so it collects what waits.' });
      return json(400, { error: 'Not a sealed note.' });
    }
    if (msg.action === 'open') {
      if (!HASH.test(String(msg.drop_hash ?? '')) || !HASH.test(String(msg.pull_hash ?? ''))) return json(400, { error: 'Send drop_hash and pull_hash.' });
      const [{ r }] = await sql`SELECT phone_drop.open_box(${box}, ${msg.drop_hash}, ${msg.pull_hash}) AS r`;
      if (r === 'ok') return json(200, { opened: true });
      if (r === 'busy' || r === 'full') return json(429, { error: 'The drop box can’t take a new phone just now. Try again in an hour.' });
      return json(400, { error: 'That box could not be made.' });
    }
    if (msg.action === 'shelf') { // the phone reads what its computer put there: My reports on Sovran Go
      if (!TOKEN.test(String(msg.drop ?? ''))) return json(400, { error: 'Send the drop token.' });
      const have: Record<string, string> = {};
      if (msg.have && typeof msg.have === 'object') for (const [k, v] of Object.entries(msg.have).slice(0, 20)) if (SHELF_NAME.test(k) && typeof v === 'string') have[k] = v.slice(0, 40);
      const [{ r }] = await sql`SELECT phone_drop.read_shelf(${box}, ${msg.drop}, ${sql.json(have)}) AS r`;
      return r === null ? json(404, { error: 'This link has been replaced. Open the new one from Settings on your computer.' }) : json(200, { shelf: r });
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
    if (msg.action === 'register') { // Keep this chat saved: the computer's public key, against the student's library key
      if (!LIBRARY_KEY.test(String(msg.library_key ?? '')) || !PUBLIC_KEY.test(String(msg.public ?? ''))) return json(400, { error: 'Send library_key and public.' });
      const [{ r }] = await sql`SELECT phone_drop.register_saver(${box}, ${msg.pull}, ${await sha256Hex(msg.library_key)}, ${msg.public}) AS r`;
      if (r === 'ok') return json(200, { registered: true });
      if (r === 'unknown') return json(404, { error: 'No such box.' });
      if (r === 'nokey') return json(403, { error: 'That library key is not in use.' });
      return json(400, { error: 'Not a public key.' });
    }
    if (msg.action === 'shelf_put') { // the computer's sealed copy of a report, or of the highlights ('' takes it off)
      const sealed = String(msg.sealed ?? '');
      if (!SHELF_NAME.test(String(msg.name ?? '')) || (sealed !== '' && !SHELF_SEALED.test(sealed))) return json(400, { error: 'Send a name and sealed text.' });
      const [{ r }] = await sql`SELECT phone_drop.put_shelf(${box}, ${msg.pull}, ${msg.name}, ${sealed}) AS r`;
      if (r === 'ok') return json(200, { put: true });
      if (r === 'unknown') return json(404, { error: 'No such box.' });
      if (r === 'full') return json(429, { error: 'The shelf is full.' });
      return json(400, { error: 'Send a name and sealed text.' });
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
