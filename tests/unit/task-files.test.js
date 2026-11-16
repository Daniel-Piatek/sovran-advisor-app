// Files on a task (task-files.js, table task_files): the task pop-up's Files box, files kept on this computer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server.js';

test('a file goes on a task, is listed with its name and address, stays once when added twice, and comes off', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-files-test-'));
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const json = async (method, url, body) => {
    const res = await fetch(app.url + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const task = (await json('POST', '/api/tasks', { text: 'Send the brochure' })).body;
  const kept = await (await fetch(`${app.url}/api/files`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('Brochure.pdf') }, body: '%PDF-1.4 brochure' })).json();

  assert.deepEqual((await json('GET', `/api/tasks/${task.id}/files`)).body, []);
  let { status, body } = await json('POST', `/api/tasks/${task.id}/files`, { sha256: kept.sha256 });
  assert.equal(status, 200);
  assert.deepEqual(body.map((f) => [f.name, f.type, f.url]), [['Brochure.pdf', 'application/pdf', `/files/${kept.sha256}`]]);
  ({ body } = await json('POST', `/api/tasks/${task.id}/files`, { sha256: kept.sha256 }));
  assert.equal(body.length, 1);
  assert.equal((await fetch(app.url + body[0].url).then((r) => r.text())), '%PDF-1.4 brochure');

  assert.equal((await json('POST', `/api/tasks/${task.id}/files`, { sha256: 'a'.repeat(64) })).status, 404);
  assert.equal((await json('POST', '/api/tasks/00000000-0000-0000-0000-000000000000/files', { sha256: kept.sha256 })).status, 404);
  assert.equal((await json('POST', `/api/tasks/${task.id}/files`, { sha256: 'nope' })).status, 400);

  assert.equal((await json('DELETE', `/api/task-files/${body[0].id}`)).status, 200);
  assert.deepEqual((await json('GET', `/api/tasks/${task.id}/files`)).body, []);
  assert.equal((await json('DELETE', `/api/task-files/${body[0].id}`)).status, 404);
  // The file itself is still kept.
  assert.equal((await fetch(app.url + body[0].url)).status, 200);
});
