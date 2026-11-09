// Puts the saved Light/Dark choice on the page before anything is drawn, so a dark
// page never flashes light first. The switch itself is in app.js.
try {
  if (localStorage.getItem('notes.theme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch { /* the browser won't say: stay light */ }
