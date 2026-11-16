// Files on a task (schema.sql, table task_files): a PDF, screenshot or any other file added in the task pop-up.
// The file itself is kept like a file pasted into a note (files.js): once, in the data folder on this computer,
// named by its fingerprint. A row here only says "this file belongs to this task". Taking a file off a task marks
// the row deleted; the file itself stays (files.js never removes one).

import { randomUUID } from 'node:crypto';
import { urlOf } from './files.js';

const now = () => new Date().toISOString();

// The files on one task, oldest first, each with its name, type, size and address.
export function listTaskFiles(db, taskId) {
  return db.prepare(`SELECT tf.id, tf.created_at, f.sha256, f.name, f.type, f.size
    FROM task_files tf JOIN files f ON f.sha256 = tf.sha256
    WHERE tf.task_id = ? AND tf.deleted_at IS NULL AND f.deleted_at IS NULL
    ORDER BY tf.created_at, tf.rowid`).all(taskId).map((row) => ({ ...row, url: urlOf(row.sha256) }));
}

// Put a kept file on a task. The same file twice on one task is one row. Answers the task's files, or null
// when there is no such task or file.
export function addTaskFile(db, taskId, sha256) {
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ? AND deleted_at IS NULL').get(taskId)) return null;
  if (!db.prepare('SELECT 1 FROM files WHERE sha256 = ? AND deleted_at IS NULL').get(sha256)) return null;
  const there = db.prepare('SELECT 1 FROM task_files WHERE task_id = ? AND sha256 = ? AND deleted_at IS NULL').get(taskId, sha256);
  if (!there) {
    const at = now();
    db.prepare('INSERT INTO task_files (id, created_at, updated_at, task_id, sha256) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), at, at, taskId, sha256);
  }
  return listTaskFiles(db, taskId);
}

// Take a file off its task. Answers true when it was there.
export function removeTaskFile(db, id) {
  const at = now();
  return db.prepare('UPDATE task_files SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(at, at, id).changes > 0;
}
