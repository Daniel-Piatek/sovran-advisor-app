// Stops Sovran Advisor if it is running (npm run stop), for example before an update. Quitting the
// Mac icon closes the icon only; the app itself keeps running until this (or a restart of the computer).
const port = process.env.PORT ?? '3300';
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
  console.log(res.ok ? 'Sovran Advisor is stopping.' : `Sovran Advisor answered ${res.status}; it was not stopped.`);
  if (res.ok) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { console.log('Stopped.'); process.exit(0); }
    }
    console.log('It is taking long to stop; check again in a moment.');
  }
} catch {
  console.log('Sovran Advisor is not running.');
}
