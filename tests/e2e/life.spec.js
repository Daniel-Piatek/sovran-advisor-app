import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const group = (page, name) => page.getByRole('region', { name, exact: true });

const listed = (page) => page.locator('.life-list .life-row-title');

test('the list reads through the Key Elements: each with its Goals, Projects and Topics under it, each with its shape', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const health = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Health' });
  for (const [kind, title, home] of [['topic', 'Pricing', work], ['project', 'Autumn workshop', work], ['goal', 'Three clients', work],
    ['topic', 'Sleep', health], ['goal', 'Run ten kilometres', health], ['project', 'Loose project', null]]) {
    await send(app, 'POST', '/api/life', { kind, title, home_id: home?.id ?? null });
  }
  await page.goto(`${app.url}/life`);
  await expect(listed(page)).toHaveText(['Health', 'Run ten kilometres', 'Sleep', 'Work', 'Three clients', 'Autumn workshop', 'Pricing', 'Loose project']);
  // Each shows its kind by its shape alone: no word after the name, so the name has room.
  await expect(page.locator('.life-tree .life-row-child')).toHaveText(['Run ten kilometres', 'Sleep', 'Three clients', 'Autumn workshop', 'Pricing']);
  await expect(page.locator('.life-tree .life-row-child .icon svg')).toHaveCount(5);
  await expect(group(page, 'Not under a Key Element').locator('.life-row-title')).toHaveText(['Loose project']);
  // Its Life card shows the same, under the Key Element.
  await expect(page.locator('.life-card', { hasText: 'Work' }).locator('.life-row-title')).toHaveText(['Three clients', 'Autumn workshop', 'Pricing']);
});

test('a Key Element card has its description, then Goals, Projects and Topics under small headings, with the notes at home; the chevron row opens it', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work', description: 'The craft and the clients' });
  await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Family' });
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Three clients', home_id: work.id });
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing', home_id: work.id });
  await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Writing', home_id: work.id });
  for (const [title, home] of [['One', goal], ['Two', goal], ['Three', topic]]) {
    await app.updateNote((await app.createNote({ title })).id, { home_id: home.id });
  }
  const deleted = await app.createNote({ title: 'Gone' });
  await app.updateNote(deleted.id, { home_id: goal.id });
  await fetch(`${app.url}/api/notes/${deleted.id}`, { method: 'DELETE' });
  await page.goto(`${app.url}/life`);
  const card = page.locator('.life-card', { hasText: 'Work' });
  await expect(card.locator('.life-card-description')).toHaveText('The craft and the clients');
  await expect(card.locator('.life-card-heading')).toHaveText(['Goals', 'Topics']); // no Projects: no heading
  await expect(card.locator('.life-row-title')).toHaveText(['Three clients', 'Pricing', 'Writing']);
  await expect(card.locator('.life-row-count')).toHaveText(['2', '1']); // only above 0, and not the deleted note
  await expect(card.locator('.life-row', { hasText: 'Writing' }).locator('.life-row-count')).toHaveCount(0);
  // Family has no description and nothing under it: no description line, no headings.
  const family = page.locator('.life-card', { hasText: 'Family' });
  await expect(family.locator('.life-card-description')).toHaveCount(0);
  await expect(family.locator('.life-card-heading')).toHaveCount(0);
  await expect(family.getByText('Nothing under it yet.')).toBeVisible();
  // The whole title row, chevron included, opens the Key Element.
  await card.locator('.life-card-title svg').last().click();
  await expect(page).toHaveURL(`${app.url}/life/${work.id}`);
});

test('an item\'s page has a one-line description right under its name, saved as you type, shown on the card', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await page.goto(`${app.url}/life/${work.id}`);
  const line = page.getByLabel('Description', { exact: true });
  await expect(line).toHaveAttribute('placeholder', 'One line about it');
  await line.fill('The craft and the clients');
  await expect(page.locator('.save-status')).toHaveText(/Saved/);
  expect((await send(app, 'GET', `/api/life/${work.id}`)).description).toBe('The craft and the clients');
  await page.goto(`${app.url}/life`);
  await expect(page.locator('.life-card-description')).toHaveText('The craft and the clients');
});

test('+ Key Element makes one and opens it; + Goal, + Project and + Topic there add into it, and all of it stays after closing the app', async ({ page, app }) => {
  await page.goto(`${app.url}/life`);
  await expect(page.getByText('Start with what is permanent: your health, your work, your family.')).toBeVisible();
  await page.getByRole('button', { name: 'Key Element', exact: true }).click();
  await page.getByLabel('New Key Element’s name').fill('Health');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/life\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Health');
  await expect(page.locator('.life-list [aria-current="page"]')).toHaveText('Health');

  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  await expect(page.getByText('Enter adds to Health · Esc stops')).toBeVisible();
  await page.getByLabel('New Goal’s name').fill('Run a half marathon');
  await page.keyboard.press('Enter');
  await expect(page.getByText('“Run a half marathon” added.')).toBeVisible();
  await expect(page.getByLabel('New Goal’s name')).toBeFocused(); // ready for the next one
  await page.getByRole('button', { name: 'Topic', exact: true }).click();
  await page.getByLabel('New Topic’s name').fill('Sleep');
  await page.keyboard.press('Enter');
  await expect(page.locator('.life-item-title')).toHaveText(['Run a half marathon', 'Sleep']);
  await expect(listed(page)).toHaveText(['Health', 'Run a half marathon', 'Sleep']);

  await page.close();
  const again = await page.context().newPage();
  await again.goto(`${app.url}/life`);
  await expect(listed(again)).toHaveText(['Health', 'Run a half marathon', 'Sleep']);
  const card = again.locator('.life-card', { hasText: 'Health' });
  await expect(card.locator('.life-row-title')).toHaveText(['Run a half marathon', 'Sleep']);
  await card.getByRole('link', { name: 'Run a half marathon' }).click();
  await expect(again).toHaveURL(/\/life\/[0-9a-f-]{36}$/);
  await expect(again.locator('.life-top-kind')).toHaveText('Goal in Health');
});

test('n adds a Key Element; Not under a Key Element and Archived fold and stay folded; / filters the list by name', async ({ page, app }) => {
  const health = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Health' });
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Healthy sleep', home_id: work.id });
  await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Running', home_id: health.id });
  await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing' });
  await page.goto(`${app.url}/life`);
  const loose = group(page, 'Not under a Key Element');
  await expect(loose.locator('.life-row-title')).toHaveText(['Pricing']);
  await page.keyboard.press('n');
  await expect(page.getByLabel('New Key Element’s name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Key Element', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Not under a Key Element/ }).click();
  await expect(loose.locator('.life-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Not under a Key Element/ })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(listed(page)).toHaveText(['Health', 'Running', 'Work', 'Healthy sleep']);

  // A Key Element that fits shows all it holds; otherwise only what fits, under its Key Element.
  await page.keyboard.press('/');
  await expect(page.getByLabel('Filter My Life by name')).toBeFocused();
  await page.keyboard.type('heal');
  await expect(listed(page)).toHaveText(['Health', 'Running', 'Work', 'Healthy sleep']);
  await page.keyboard.type('thy');
  await expect(listed(page)).toHaveText(['Work', 'Healthy sleep']);
  await expect(loose).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(listed(page)).toHaveText(['Health', 'Running', 'Work', 'Healthy sleep']);
});

test('deleting an item can be undone, and it waits in Recently deleted', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await page.goto(`${app.url}/life/${work.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/life$/);
  await expect(page.getByText('“Work” deleted.')).toBeVisible();
  await expect(page.locator('.life-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.life-card-title')).toHaveText(['Work']);

  await send(app, 'DELETE', `/api/life/${work.id}`);
  await page.goto(`${app.url}/deleted`);
  const row = page.locator('.deleted-row', { hasText: 'Work' });
  await expect(row.locator('.tag')).toHaveText('Key Element');
  await row.getByRole('button', { name: 'Restore' }).click();
  await page.goto(`${app.url}/life`);
  await expect(page.locator('.life-card-title')).toHaveText(['Work']);
});

test('a Project\'s top line says which Key Element it is in, opens it, and follows the Key Element choice in Details; Serves and Carried by link both ways', async ({ page, app }) => {
  const health = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Health' });
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Run a half marathon', home_id: health.id });
  const plan = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Spring training plan' });
  await page.goto(`${app.url}/life/${plan.id}`);
  const kind = page.locator('.life-top-kind');
  await expect(kind).toHaveText('Project · not under a Key Element');
  await expect(kind.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Why it exists' })).toHaveCount(0); // the chain is gone
  await expect(page.locator('.contact-sub')).toHaveCount(0); // and so is the sub line
  const details = section(page, 'Details');
  await details.getByLabel('Key Element', { exact: true }).selectOption({ label: 'Health' });
  await expect(kind).toHaveText('Project in Health'); // at once
  await details.getByLabel('Add a Goal it serves').selectOption({ label: 'Run a half marathon' });
  await expect(page.getByRole('status')).toHaveText('Saved');
  await details.getByLabel('Key Element', { exact: true }).selectOption({ label: 'Work' });
  await expect(kind).toHaveText('Project in Work');
  await details.getByLabel('Key Element', { exact: true }).selectOption({ label: 'Health' });
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.reload();
  await expect(kind).toHaveText('Project in Health');
  // Serves: the Goal opens, and its Carried by lists the Project, which opens back.
  await section(page, 'Details').getByRole('link', { name: 'Run a half marathon' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Run a half marathon');
  await expect(page.locator('.life-top-kind')).toHaveText('Goal in Health');
  const carried = section(page, 'Details').locator('.life-under .life-item-row');
  await expect(carried).toHaveText(['Spring training plan']);
  await expect(section(page, 'Details').getByRole('heading', { name: 'Carried by' })).toBeVisible();
  await carried.click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Spring training plan');
  // The Key Element in the top line opens it, and it lists both.
  await page.locator('.life-top-kind').getByRole('link', { name: 'Health' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Health');
  await expect(page.locator('.life-top-kind')).toHaveText('Key Element');
  await expect(page.locator('.life-item-title')).toHaveText(['Run a half marathon', 'Spring training plan']);

  // Taking the Goal off the Project empties Carried by.
  await page.locator('.life-item-row', { hasText: 'Spring training plan' }).click();
  await page.getByRole('button', { name: 'Take Run a half marathon off' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.goto(`${app.url}/life/${(await send(app, 'GET', '/api/life')).find((i) => i.title === 'Run a half marathon').id}`);
  await expect(section(page, 'Details').getByText('No Project serves it yet.')).toBeVisible();
});

test('each kind keeps the fields the ICOR Methodology asks of it', async ({ page, app }) => {
  const made = {};
  for (const [kind, title] of [['key_element', 'Work'], ['goal', 'Three clients'], ['project', 'Workshop'], ['topic', 'Pricing']]) {
    made[kind] = await send(app, 'POST', '/api/life', { kind, title });
  }
  const fill = async (kind, values) => {
    await page.goto(`${app.url}/life/${made[kind].id}`);
    for (const [label, value] of Object.entries(values)) {
      const input = page.getByLabel(label, { exact: true });
      if (await input.evaluate((node) => node.tagName === 'SELECT')) await input.selectOption({ label: value });
      else await input.fill(value);
    }
    await expect(page.getByRole('status')).toHaveText('Saved');
  };
  const check = async (kind, values) => {
    await page.goto(`${app.url}/life/${made[kind].id}`);
    for (const [label, value] of Object.entries(values)) {
      const input = page.getByLabel(label, { exact: true });
      if (await input.evaluate((node) => node.tagName === 'SELECT')) await expect(input.locator('option:checked')).toHaveText(value);
      else await expect(input).toHaveValue(value);
    }
  };
  const fields = {
    key_element: { 'Not this': 'Not my whole identity.' },
    goal: { 'The goal': 'Three clients who stay a year.', Horizon: 'This year', 'Shipped means': 'Three signed renewals.', Why: 'Calm income.' },
    project: { Outcome: 'A workshop people book again.', 'Done means': 'Run twice.', Start: '2026-11-01', End: '2027-01-31' },
    topic: { Pulse: 'Testing a higher day rate.', Depth: 'Deep' },
  };
  for (const [kind, values] of Object.entries(fields)) await fill(kind, values);
  for (const [kind, values] of Object.entries(fields)) await check(kind, values);
});

test('archiving moves an item to Archived, and Bring back returns it', async ({ page, app }) => {
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing' });
  await page.goto(`${app.url}/life/${topic.id}`);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.life-top .tag')).toHaveText('archived');
  await expect(group(page, 'Not under a Key Element')).toBeHidden();
  await page.getByRole('button', { name: /^Archived/ }).click();
  await expect(group(page, 'Archived').locator('.life-row-title')).toHaveText(['Pricing']);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await page.getByRole('button', { name: 'Bring back' }).click();
  await expect(page.locator('.life-top .tag')).toBeHidden();
  await expect(group(page, 'Not under a Key Element').locator('.life-row-title')).toHaveText(['Pricing']);
});

test('a thinking space keeps what you write, and [[ links to and from My Life work like in notes', async ({ page, app }) => {
  const workshop = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Autumn workshop' });
  const ideas = await app.createNote({ title: 'Ideas for the autumn workshop' });
  await page.goto(`${app.url}/life/${workshop.id}`);
  const space = page.getByLabel('Thinking space');
  await space.click();
  await page.keyboard.type('Start small, see ');
  await page.keyboard.type('[[ideas f');
  await expect(page.getByRole('option', { name: /Ideas for the autumn workshop/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(space.locator('.page-link')).toHaveText('▭Ideas for the autumn workshop');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Thinking space')).toContainText('Start small, see');
  await expect(page.getByText('Nothing links here yet.')).toBeVisible();

  // From the note: [[ finds the Project, with its flag, and the link shows on its page.
  await page.goto(`${app.url}/notes/${ideas.id}`);
  await expect(page.getByRole('region', { name: 'Linked from' }).locator('.linked-from-row')).toContainText('Autumn workshop');
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('For [[autumn w');
  const option = page.getByRole('option', { name: /Autumn workshop/ }).first();
  await expect(option).toContainText('project');
  await expect(option.locator('.link-menu-life svg')).toBeVisible();
  await page.keyboard.press('Enter');
  const link = page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link');
  await expect(link).toHaveText('Autumn workshop');
  await expect(link.locator('.page-link-life svg')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/life/${workshop.id}$`));
  await expect(page.getByRole('region', { name: 'Linked from' }).locator('.linked-from-row')).toContainText('Ideas for the autumn workshop');
});

const section = (page, name) => page.getByRole('region', { name, exact: true });

test('a Key Element\'s page: a top line, the name and its line, then Goals, Projects and Topics with counts and descriptions, an archived tag, and empty ones saying so', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work', description: 'The craft and the clients' });
  await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Three clients', description: 'Who stay a year', home_id: work.id });
  await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Write a book', home_id: work.id });
  const old = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Old pricing', home_id: work.id });
  await send(app, 'PATCH', `/api/life/${old.id}`, { state: 'archived' });
  await page.goto(`${app.url}/life/${work.id}`);
  const top = page.locator('.life-top');
  await expect(top).toContainText('Key Element');
  await expect(top.getByRole('link', { name: 'Back to My Life' })).toBeVisible();
  await expect(top.getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(top.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(page.locator('.contact-sub')).toHaveCount(0); // the old sub line is gone
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Work');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('The craft and the clients');

  await expect(section(page, 'Goals').getByRole('heading')).toHaveText('Goals · 2');
  await expect(section(page, 'Projects').getByRole('heading')).toHaveText('Projects · 0');
  await expect(section(page, 'Topics').getByRole('heading')).toHaveText('Topics · 1');
  await expect(section(page, 'Goals').locator('.life-item-title')).toHaveText(['Three clients', 'Write a book']);
  await expect(section(page, 'Goals').locator('.life-item-sub')).toHaveText(['Who stay a year']); // only where there is one
  await expect(section(page, 'Projects').getByText('No Projects here yet.')).toBeVisible();
  await expect(section(page, 'Topics').locator('.life-item-title .tag')).toHaveText('archived');
  await expect(section(page, 'Topics').getByRole('link', { name: /Old pricing/ })).toBeVisible();
  // The whole row opens the item.
  await section(page, 'Goals').locator('.life-item-row', { hasText: 'Three clients' }).locator('.life-item-sub').click();
  await expect(page).toHaveURL(/\/life\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Three clients');
  // Archiving a Key Element shows on its top line.
  await page.goBack();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.life-top .tag')).toHaveText('archived');
  await page.getByRole('button', { name: 'Bring back' }).click();
  await expect(page.locator('.life-top .tag')).toBeHidden();
});

test('each section adds into its Key Element with its own button, the field stays for the next, and Esc stops', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await page.goto(`${app.url}/life/${work.id}`);
  for (const [one, many, names] of [['Goal', 'Goals', ['One', 'Two']], ['Project', 'Projects', ['Alpha']], ['Topic', 'Topics', ['Pricing']]]) {
    await section(page, many).getByRole('button', { name: one, exact: true }).click();
    for (const name of names) {
      await page.getByLabel(`New ${one}’s name`).fill(name);
      await page.keyboard.press('Enter');
      await expect(page.getByText(`“${name}” added.`)).toBeVisible();
      await expect(page.getByLabel(`New ${one}’s name`)).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByLabel(`New ${one}’s name`)).toHaveCount(0);
    await expect(section(page, many).getByRole('heading')).toHaveText(`${many} · ${names.length}`);
    await expect(section(page, many).locator('.life-item-title')).toHaveText(names);
  }
  await expect(listed(page)).toHaveText(['Work', 'One', 'Two', 'Alpha', 'Pricing']);
  const made = (await send(app, 'GET', '/api/life')).filter((i) => i.home_id === work.id).map((i) => `${i.kind}:${i.title}`).sort();
  expect(made).toEqual(['goal:One', 'goal:Two', 'project:Alpha', 'topic:Pricing']);
});

test('a Key Element lists the notes and open tasks at home in it and in what is under it, each saying where it is at home', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const other = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Family' });
  const project = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Nordlicht onboarding', home_id: work.id });
  const elsewhere = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Kitchen', home_id: other.id });
  const kickoff = await app.createNote({ title: 'Kick-off', body: '- [ ] book the room' });
  await app.updateNote(kickoff.id, { home_id: project.id });
  const mine = await app.createNote({ title: 'Work principles' });
  await app.updateNote(mine.id, { home_id: work.id });
  await app.updateNote((await app.createNote({ title: 'Tiles', body: '- [ ] choose tiles' })).id, { home_id: elsewhere.id });
  const task = (body) => send(app, 'POST', '/api/tasks', body);
  await task({ text: 'send the welcome pack', home_id: project.id, flag: 'must' });
  await task({ text: 'review the year', home_id: work.id });
  await task({ text: 'order the cupboards', home_id: elsewhere.id });

  await page.goto(`${app.url}/life/${work.id}`);
  const notes = section(page, 'Notes at home here');
  await expect(notes.getByRole('heading')).toHaveText('Notes at home here · 2');
  await expect(notes.locator('.life-item-row')).toHaveCount(2);
  await expect(notes.locator('.life-item-row', { hasText: 'Kick-off' }).locator('.life-item-sub')).toHaveText('Nordlicht onboarding · Today');
  await expect(notes.locator('.life-item-row', { hasText: 'Work principles' }).locator('.life-item-sub')).toHaveText('Work · Today');
  await expect(notes.locator('.life-item-row').locator('svg').first()).toBeVisible(); // the note icon
  await notes.getByRole('link', { name: /Kick-off/ }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${kickoff.id}$`));
  await page.goBack();

  const open = section(page, 'Open tasks');
  await expect(open.getByRole('heading')).toHaveText('Open tasks · 3');
  await expect(open.locator('.task-row')).toHaveCount(3);
  const row = (text) => open.locator('.task-row', { hasText: text });
  await expect(row('send the welcome pack').locator('.task-source')).toHaveText('Nordlicht onboarding'); // its home
  await expect(row('send the welcome pack').locator('.task-words')).toContainText('Must');
  await expect(row('book the room').locator('.task-source')).toHaveText(['▭Kick-off', 'Nordlicht onboarding']); // where it lives, then its home
  await expect(row('review the year').locator('.task-source')).toHaveCount(0); // at home in this Key Element itself
  await expect(page.getByText('order the cupboards')).toHaveCount(0);
  await expect(page.getByText('choose tiles')).toHaveCount(0);
  // Ticking works as on other pages; a task added here is at home in the Key Element.
  await row('review the year').getByRole('checkbox').click();
  await expect(open.getByRole('heading')).toHaveText('Open tasks · 2 · 1 done');
  await open.getByLabel('Add a task').fill('plan next quarter');
  await page.keyboard.press('Enter');
  await expect(row('plan next quarter')).toBeVisible();
  const added = (await send(app, 'GET', '/api/tasks')).find((t) => t.text === 'plan next quarter');
  expect(added.home.id).toBe(work.id);

  // A Project's own page is as before: only what is at home in it.
  await page.goto(`${app.url}/life/${project.id}`);
  await expect(section(page, 'Notes at home here').getByRole('heading')).toHaveText('Notes at home here · 1');
  await expect(section(page, 'Open tasks').locator('.task-row .task-words')).toHaveText(['book the room', 'Mustsend the welcome pack']);
});

test('a Key Element\'s notes show the first twenty, newest first, then Show more', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing', home_id: work.id });
  for (let i = 1; i <= 22; i++) await app.updateNote((await app.createNote({ title: `Note ${i}` })).id, { home_id: i % 2 ? topic.id : work.id });
  await page.goto(`${app.url}/life/${work.id}`);
  const notes = section(page, 'Notes at home here');
  await expect(notes.getByRole('heading')).toHaveText('Notes at home here · 22');
  await expect(notes.locator('.life-item-row')).toHaveCount(20);
  await expect(notes.locator('.life-item-title').first()).toHaveText('Note 22');
  await notes.getByRole('button', { name: 'Show more (2)' }).click();
  await expect(notes.locator('.life-item-title')).toHaveCount(22);
  await expect(notes.locator('.life-item-title').last()).toHaveText('Note 1');
});

test('Details keeps Not this, the thinking space and Linked from, and they save', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await page.goto(`${app.url}/life/${work.id}`);
  const details = section(page, 'Details');
  await expect(details.getByRole('heading', { name: 'Details' })).toBeVisible();
  await details.getByLabel('Not this', { exact: true }).fill('Not my whole identity.');
  const space = details.getByLabel('Thinking space');
  await space.click();
  await page.keyboard.type('What work is for');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(section(page, 'Details').getByLabel('Not this', { exact: true })).toHaveValue('Not my whole identity.');
  await expect(section(page, 'Details').getByLabel('Thinking space')).toContainText('What work is for');
  const saved = await send(app, 'GET', `/api/life/${work.id}`);
  expect(saved.not_this).toBe('Not my whole identity.');
  expect(saved.body).toContain('What work is for');
  await expect(section(page, 'Details').getByRole('region', { name: 'Linked from' })).toBeVisible();
  await expect(section(page, 'Details').getByText('Nothing links here yet.')).toBeVisible();
});

for (const width of [800, 1280]) {
  test(`a Key Element's page fits at ${width} px: nothing sticks out the side, task rows keep room for their words`, async ({ page, app }) => {
    const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work', description: 'A line that is long enough to need more than one line when the column is narrow, as a real one may be' });
    const project = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Nordlicht onboarding with a rather long name', home_id: work.id });
    const note = await app.createNote({ title: 'Kick-off', body: '- [ ] book the room at the venue for the whole team' });
    await app.updateNote(note.id, { home_id: project.id });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app.url}/life/${work.id}`);
    await expect(page.locator('.task-row')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const words = await page.locator('.life-section .task-words').boundingBox();
    expect(words.width).toBeGreaterThan(150);
  });
}

test('a Goal, a Project and a Topic read like a Key Element: a top line, the name and its line, notes, open tasks, then Details, in that order', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const made = {};
  for (const [kind, title] of [['goal', 'Three clients'], ['project', 'Autumn workshop'], ['topic', 'Pricing']]) {
    made[kind] = await send(app, 'POST', '/api/life', { kind, title, description: `About ${title}`, home_id: work.id });
  }
  for (const [kind, one] of [['goal', 'Goal'], ['project', 'Project'], ['topic', 'Topic']]) {
    await page.goto(`${app.url}/life/${made[kind].id}`);
    const top = page.locator('.life-top');
    await expect(top.getByRole('link', { name: 'Back to My Life' })).toBeVisible();
    await expect(top.locator('.life-top-kind')).toHaveText(`${one} in Work`);
    await expect(top.locator('.life-top-kind svg').first()).toBeVisible(); // the kind's shape
    await expect(top.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(top.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(made[kind].title);
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(`About ${made[kind].title}`);
    // Notes, then open tasks, then Details, under the name and its line; no Goals/Projects/Topics sections.
    const regions = await page.locator('.life-main section[aria-label]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
    expect(regions).toEqual(['Notes at home here', 'Open tasks', 'Details', 'Linked from']);
    await expect(section(page, 'Notes at home here').getByText('No notes here yet.')).toBeVisible();
    await expect(section(page, 'Open tasks').getByRole('heading')).toHaveText('Open tasks · 0');
    await expect(section(page, 'Details').getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(section(page, 'Details').getByLabel('Thinking space')).toBeVisible();
    await expect(section(page, 'Details').getByRole('region', { name: 'Linked from' })).toBeVisible();
  }
});

test('a Goal\'s page lists its notes in framed rows (title and day only), and its open tasks, which tick and can be added there', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Three clients', home_id: work.id });
  const other = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Write a book', home_id: work.id });
  const meeting = await app.createNote({ title: 'Client call', body: '- [ ] send the offer' });
  await app.updateNote(meeting.id, { home_id: goal.id });
  await app.updateNote((await app.createNote({ title: 'Outline' })).id, { home_id: other.id });
  await send(app, 'POST', '/api/tasks', { text: 'ask for a referral', home_id: goal.id, flag: 'must' });
  await send(app, 'POST', '/api/tasks', { text: 'draft chapter one', home_id: other.id });

  await page.goto(`${app.url}/life/${goal.id}`);
  const notes = section(page, 'Notes at home here');
  await expect(notes.getByRole('heading')).toHaveText('Notes at home here · 1');
  await expect(notes.locator('.life-frame .life-item-row')).toHaveCount(1);
  await expect(notes.locator('.life-item-title')).toHaveText('Client call');
  await expect(notes.locator('.life-item-sub')).toHaveText('Today'); // no home named: it is this page
  await expect(notes.locator('.life-item-row svg').first()).toBeVisible(); // the note icon
  await notes.getByRole('link', { name: /Client call/ }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${meeting.id}$`));
  await page.goBack();

  const open = section(page, 'Open tasks');
  await expect(open.getByRole('heading')).toHaveText('Open tasks · 2');
  await expect(open.locator('.task-rows')).toHaveCSS('border-top-width', '1px'); // framed, like the Key Element's
  await expect(open.locator('.task-row .task-words')).toHaveText(['send the offer', 'Mustask for a referral']);
  await expect(open.locator('.task-row .task-box').first()).toBeVisible(); // the app's own square checkbox
  await expect(open.locator('.task-row', { hasText: 'ask for a referral' }).locator('.task-source')).toHaveCount(0);
  await expect(page.getByText('draft chapter one')).toHaveCount(0);
  await open.locator('.task-row', { hasText: 'ask for a referral' }).getByRole('checkbox').click();
  await expect(open.getByRole('heading')).toHaveText('Open tasks · 1 · 1 done');
  await open.getByLabel('Add a task').fill('book a call');
  await page.keyboard.press('Enter');
  await expect(open.locator('.task-row', { hasText: 'book a call' })).toBeVisible();
  const added = (await send(app, 'GET', '/api/tasks')).find((t) => t.text === 'book a call');
  expect(added.home.id).toBe(goal.id);
});

test('a Topic\'s notes show the first twenty, newest first, then Show more', async ({ page, app }) => {
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing' });
  for (let i = 1; i <= 22; i++) await app.updateNote((await app.createNote({ title: `Note ${i}` })).id, { home_id: topic.id });
  await page.goto(`${app.url}/life/${topic.id}`);
  const notes = section(page, 'Notes at home here');
  await expect(notes.getByRole('heading')).toHaveText('Notes at home here · 22');
  await expect(notes.locator('.life-item-row')).toHaveCount(20);
  await expect(notes.locator('.life-item-title').first()).toHaveText('Note 22');
  await notes.getByRole('button', { name: 'Show more (2)' }).click();
  await expect(notes.locator('.life-item-title')).toHaveCount(22);
  await expect(notes.locator('.life-item-title').last()).toHaveText('Note 1');
});

test('Details of a Goal holds its fields, Carried by and the thinking space; of a Project its Serves; of a Topic Pulse and Depth, and Linked from', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Three clients', home_id: work.id });
  const project = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Autumn workshop', home_id: work.id, serves: [goal.id] });
  await send(app, 'POST', '/api/life', { kind: 'project', title: 'Old workshop', home_id: work.id, serves: [goal.id] })
    .then((old) => send(app, 'PATCH', `/api/life/${old.id}`, { state: 'archived' }));
  const topic = await send(app, 'POST', '/api/life', { kind: 'topic', title: 'Pricing', home_id: work.id });

  await page.goto(`${app.url}/life/${goal.id}`);
  let details = section(page, 'Details');
  for (const label of ['Key Element', 'The goal', 'Horizon', 'Shipped means', 'Why']) await expect(details.getByLabel(label, { exact: true })).toBeVisible();
  // Carried by: framed rows that open the Project, an archived one marked as such.
  await expect(details.locator('.life-under .life-item-title')).toHaveText(['Autumn workshop', /^Old workshop/]);
  await expect(details.locator('.life-under .tag')).toHaveText('archived');
  await expect(details.getByRole('heading', { name: 'Carried by' })).toBeVisible();
  await details.getByLabel('The goal', { exact: true }).fill('Three who stay');
  const space = details.getByLabel('Thinking space');
  await space.click();
  await page.keyboard.type('Referrals first');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await details.locator('.life-under .life-item-row', { hasText: 'Autumn workshop' }).click();

  details = section(page, 'Details');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Autumn workshop');
  for (const label of ['Key Element', 'Outcome', 'Done means', 'Start', 'End', 'Add a Goal it serves']) await expect(details.getByLabel(label, { exact: true })).toBeVisible();
  await expect(details.locator('.life-serves-goal')).toHaveText('Three clients×');

  await page.goto(`${app.url}/life/${topic.id}`);
  details = section(page, 'Details');
  for (const label of ['Key Element', 'Pulse', 'Depth']) await expect(details.getByLabel(label, { exact: true })).toBeVisible();
  await expect(details.getByRole('region', { name: 'Linked from' })).toBeVisible();

  await page.goto(`${app.url}/life/${goal.id}`);
  await expect(section(page, 'Details').getByLabel('The goal', { exact: true })).toHaveValue('Three who stay');
  await expect(section(page, 'Details').getByLabel('Thinking space')).toContainText('Referrals first');
});

for (const width of [800, 1280]) {
  test(`a Goal's and a Project's page fit at ${width} px: nothing sticks out the side, task rows keep room for their words`, async ({ page, app }) => {
    const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work with a rather long name that has to wrap somewhere' });
    const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Three clients who stay for at least a whole year, signed', description: 'A line that is long enough to need more than one line when the column is narrow', home_id: work.id });
    const project = await send(app, 'POST', '/api/life', { kind: 'project', title: 'Nordlicht onboarding with a rather long name', home_id: work.id, serves: [goal.id] });
    const note = await app.createNote({ title: 'Kick-off', body: '- [ ] book the room at the venue for the whole team' });
    await app.updateNote(note.id, { home_id: goal.id });
    await app.updateNote((await app.createNote({ title: 'Plan', body: '- [ ] book the room at the venue for the whole team' })).id, { home_id: project.id });
    await page.setViewportSize({ width, height: 900 });
    for (const item of [goal, project]) {
      await page.goto(`${app.url}/life/${item.id}`);
      await expect(page.locator('.task-row')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const words = await page.locator('.life-section .task-words').boundingBox();
      expect(words.width).toBeGreaterThan(150);
    }
  });
}

test('Overview, in the list\'s heading, opens the overview from an item\'s page and shows as current on it', async ({ page, app }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  await page.goto(`${app.url}/life/${work.id}`);
  const overview = page.getByRole('link', { name: 'Overview', exact: true });
  await expect(page.locator('.life-list-title')).toHaveCount(0); // the name is on the page beside, not over the list (2026-11-10)
  await expect(overview).not.toHaveAttribute('aria-current', 'page');
  await overview.click();
  await expect(page).toHaveURL(`${app.url}/life`);
  await expect(overview).toHaveAttribute('aria-current', 'page');
  // The overview's top line: the title, the muted line, and the page's one accent.
  const top = page.locator('.life-overview-top');
  await expect(top.getByRole('heading', { name: 'My Life', exact: true })).toBeVisible();
  await expect(top.locator('.life-overview-line')).toHaveText('Key Elements with their Goals, Projects and Topics');
  await expect(top.getByRole('button', { name: 'New Key Element' })).toBeVisible();
});

test('on a large screen the list and the page are two panels on the grey; on a phone there are none', async ({ page, app, isMobile }) => {
  const work = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Work' });
  const look = (selector) => page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopWidth, radius: style.borderTopLeftRadius, background: style.backgroundColor };
  });
  const colour = (name) => page.evaluate((v) => {
    const probe = document.createElement('i'); probe.style.background = `var(${v})`; document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
  }, name);
  for (const path of ['/life', `/life/${work.id}`]) {
    await page.goto(app.url + path);
    await expect(page.locator('.life-list')).toBeVisible();
    const listLook = await look('.life-list');
    const mainLook = await look('.life-main');
    if (isMobile) {
      for (const panel of [listLook, mainLook]) expect(panel.border).toBe('0px');
      expect(await look('.page')).toMatchObject({ background: await colour('--color-bg') });
    } else {
      // Each panel wears the section's line along its top (2026-11-09).
      for (const panel of [listLook, mainLook]) expect(panel).toEqual({ border: '3px', radius: await page.evaluate(() => { const p = document.createElement('i'); p.style.borderRadius = 'var(--radius-md)'; document.body.append(p); const r = getComputedStyle(p).borderTopLeftRadius; p.remove(); return r; }), background: await colour('--color-bg') });
      // No outer panel: the screen itself has no border and no fill, the grey of the frame shows between the panels.
      expect(await look('.page')).toMatchObject({ border: '0px', background: 'rgba(0, 0, 0, 0)' });
      const [a, b] = await Promise.all([page.locator('.life-list').boundingBox(), page.locator('.life-main').boundingBox()]);
      expect(b.x).toBeGreaterThan(a.x + a.width);
    }
  }
});
