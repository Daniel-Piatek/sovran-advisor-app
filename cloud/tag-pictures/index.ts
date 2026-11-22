// Supabase web function tag-pictures (2026-11-22, D's wish): the Sovran pictures of the starter tags, the 13 character
// heads and the 5 Quest icons, for someone with a Sovran key only. They are not in this repository (it is public): they
// live in the private storage bucket tag-pictures, reached with the service role key the function is given.
// Deploy with JWT checking off: each call carries a key instead, as "Authorization: Bearer <key>". A student's key is
// their Sovran Library key; D's is a library key or a guide key. Only the key's SHA-256 reaches the database.
//
// GET .../tag-pictures/<name>.webp     the picture (image/webp), or 404 / 401
import postgres from 'npm:postgres@3.4.5';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const STORAGE = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/tag-pictures`;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const NAMES = ['medusa', 'gremlin', 'werewolf', 'mummy', 'zombie', 'tyrant', 'gollum', 'vampire', 'kraken', 'manticore', 'troll', 'gryphon', 'mystic',
  'hero', 'phoenix', 'quantum', 'sovran', 'destiny'];
const KEY = /^[A-Za-z0-9_-]{20,200}$/;
const MAX_PICTURE = 400000;
const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const name = new URL(req.url).pathname.match(/\/([a-z]{2,20})\.webp$/)?.[1];
  if (!name || !NAMES.includes(name)) return json(404, { error: 'Not found.' });
  if (!KEY.test(key)) return json(401, { error: 'Send your key.' });
  const h = await sha256Hex(key);
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const [{ ok }] = await sql`SELECT EXISTS (SELECT 1 FROM library.students WHERE key_hash = ${h} AND active)
      OR EXISTS (SELECT 1 FROM group_feed.guides WHERE key_hash = ${h}) AS ok`;
    if (!ok) return json(401, { error: 'This Sovran key isn’t known, or has been switched off.' });
    const got = await fetch(`${STORAGE}/${name}.webp`, { headers: { authorization: `Bearer ${SERVICE}` } });
    if (!got.ok) return json(404, { error: 'Not found.' });
    // The app keeps its own copy and asks only once.
    return new Response(got.body, { status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' } });
  } catch {
    return json(500, { error: 'The pictures can’t be reached just now.' });
  }
});
