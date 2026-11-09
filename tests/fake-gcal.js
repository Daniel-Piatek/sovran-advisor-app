// A stand-in for Google Calendar's own API (calendar list, events), made from made-up calendars: no test talks to the real
// Google Calendar. It answers only to a bearer token, like the real one, and notes every call.

import http from 'node:http';

const pad = (n) => String(n).padStart(2, '0');
// A local moment "2026-11-12T10:00" as Google writes it: an ISO moment with its offset.
const stamp = (local) => new Date(local).toISOString();

export async function startFakeGcal({ pageSize = 5 } = {}) {
  const fake = {
    calendars: [{ id: 'primary', summary: 'work@mypractice.com', primary: true, selected: true, accessRole: 'owner' }],
    events: new Map(), // calendar id → [Google event]
    offline: false,
    seen: [], // every call: { method, path, query, auth }
    patches: [], // every change the app sent: { id, ifMatch, body }
    inserts: [], // every new event the app sent: { calendar, params, body }
    busy: 0, // the next this many changes are answered 503 (Google is busy)
    etagCounter: 1,
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
  fake.events.set('primary', []);
  const next = () => { fake.etagCounter += 1; return `"etag-${fake.etagCounter}"`; };
  // Adds an event as Google would hold it. start and end are local "YYYY-MM-DDTHH:MM" (or "YYYY-MM-DD" for a whole day).
  fake.add = ({ calendar = 'primary', id, summary, start, end, location = '', description = '', attendees = [], organizer = null, meet = '', recurringEventId = '', recurrence = null, timeZone = '', status = 'confirmed' }) => {
    const whole = /^\d{4}-\d{2}-\d{2}$/.test(start);
    const event = {
      id, etag: next(), status, summary, location, description, iCalUID: `${id}@google.com`, htmlLink: `https://calendar.example/event?eid=${id}`,
      start: whole ? { date: start } : { dateTime: stamp(start) }, end: whole ? { date: end } : { dateTime: stamp(end) },
      ...(organizer ? { organizer } : { organizer: { email: 'work@mypractice.com', displayName: 'You', self: true } }),
      ...(attendees.length ? { attendees } : {}), ...(meet ? { hangoutLink: meet } : {}), ...(recurringEventId ? { recurringEventId } : {}),
      ...(recurrence ? { recurrence } : {}),
    };
    if (timeZone && event.start.dateTime) { event.start.timeZone = timeZone; event.end.timeZone = timeZone; }
    if (!fake.events.has(calendar)) fake.events.set(calendar, []);
    fake.events.get(calendar).push(event);
    return event;
  };
  fake.change = (calendar, id, changes) => {
    const event = fake.events.get(calendar).find((e) => e.id === id);
    Object.assign(event, changes, { etag: next() });
    return event;
  };
  fake.remove = (calendar, id) => { fake.events.set(calendar, fake.events.get(calendar).filter((e) => e.id !== id)); };
  fake.cancel = (calendar, id) => fake.change(calendar, id, { status: 'cancelled' });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    fake.seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? '' });
    if (fake.offline) return req.socket.destroy();
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (!/^Bearer access-/.test(req.headers.authorization ?? '')) return json(401, { error: 'no token' });
    if (url.pathname === '/users/me/calendarList') return json(200, { items: fake.calendars });
    const events = url.pathname.match(/^\/calendars\/([^/]+)\/events$/);
    if (events && req.method === 'GET') {
      const id = decodeURIComponent(events[1]);
      if (!fake.events.has(id)) return json(404, { error: 'no such calendar' });
      const min = new Date(url.searchParams.get('timeMin') ?? 0).getTime();
      const max = new Date(url.searchParams.get('timeMax') ?? 8.64e15).getTime();
      const key = url.searchParams.get('privateExtendedProperty'); // appKey=<key>: the event the app made, found again
      const all = fake.events.get(id).filter((e) => !e.recurrence && (!key || `appKey=${e.extendedProperties?.private?.appKey}` === key)).filter((e) => {
        const at = new Date(e.start.dateTime ?? `${e.start.date}T00:00:00`).getTime();
        return at >= min && at <= max;
      });
      const start = Number(url.searchParams.get('pageToken') || 0);
      return json(200, { items: all.slice(start, start + pageSize), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
    }
    if (events && req.method === 'POST') {
      const id = decodeURIComponent(events[1]);
      const body = await new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))); });
      fake.inserts.push({ calendar: id, params: Object.fromEntries(url.searchParams), body });
      if (fake.busy > 0) { fake.busy -= 1; return json(503, { error: 'busy' }); }
      const eventId = `made${fake.inserts.length}`;
      const event = { id: eventId, etag: next(), status: 'confirmed', iCalUID: `${eventId}@google.com`, htmlLink: `https://calendar.example/event?eid=${eventId}`,
        organizer: { email: 'work@mypractice.com', displayName: 'You', self: true }, ...body };
      if (body.attendees) event.attendees = body.attendees.map((a) => ({ responseStatus: 'needsAction', ...a }));
      if (body.conferenceData?.createRequest) { event.hangoutLink = `https://meet.example/${eventId}`; event.conferenceData = { entryPoints: [{ entryPointType: 'video', uri: event.hangoutLink }] }; }
      fake.events.get(id).push(event);
      return json(200, event);
    }
    const one = url.pathname.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/);
    if (one) {
      const list = fake.events.get(decodeURIComponent(one[1]));
      const event = list?.find((e) => e.id === decodeURIComponent(one[2]));
      if (!event) return json(404, { error: 'no such event' });
      if (req.method === 'GET') return json(200, event);
      if (req.method === 'PATCH') {
        const body = await new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))); });
        const ifMatch = req.headers['if-match'] ?? '';
        fake.patches.push({ id: event.id, ifMatch, body });
        if (fake.busy > 0) { fake.busy -= 1; return json(503, { error: 'busy' }); }
        if (ifMatch && ifMatch !== event.etag) return json(412, { error: 'precondition failed' });
        const before = event.start?.dateTime ? new Date(event.start.dateTime).getTime() : null;
        if (body.attendees) event.attendees = body.attendees.map((a) => ({ ...(event.attendees ?? []).find((x) => x.email === a.email), ...a, ...((event.attendees ?? []).find((x) => x.email === a.email)?.self ? { self: true } : {}) }));
        const { attendees, ...rest } = body;
        Object.assign(event, rest, { etag: next() });
        // A series (an event with a rule) moved: every event of it moves by the same, as Google does.
        if (event.recurrence && before !== null && body.start?.dateTime) {
          const delta = new Date(event.start.dateTime).getTime() - before;
          for (const e of list) if (e.recurringEventId === event.id) { const shift = (d) => new Date(new Date(d).getTime() + delta).toISOString(); e.start = { dateTime: shift(e.start.dateTime) }; e.end = { dateTime: shift(e.end.dateTime) }; e.etag = next(); }
        }
        return json(200, event);
      }
    }
    return json(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.env = { GOOGLE_CALENDAR_API_URL: `http://127.0.0.1:${server.address().port}` };
  return fake;
}
