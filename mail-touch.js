// The day you last had mail with a person (Mail 10): the newest mail from them or to them, by the addresses written on their page.
// Kept apart so the reconnect rhythm can read it without reading the rest of Mail.

export const addressesIn = (text) => [...new Set(String(text ?? '').toLowerCase().split(/[\s,;<>]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];

// SQL for "a mail from or to one of these addresses" over a messages table aliased m; the values go in the order of `args`.
export function addressFilter(addresses) {
  const marks = addresses.map(() => '?').join(', ');
  return {
    sql: `(lower(m.from_email) IN (${marks}) OR EXISTS (SELECT 1 FROM json_each(m.to_addrs) j WHERE lower(json_extract(j.value, '$.email')) IN (${marks}))
      OR EXISTS (SELECT 1 FROM json_each(m.cc_addrs) j WHERE lower(json_extract(j.value, '$.email')) IN (${marks})))`,
    args: [...addresses, ...addresses, ...addresses],
  };
}

export function lastMailDay(db, addresses) {
  if (!addresses.length) return null;
  try {
    const f = addressFilter(addresses);
    const row = db.prepare(`SELECT max(m.sent_at) AS at FROM mail_messages m WHERE m.deleted_at IS NULL AND ${f.sql}`).get(...f.args);
    if (!row?.at) return null;
    const d = new Date(row.at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // this computer's day
  } catch { return null; } // no mail tables yet
}
