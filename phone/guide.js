// Daniel's own go Sovran (2026-11-23, the owner's wish): the guide's tabs of Group Circle on the phone, as on the
// computer (APP Daniel public/group.js and public/student-reports.js): Flags, People and Reports (Tell Daniel), and the
// guide's buttons on posts and comments (hide, delete, pause). Everything goes through the same Sovran cloud door with
// the phone's guide key (group.js `ask`); nothing here is kept on the phone.

export const GUIDE_TABS = [['flags', 'Flags'], ['people', 'People'], ['reports', 'Reports']];

const TELL_KINDS = { broken: 'Something isn’t working', off: 'Something seems off here', question: 'A question', other: 'Other' };
const PLACES = { assistant: 'a Sovran Advisor answer', note: 'a note', journal: 'a journal entry', report: 'a report', group: 'Group Circle', app: 'the app (Help)' };
const STATUSES = [['new', 'New'], ['digging', 'Needs digging'], ['done', 'Dealt with'], ['all', 'All']];
const DIAGNOSIS = { bug: 'A bug', data: 'Library or data', question: 'A question for you', misunderstanding: 'A misunderstanding', fixed: 'Already fixed', other: 'Other' };
const LABELS = { question: 'Their question', answer: 'The answer', answer_part: 'The part of the answer they selected', used: 'What it looked at', model: 'Answered by',
  report: 'Report', section: 'Section', quote: 'The words', title: 'Title', words: 'The words', page: 'Help page' };
const asText = (value) => (Array.isArray(value) ? value.join('\n') : typeof value === 'object' && value ? JSON.stringify(value, null, 2) : String(value ?? ''));

// tools: { el, ask, say, ago, redraw }
export function guideTools({ el, ask, say, ago, redraw }) {
  // A button that needs a second tap for something that can't be undone from here.
  function sure(label, again, run) {
    const button = el('button', { type: 'button', class: 'g-link g-danger' }, label);
    let armed = null;
    button.addEventListener('click', async () => {
      if (!armed) { button.textContent = again; armed = setTimeout(() => { armed = null; button.textContent = label; }, 4000); return; }
      clearTimeout(armed); armed = null; button.disabled = true;
      try { await run(); await redraw(); } catch (err) { say(err.message); button.disabled = false; button.textContent = label; }
    });
    return button;
  }
  function act(label, run) {
    const button = el('button', { type: 'button', class: 'g-link' }, label);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await run(); await redraw(); } catch (err) { say(err.message); button.disabled = false; }
    });
    return button;
  }
  const pause = (student, name) => act(`Pause ${name}`, () => ask({ action: 'manage', what: 'pause', student }));

  // Under a post: hide or bring back (students' posts), pause its writer, delete.
  function postButtons(p) {
    return el('div', { class: 'g-actions g-guide' },
      !p.by_guide ? act(p.hidden ? 'Bring back' : 'Hide', () => ask({ action: 'hide', what: 'post', id: p.id, on: !p.hidden })) : null,
      p.student ? pause(p.student, p.author) : null,
      sure(p.mine ? 'Delete' : 'Delete for everyone', 'Tap again to delete', () => ask({ action: 'delete_post', id: p.id })));
  }
  function commentButtons(c) {
    return el('div', { class: 'g-actions g-guide' },
      !c.by_guide ? act(c.hidden ? 'Bring back' : 'Hide', () => ask({ action: 'hide', what: 'comment', id: c.id, on: !c.hidden })) : null,
      sure('Delete', 'Tap again to delete', () => ask({ action: 'delete_comment', id: c.id })));
  }

  // Flags: what students let you know about. It's fine, hide it, or pause who wrote it.
  async function drawFlags(list) {
    const { flags = [] } = await ask({ action: 'flags' });
    if (!flags.length) return list.replaceChildren(el('p', { class: 'g-note' }, 'Nothing flagged. When a student presses “Let Daniel know”, it shows here.'));
    list.replaceChildren(el('p', { class: 'g-note' }, 'What students let you know about.'), ...flags.map((f) => el('article', { class: 'g-post' },
      el('header', { class: 'g-by' }, el('strong', {}, f.author), el('span', { class: 'g-when' }, `${f.comment_id ? 'a comment' : 'a post'}${f.group ? ` · ${f.group}` : ''} · ${ago(f.at)}`)),
      el('p', { class: 'g-body' }, f.body || '(no words)'),
      el('p', { class: 'g-note' }, f.count === 1 ? '1 student let you know' : `${f.count} students let you know`),
      el('div', { class: 'g-actions g-guide' },
        act('It’s fine', () => ask({ action: 'flags_clear', post: f.post_id, comment: f.comment_id ?? null })),
        act('Hide it', () => ask({ action: 'hide', what: f.comment_id ? 'comment' : 'post', id: f.comment_id ?? f.post_id, on: true })),
        f.student_id ? pause(f.student_id, f.author) : null))));
  }

  // People: each group and who is in it. Name, pause, move, phone off, take out; finish or reopen; add; a new group.
  async function drawPeople(list) {
    const { groups = [] } = await ask({ action: 'groups' });
    const manage = (what, student, value) => ask({ action: 'manage', what, student, value });
    const sections = groups.map((g) => {
      const rows = g.members.map((m) => {
        const who = m.name ?? m.student_id;
        const name = el('input', { class: 'g-name', value: m.name ?? '', maxlength: 40, placeholder: 'No name picked yet', 'aria-label': `Name for ${m.student_id}` });
        return el('div', { class: 'g-person' },
          name,
          el('p', { class: 'g-when' }, [m.student_id, m.paused ? 'paused' : '', m.key_on ? '' : 'library key turned off', m.phone ? 'on go Sovran too' : '', `${m.done.length} homework done`].filter(Boolean).join(' · ')),
          el('div', { class: 'g-actions g-guide' },
            act('Save name', () => manage('name', m.student_id, name.value.trim())),
            act(m.paused ? 'Let them post again' : 'Pause', () => manage(m.paused ? 'unpause' : 'pause', m.student_id)),
            ...groups.filter((o) => o.code !== g.code).map((o) => act(`Move to ${o.code}`, () => manage('move', m.student_id, o.code))),
            m.phone ? sure('Phone off', 'Tap again: phone off', () => manage('phone_off', m.student_id)) : null,
            sure('Take out', `Tap again to take ${who} out`, () => manage('leave', m.student_id))));
      });
      const add = el('input', { class: 'g-name', placeholder: 'client-…', maxlength: 40, 'aria-label': `Add a student to ${g.code} by their code` });
      return el('section', { class: 'g-post g-people' },
        el('header', { class: 'g-by' }, el('strong', {}, `${g.code}${g.title ? ` · ${g.title}` : ''}`),
          el('span', { class: 'g-when' }, `${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}${g.closed ? ' · finished: read only' : ''}`)),
        ...(rows.length ? rows : [el('p', { class: 'g-note' }, 'Nobody in this group yet.')]),
        el('div', { class: 'g-comment-box' }, add, act('Add', () => { if (!add.value.trim()) throw new Error('Type their code first.'); return manage('move', add.value.trim(), g.code); })),
        el('div', { class: 'g-actions g-guide' }, g.closed ? act('Reopen the group', () => manage('open', null, g.code))
          : sure('Finish the Quest', 'Tap again: read only', () => manage('close', null, g.code))));
    });
    const code = el('input', { class: 'g-name', placeholder: 'SQ02', maxlength: 20, 'aria-label': 'New group code' });
    const title = el('input', { class: 'g-name', placeholder: 'Sovran Quest', maxlength: 80, 'aria-label': 'New group title' });
    list.replaceChildren(...sections, el('section', { class: 'g-people g-new-group' },
      el('p', { class: 'g-label' }, 'A new group'), code, title,
      act('Make the group', () => { if (!code.value.trim()) throw new Error('Type a code for the group first.'); return manage('new_group', code.value.trim().toUpperCase(), title.value.trim() || null); })));
  }

  // Reports: what students sent with Tell Daniel, with Claude's diagnosis. Mark each one, add a note, copy it for Claude.
  let status = 'new';
  async function drawReports(list) {
    const { reports = [], counts = {} } = await ask({ action: 'tells', status: status === 'all' ? null : status });
    const chips = el('div', { class: 'g-actions g-guide g-statuses' }, ...STATUSES.map(([id, name]) => {
      const b = el('button', { type: 'button', class: 'g-link', 'aria-pressed': String(id === status) }, name, id !== 'all' && counts[id] ? ` (${counts[id]})` : '');
      b.addEventListener('click', () => { status = id; redraw(); });
      return b;
    }));
    const empty = { new: 'Nothing new. When a student presses Tell Daniel, it shows here.', digging: 'Nothing marked Needs digging.', done: 'Nothing marked Dealt with yet.', all: 'No reports yet.' }[status];
    list.replaceChildren(chips, ...(reports.length ? reports.map(reportCard) : [el('p', { class: 'g-note' }, empty)]));
  }
  function reportCard(r) {
    const note = el('textarea', { class: 'g-write g-write-small', rows: 2, maxlength: 4000, placeholder: 'A note of your own (optional)', 'aria-label': `Your note on report ${r.id}` });
    note.value = r.note ?? '';
    const mark = (to, label) => act(label, () => ask({ action: 'tell_status', id: r.id, status: to, note: note.value }));
    const context = Object.entries(r.context ?? {}).filter(([, v]) => v != null && asText(v).trim());
    const copy = el('button', { type: 'button', class: 'g-link' }, 'Copy for Claude');
    copy.addEventListener('click', async () => {
      const lines = [`Student report #${r.id} (Tell Daniel), ${new Date(r.created_at).toLocaleString()}`, `From: ${r.student}${r.group ? ` (${r.group})` : ''}, on ${PLACES[r.place] ?? r.place}`,
        `Kind: ${TELL_KINDS[r.kind] ?? r.kind}`, `Their words: ${r.why || '(none)'}`, `App: ${r.app_version ?? 'unknown'}`];
      for (const [k, v] of context) lines.push('', `${LABELS[k] ?? k}:`, asText(v));
      if (note.value.trim()) lines.push('', `My note: ${note.value.trim()}`);
      if (r.diagnosis) lines.push('', `Claude's diagnosis so far: ${r.diagnosis}`);
      try { await navigator.clipboard.writeText(lines.join('\n')); copy.textContent = 'Copied'; } catch { say('This phone wouldn’t copy. Try again.'); }
    });
    return el('article', { class: 'g-post', 'data-report': r.id },
      el('span', { class: 'g-kind' }, TELL_KINDS[r.kind] ?? r.kind),
      el('header', { class: 'g-by' }, el('strong', {}, r.student), el('span', { class: 'g-when' }, `${r.group ? `${r.group} · ` : ''}on ${PLACES[r.place] ?? r.place} · ${ago(r.created_at)}`)),
      r.why ? el('p', { class: 'g-body' }, r.why) : el('p', { class: 'g-note' }, 'No words, just the kind.'),
      r.diagnosis ? el('div', { class: 'g-bubble' }, el('strong', {}, `Claude’s diagnosis · ${DIAGNOSIS[r.diagnosis_kind] ?? 'Other'}`), el('br'), r.diagnosis) : null,
      context.length ? el('details', { class: 'g-details' }, el('summary', { class: 'g-link' }, 'What came with it'),
        ...context.map(([k, v]) => el('p', { class: 'g-note' }, el('strong', {}, `${LABELS[k] ?? k}: `), asText(v)))) : null,
      note,
      el('div', { class: 'g-actions g-guide' },
        r.status !== 'new' ? mark('new', 'New') : null, r.status !== 'digging' ? mark('digging', 'Needs digging') : null,
        r.status !== 'done' ? mark('done', 'Dealt with') : null, copy));
  }

  const draws = { flags: drawFlags, people: drawPeople, reports: drawReports };
  return { postButtons, commentButtons, draw: (tab, list) => draws[tab](list) };
}
