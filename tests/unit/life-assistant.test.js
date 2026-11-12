// My Life for the assistant (pkm/3, step 4): the my_life summary, read_life_item with its
// chain and open tasks, and the summary in the assistant's context on every turn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareDatabase } from '../../db.js';
import { createLifeItem, updateLifeItem, lifeSummary, lifeChains } from '../../life.js';
import { createTask, changeTask } from '../../tasks.js';
import { setModule } from '../../modules.js';
import { runTool, offeredTools } from '../../assistant-tools.js';
import { lifeContext } from '../../assistant.js';

const emptyDb = () => prepareDatabase(new DatabaseSync(':memory:'));

function myLife(db) {
  const health = createLifeItem(db, { kind: 'key_element', title: 'Health' });
  const work = createLifeItem(db, { kind: 'key_element', title: 'Work' });
  const run = createLifeItem(db, { kind: 'goal', title: 'Run a half marathon', home_id: health.id });
  const plan = createLifeItem(db, { kind: 'project', title: 'Spring training plan', home_id: health.id, serves: [run.id], outcome: 'Ready by April' });
  const habit = createLifeItem(db, { kind: 'habit', title: 'Run 3× a week', home_id: health.id, serves: [run.id] });
  const clients = createLifeItem(db, { kind: 'goal', title: 'Three retained clients', home_id: work.id });
  createLifeItem(db, { kind: 'topic', title: 'Pricing', home_id: work.id });
  const old = createLifeItem(db, { kind: 'project', title: 'Old website', home_id: work.id });
  updateLifeItem(db, old.id, { state: 'archived' });
  return { health, work, run, plan, habit, clients };
}

test('the summary: Key Elements, their active Goals with what carries them, and the active Projects and Topics', () => {
  const db = emptyDb();
  assert.equal(lifeSummary(db), '');
  myLife(db);
  const summary = lifeSummary(db);
  assert.match(summary, /Key Element “Health”:\n {2}- Goal “Run a half marathon”, carried by Project “Spring training plan”, Habit “Run 3× a week”/);
  assert.match(summary, /Goal “Three retained clients”, carried by nothing yet/);
  assert.match(summary, /Topics: “Pricing”/);
  assert.doesNotMatch(summary, /Old website/, 'archived items stay out');
  assert.doesNotMatch(lifeSummary(db, { habits: false }), /Run 3× a week/, 'Habits only with My Life in depth');
  assert.match(lifeSummary(db, { max: 20 }), /the rest: my_life/);
});

test('the chain says why an item exists: Project, Goal, Key Element', () => {
  const db = emptyDb();
  const { plan, run, health, work } = myLife(db);
  const names = (id) => lifeChains(db, id).map((c) => c.map((s) => s.title).join(' > '));
  assert.deepEqual(names(plan.id), ['Spring training plan > Run a half marathon > Health']);
  assert.deepEqual(names(run.id), ['Run a half marathon > Health']);
  assert.deepEqual(names(health.id), ['Health']);
  const loose = createLifeItem(db, { kind: 'project', title: 'Office move', home_id: work.id });
  assert.deepEqual(names(loose.id), ['Office move > Work']);
});

test('the tools: only while My Life is on; my_life and read_life_item with its chain and open tasks', () => {
  const db = emptyDb();
  const { plan } = myLife(db);
  setModule(db, 'life', false);
  assert.ok(!offeredTools(db).some((t) => t.name === 'my_life'));
  assert.throws(() => runTool(db, 'my_life', {}), (err) => err.status === 403);
  assert.equal(lifeContext(db), '');

  setModule(db, 'life', true);
  assert.ok(offeredTools(db).some((t) => t.name === 'my_life'));
  assert.ok(offeredTools(db).some((t) => t.name === 'read_life_item'));
  assert.match(runTool(db, 'my_life', {}, { readOnly: true }), /Goal “Run a half marathon”/);

  createTask(db, { text: 'Buy running shoes', home_id: plan.id, due: '2026-11-20' });
  const done = createTask(db, { text: 'Pick a race', home_id: plan.id });
  changeTask(db, done.id, { done: true });
  const read = [];
  const item = JSON.parse(runTool(db, 'read_life_item', { id: plan.id }, { readOnly: true, read: (p) => read.push(p) }));
  assert.equal(item.kind, 'Project');
  assert.equal(item.outcome, 'Ready by April');
  assert.deepEqual(item.chain, ['Project “Spring training plan” → Goal “Run a half marathon” → Key Element “Health”']);
  assert.deepEqual(item.open_tasks.map((t) => t.text), ['Buy running shoes']);
  assert.equal(item.open_tasks_count, 1);
  assert.equal(read[0].path, `/life/${plan.id}`);
  assert.throws(() => runTool(db, 'read_life_item', { id: 'nope' }), (err) => err.status === 404);
});

test('every turn the assistant is told what matters: the summary in its context, fresh', () => {
  const db = emptyDb();
  setModule(db, 'life', true);
  assert.equal(lifeContext(db), '', 'nothing while My Life is empty');
  myLife(db);
  assert.match(lifeContext(db), /My Life as it stands now[\s\S]*Goal “Three retained clients”/);
  createLifeItem(db, { kind: 'key_element', title: 'Family' });
  assert.match(lifeContext(db), /Key Element “Family”/);
});
