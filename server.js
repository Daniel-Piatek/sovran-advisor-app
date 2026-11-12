// The app's server: serves the web page from public/, keeps data in one SQLite file
// and answers the page's requests for notes (notes.js).
// Settings come from the environment:
//   PORT      port to listen on (default 3300; 0 picks any free port)
//   DATA_DIR  folder for the database file (default ./data)
//   HOSTS     other names the app may be opened by, comma-separated: the private
//             Tailscale address (my-mac.tail1234.ts.net) that brings it to the owner's
//             own devices. The server itself still listens only on this computer.
//             The same names may sit in data/hosts.txt, one a line (hostsFile).

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import {
  checkNoteInput, createNote, getNote, listNotes, listDeletedNotes, searchNotes, updateNote, deleteNote, restoreNote,
  notesAtHome,
} from './notes.js';
import {
  localDay, isDay, listJournals, createJournal, deleteJournal, checkEntryInput, createEntry, getEntry,
  entriesOfDay, entriesBefore, entryDays, updateEntry, deleteEntry, restoreEntry, listDeletedEntries, searchEntries,
} from './entries.js';
import { storeFile, getFile, filesDir, showsInline } from './files.js';
import {
  checkCaptureInput, createCapture, getCapture, waitingCaptures, waitingCount, updateCapture, sortCapture, letGo,
  undoCapture, listDeletedCaptures, checkCaptureChange, homeOf, snoozeCapture, setWorld, snoozedCaptures, doneCaptures, captureCounts,
} from './captures.js';
import { readLink, fetchTitle } from './link-titles.js';
import { linkedFrom, linkTarget, suggestLinks } from './links.js';
import { listModules, checkModuleInput, setModule, moduleOn } from './modules.js';
import { createGoogleEvent, answerGoogleEvent, changeGoogleEvent, sendDue as sendGoogleCalendar, resolveClash as resolveGoogleClash, retryChange, listOutbox as listGoogleOutbox, getGuards, setGuards, startGoogleCalendarSend } from './gcal-write.js';
import { readGoogleCalendar, startGoogleCalendarRead, writableCalendars, googleCalendarState, googleCalendarJob, googleCalendarSendJob } from './gcal.js';
import { checkTemplateInput, listTemplates, createTemplate, removeTemplate, restoreTemplate, placeTemplate } from './templates.js';
import { listDevices, addDevice, revokeDevice, deviceForToken, checkShareInput, shareCapture } from './capture-devices.js';
import { fillFromGmail, countCheck, canRead } from './gmail.js';
import { inboxView, explainThread, describeSplits, SPLIT_IDS } from './mail-splits.js';
import { saveDraft, listDrafts, getDraft, discardDraft, restoreDraft } from './mail-drafts.js';
import { peopleOfThread, addSender, mailWith } from './mail-people.js';
import { createBoard, getBoard, renameBoard, setBackground, addItem, changeItem, removeItem } from './boards.js';
import { addStroke, removeStroke, strokesToText } from './ink.js';
import { listVersions, getVersion, compareVersions, latestVersion } from './versions.js';
import { saveWithMerge, listClashes, resolveClash, takeClashNotes } from './merge.js';
import { createComment, replyTo, listThreads as listCommentThreads, changeComment, deleteComment, getComment, askText } from './comments.js';
import { listBlocks, setFolded, searchBullets, bulletDetail, usedIn } from './blocks.js';
import { invitesOfThread, answerInvite, undoAnswer, PARTSTAT } from './invite.js';
import { mailToTask, tasksOf, describeLimits, LIMITS, draftsToday } from './mail-assistant.js';
import { getAction, markCardEdited } from './assistant-tools.js';
import { pixelBase, setPixelBase, recordOpen, confirmationsOf, listPeople as confirmPeople, PIXEL } from './mail-confirm.js';
import { canSend, composeSend, undoSend, listSends, replyDraft, sendDue, remindDue, settleSends, startMailSender, pendingSends, sendNow, retrySend, dismissSend } from './mail-send.js';
import { syncOnce, setLive, syncState, changeLabels, listOutbox, startMailSync, archiveThread, restoreToInbox, trashThread, restoreFromTrash, pendingChanges, retryMailChange, dismissMailChange } from './mail-sync.js';
import { importMboxStream, settleImports, mailOverview, listThreads, getThread, checkAccountEmail, setImagesOk, listSenders } from './mail.js';
import {
  defaultKeyStore, getGoogle, saveClient, removeClient, beginSignIn, finishSignIn, switchPermission, checkHealth, disconnect,
} from './google.js';
import { timeline, checkTimelineQuery } from './timeline.js';
import { importContacts } from './import-contacts.js';
import { importObsidian, importDayOne, listRuns } from './import-notes.js';
import { keyterms, fixes, listGlossary, addGlossary, deleteGlossary, restoreGlossary, checkGlossaryInput } from './glossary.js';
import { localStatus, prepareLocal, hearPiece, samplesOf } from './voice-local.js';
import { callSettings, setCallSettings, speak, warmCall, routeTurn, checkTurnInput, addTurn, callMarks, callStats, logVoice, listVoiceLog } from './call.js';
import { startSession, hasKey, getDictationSettings, setHoldKey, saveKey, removeKey, checkDictationInput, addDictation, listDictations } from './dictation.js';
import { findDuplicates, dismissDuplicate, mergePeople } from './merge-people.js';
import { reconnectList, remindToReconnect } from './reconnect.js';
import { checkInteractionInput, logInteraction, deleteInteraction, restoreInteraction } from './interactions.js';
import {
  listTasks, checkTaskInput, createTask, changeTask, deleteTask, restoreTask, listDeletedTasks, dueReminders, changeReminder, listReminders,
} from './tasks.js';
import {
  checkEventInput, createEvent, getEvent, updateEvent, eventsBetween, deleteEvent, restoreEvent, listDeletedEvents,
} from './events.js';
import {
  checkCalendarInput, listCalendars, addCalendar, updateCalendar, removeCalendar, restoreCalendar, readCalendar,
  readAllCalendars, calendarJob, calendarEventsBetween, READ_EVERY_MS, ownColour, setOwnColour, ownEvent,
} from './calendars.js';
import { noteAboutEvent, withNotes, eventAt } from './event-notes.js';
import {
  getSettings, checkSettingsInput, updateSettings, checkBlockInput, createBlock, updateBlock, deleteBlock, restoreBlock,
  plannerDay, plannerWeek, setHighlight, getFlow, setFlowStep, FLOWS,
} from './planner.js';
import {
  checkCloseInput, closeDay, reopenDay, dayClose, weekReview, checkReviewInput, closeWeek, reopenWeek,
  quarterReview, closeQuarter, reopenQuarter, markGoal, addNextGoal,
} from './reviews.js';
import {
  checkMessageInput, listConversations, getConversation, createConversation, deleteConversation, renameConversation, restoreConversation,
  sendMessage, stopAnswer, isAnswering, settleAnswers, stopAll, toolsFor, DEFAULT_COMMAND, claudeEnv,
} from './assistant.js';
import { applyAction, dismissAction, undoAction, planCards } from './assistant-tools.js';
import { handleMcp } from './mcp.js';
import { getWelcome, setWelcome } from './welcome.js';
import { chosenAI, getAssistantChoice, setProvider, checkAssistant } from './ai.js';
import { getPick, setPick, pickState, checkPickInput } from './ai-pick.js';
import { findCodex, codexEnv } from './codex.js';
import { startBackups, listBackups, checkAllBackups } from './backup.js';
import { writeMoveFile, moveFileName, receiveMoveFile, moveStatus, cancelMove, confirmMove, applyPendingMove } from './move.js';
import { getLibrary, setLibraryKey, libraryServer } from './sovran-library.js';
import { getCourse, setCourseUrl } from './course.js';
import { listDocs, readDoc } from './docs.js';
import { getPermissions, setPermission, recentActivity, allowedRules, removeRule } from './permissions.js';
import { startReader, suggestionOf, acceptSuggestion, READER } from './suggestions.js';
import { startTitler } from './short-titles.js';
import { randomBytes } from 'node:crypto';
import {
  checkPersonInput, checkCompanyInput, createPerson, getPerson, listPeople, updatePerson, createCompany, getCompany,
  listCompanies, updateCompany, deleteContact, restoreContact, listDeletedContacts,
} from './people.js';
import {
  checkLifeInput, createLifeItem, getLifeItem, listLifeItems, updateLifeItem, deleteLifeItem, restoreLifeItem,
  listDeletedLifeItems,
} from './life.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, 'public');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.icns': 'image/icns',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export function startServer({
  port = 3000, dataDir = path.join(appDir, 'data'), hosts = [], readCalendarsEvery = READ_EVERY_MS, assistantCommand = DEFAULT_COMMAND, codexCommand = null,
  readCaptures = true, writeTitles = true, linkFetcher = fetchTitle, google = {}, mailSyncEvery = 20_000, googleCalendarEvery = 60_000, googleCalendarSendEvery = 2000, backupEvery = 60 * 60 * 1000, onQuit = null, onRestart = null,
} = {}) {
  // A moving file you said yes to (Settings › Phone, backups and moving) takes the place of what is here, before the
  // database is opened; what was here is kept in data/before-move-<time>/ (move.js).
  try { applyPendingMove(dataDir); } catch (err) { console.error(`The moving file could not be brought in: ${err.message}`); }
  const db = openDatabase(dataDir);
  settleAnswers(db);
  settleImports(db);
  settleSends(db); // a mail that was being sent when the app stopped is never sent again by itself
  // The assistant's tools answer only with this secret, made now and never shown or logged.
  const mcpSecret = randomBytes(32).toString('hex');
  let mcpUrl = '';
  // The AI chosen in Settings (ai.js): your own Claude, or your own ChatGPT; asked afresh each time.
  // codex: the one given, else found each time it is needed (on the PATH, or inside the ChatGPT app on a Mac).
  const commands = { claude: assistantCommand, get codex() { return codexCommand ?? findCodex(); } };
  const ai = () => chosenAI(db, commands);
  let checking = null; // the Check button's run under way (ai.js)
  // Your assistant reads each capture in the background and suggests where it goes.
  const reader = readCaptures
    ? startReader({ db, dataDir, ai, mcp: () => ({ url: mcpUrl, secret: mcpSecret }) })
    : { read: () => {}, catchUp: () => {}, stop: () => {} };
  // A long task gets a few words from your assistant, in the background (short-titles.js).
  const titler = writeTitles ? startTitler({ db, dataDir, ai }) : { catchUp: () => {}, soon: () => {}, stop: () => {} };
  let ownHosts = [];
  // Google (google.js): the key store, the sign-ins under way, and a problem to tell the page once. Tests give stand-ins.
  const googleEnv = google.env ?? process.env;
  const keyStore = google.keyStore ?? defaultKeyStore(googleEnv);
  const googleFetch = google.fetcher ?? fetch;
  // Capture from anywhere: the devices' tokens are in the key store too, under a name of their own.
  const captureKeys = google.captureKeyStore ?? defaultKeyStore(googleEnv, process.platform, { service: 'Sovran Advisor · Capture' });
  const signIns = new Map();
  let googleProblem = '';
  let googleRedirect = '';
  let backups = null; // the daily backup (backup.js)
  // The mail file being read in, as the page asks about it (mail.js); one at a time.
  let mailJob = null;
  let mailSync = null; // the Live with Gmail job
  let googleCalendar = null; // the Google Calendar read (Calendar in depth 7)
  let googleCalendarSend = null; // the sender of changes to Google events (Calendar in depth 8)
  let mailSender = null; // sends what is due (Mail 8)

  // The app's data, as JSON:
  //   GET    /api/notes                 every note, last edited first (title and the start of the text)
  //   GET    /api/notes?q=words         search: notes with every word, best match first
  //   GET    /api/notes?deleted=1       Recently deleted, most recently deleted first
  //   POST   /api/notes                 make a note: { title?, body? }
  //   GET    /api/notes/:id             one note
  //   PATCH  /api/notes/:id             change its title, text and/or home: { title?, body?, home_id? }
  //   DELETE /api/notes/:id             mark it deleted (never really removed)
  //   POST   /api/notes/:id/restore     bring a deleted note back
  async function api(req, res, url) {
    if (url.pathname === '/api/health') {
      const { ok } = db.prepare('SELECT 1 AS ok').get();
      return sendJson(res, 200, { ok: ok === 1 });
    }

    // Bullets (Writing and thinking, advanced/writing/1):
    //   GET   /api/notes/:id/bullets  the note's bullets in reading order, each with its parent, depth, text and whether it is folded
    //   PATCH /api/bullets/:id        { folded: true | false }: fold or open a bullet (touches no note: its edited time stays)
    // Boards (Writing 6): a canvas of cards, words and arrows in a note
    //   POST  /api/boards                  { note_id, title? }: a new board (the note's text gets a line that links to it)
    //   GET   /api/boards/:id              the board with its items; a card that points at a note, person or task carries it live
    //   PATCH /api/boards/:id              { title }
    //   POST  /api/boards/:id/items        { kind: card | text | arrow, text?, ref_table?, ref_id?, x?, y?, from_id?, to_id?, label? }
    //   PATCH /api/board-items/:id         { x?, y?, text?, label? }:  DELETE takes it off the board (with the arrows that joined it)
    const boardsRoot = url.pathname === '/api/boards';
    const boardMatch = url.pathname.match(/^\/api\/boards\/([0-9a-f-]{36})(\/items)?$/);
    const boardItem = url.pathname.match(/^\/api\/board-items\/([0-9a-f-]{36})$/);
    if (boardsRoot || boardMatch || boardItem) {
      const input = req.method === 'POST' || req.method === 'PATCH' ? ((await readJson(req)) ?? {}) : {};
      try {
        if (boardsRoot) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          if (!moduleOn(db, 'writing')) return sendJson(res, 409, { error: 'Writing and thinking is switched off.' });
          return sendJson(res, 201, createBoard(db, { note_id: input.note_id ?? null, title: input.title ?? '' }));
        }
        if (boardMatch) {
          const [, boardId, items] = boardMatch;
          if (items) {
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
            return sendJson(res, 201, addItem(db, boardId, input));
          }
          if (req.method === 'GET') { const board = getBoard(db, boardId); return board ? sendJson(res, 200, board) : sendJson(res, 404, { error: 'No such board' }); }
          if (req.method === 'PATCH') {
            if ('background' in input) return sendJson(res, 200, setBackground(db, boardId, input.background));
            return sendJson(res, 200, renameBoard(db, boardId, input.title));
          }
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        if (req.method === 'PATCH') return sendJson(res, 200, changeItem(db, boardItem[1], input));
        if (req.method === 'DELETE') return sendJson(res, 200, removeItem(db, boardItem[1]));
        return sendJson(res, 405, { error: 'Method not allowed' });
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // The pen (Writing 8):
    //   POST   /api/boards/:id/strokes       { points: [[x, y, pressure, ms], ...] }: one stroke of ink, kept as drawn
    //   DELETE /api/strokes/:id              take a stroke away (marked)
    //   POST   /api/boards/:id/ink-to-text   { stroke_ids, image (a PNG data address of them), x?, y? }: your assistant reads the handwriting, the words
    //                                        become a text item on the board and the ink fades below them
    //   PATCH  /api/boards/:id               { background: { sha256 } | null }: a kept picture or PDF under the board
    const strokesMatch = url.pathname.match(/^\/api\/boards\/([0-9a-f-]{36})\/(strokes|ink-to-text)$/);
    const strokeMatch = url.pathname.match(/^\/api\/strokes\/([0-9a-f-]{36})$/);
    if (strokesMatch || strokeMatch) {
      try {
        if (strokeMatch) {
          if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, removeStroke(db, strokeMatch[1]));
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const input = (await readJson(req)) ?? {};
        if (strokesMatch[2] === 'strokes') return sendJson(res, 201, addStroke(db, strokesMatch[1], input.points));
        // To text: the picture goes into a chat folder of its own; your assistant reads it with its Read tool (your own Claude plan, no key).
        const picture = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(input.image ?? ''));
        if (!picture) return sendJson(res, 400, { error: 'Send the strokes as a PNG picture (image).' });
        const bytes = Buffer.from(picture[1], 'base64');
        if (!bytes.length || bytes.length > 3 * 1024 * 1024) return sendJson(res, 400, { error: 'That picture is empty or too large.' });
        if (!getBoard(db, strokesMatch[1])) return sendJson(res, 404, { error: 'No such board' });
        const chat = createConversation(db, dataDir);
        fs.writeFileSync(path.join(dataDir, chat.folder, 'handwriting.png'), bytes);
        const answered = await sendMessage(db, chat.id, 'Read the handwriting in the picture file handwriting.png (open it with the Read tool, or see it attached). Answer with only the words you read, on one line, and nothing else.',
          { dataDir, ...ai(), mcp: { url: mcpUrl, secret: mcpSecret }, images: [path.join(dataDir, chat.folder, 'handwriting.png')] });
        const words = String(answered?.text ?? '').replace(/^["“”'\s]+|["“”'\s]+$/g, '').split('\n')[0];
        return sendJson(res, 200, { conversation_id: chat.id, item: strokesToText(db, strokesMatch[1], input.stroke_ids, words, { x: Number(input.x) || 40, y: Number(input.y) || 40 }) });
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // Clashes (Writing 5): where you and your assistant changed the same line
    //   GET  /api/notes/:id/clashes       the open ones: your words, the assistant's, side by side
    //   POST /api/clashes/:id/resolve     { choice: mine | theirs | both }: one more version; your assistant is told in its next turn
    const noteClashes = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\/clashes$/);
    if (noteClashes) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, moduleOn(db, 'writing') ? listClashes(db, noteClashes[1]) : []);
    }
    const clashMatch = url.pathname.match(/^\/api\/clashes\/([0-9a-f-]{36})\/resolve$/);
    if (clashMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try { return sendJson(res, 200, resolveClash(db, clashMatch[1], input.choice)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message, code: err.code }); throw err; }
    }
    // Versions of a note (Writing 4):
    //   GET  /api/notes/:id/versions                      every save, newest first, with its author, time and what changed
    //   GET  /api/note-versions/:id                       one version's whole text
    //   GET  /api/note-versions/compare?a=&b=             two versions word by word: [{ t: same | add | del, text }]
    //   POST /api/note-versions/:id/restore               its text comes back as the next version, never over one
    const noteVersions = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\/versions$/);
    if (noteVersions) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!moduleOn(db, 'writing')) return sendJson(res, 200, []);
      const versions = listVersions(db, noteVersions[1]);
      return sendJson(res, 200, versions ?? []); // a note that is gone has none (and a page still open on it must not meet an error)
    }
    if (url.pathname === '/api/note-versions/compare') {
      try { return sendJson(res, 200, compareVersions(db, url.searchParams.get('a') ?? '', url.searchParams.get('b') ?? '')); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    const versionMatch = url.pathname.match(/^\/api\/note-versions\/([0-9a-f-]{36})(\/restore)?$/);
    if (versionMatch) {
      const version = getVersion(db, versionMatch[1]);
      if (!version) return sendJson(res, 404, { error: 'No such version' });
      if (!versionMatch[2]) return req.method === 'GET' ? sendJson(res, 200, version) : sendJson(res, 405, { error: 'Method not allowed' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const restored = updateNote(db, version.note_id, { title: version.title, body: version.body, label: `Restored from version ${version.seq}` });
      return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'No such note' });
    }
    // Comments on a passage (Writing 3):
    //   GET  /api/notes/:id/comments       the threads of a note, each with its replies
    //   POST /api/notes/:id/comments       { anchor, occurrence?, body }: a comment on the words you selected
    //   POST /api/comments/:id/replies     { body }: your reply in the thread
    //   PATCH /api/comments/:id            { resolved?, ask? }: resolve or reopen; ask: later puts it on your assistant's list
    //   POST /api/comments/:id/ask         ask your assistant now: a turn in its chat, its answer lands in the thread, signed
    //   DELETE /api/comments/:id           take a comment (with its replies) away
    const noteComments = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\/comments$/);
    if (noteComments) {
      if (!moduleOn(db, 'writing')) return sendJson(res, 200, req.method === 'GET' ? [] : { error: 'Writing and thinking is switched off.' });
      if (req.method === 'GET') return sendJson(res, 200, listCommentThreads(db, noteComments[1]));
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try { return sendJson(res, 201, createComment(db, noteComments[1], input)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    const commentMatch = url.pathname.match(/^\/api\/comments\/([0-9a-f-]{36})(?:\/(replies|ask))?$/);
    if (commentMatch) {
      const [, commentId, part] = commentMatch;
      const input = req.method === 'POST' || req.method === 'PATCH' ? ((await readJson(req)) ?? {}) : {};
      try {
        if (part === 'replies') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 201, replyTo(db, commentId, { body: input.body }));
        }
        if (part === 'ask') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const words = askText(db, commentId);
          const chat = createConversation(db, dataDir);
          changeComment(db, commentId, { ask: 'asked' });
          try {
            await sendMessage(db, chat.id, words, { dataDir, ...ai(), mcp: { url: mcpUrl, secret: mcpSecret } });
          } catch (err) { changeComment(db, commentId, { ask: '' }); throw err; }
          const after = getComment(db, commentId);
          if (after.ask === 'asked') changeComment(db, commentId, { ask: '' }); // it answered nothing in the thread
          return sendJson(res, 200, { conversation_id: chat.id, thread: listCommentThreads(db, after.ref_id).find((t) => t.id === commentId) });
        }
        if (req.method === 'PATCH') return sendJson(res, 200, changeComment(db, commentId, { resolved: input.resolved, ask: input.ask }));
        if (req.method === 'DELETE') { deleteComment(db, commentId); return sendJson(res, 200, { deleted: true }); }
        return sendJson(res, 405, { error: 'Method not allowed' });
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    const bulletsMatch = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\/bullets$/);
    if (bulletsMatch) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!moduleOn(db, 'writing')) return sendJson(res, 200, { blocks: [], module: false });
      const blocks = listBlocks(db, bulletsMatch[1]);
      return sendJson(res, 200, { blocks: blocks ?? [], module: true });
    }
    //   GET   /api/bullets?q=         bullets of any note that contain the words (the (( menu)
    //   GET   /api/bullets/:id        one bullet with its bullets under it, and where it is used (an embed draws it)
    //   GET   /api/bullets/:id/used   the pages that link to or show it
    if (url.pathname === '/api/bullets') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, moduleOn(db, 'writing') ? searchBullets(db, url.searchParams.get('q') ?? '') : []);
    }
    const bulletUsed = url.pathname.match(/^\/api\/bullets\/([0-9a-f-]{36})\/used$/);
    if (bulletUsed) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, usedIn(db, bulletUsed[1]));
    }
    const bulletGet = url.pathname.match(/^\/api\/bullets\/([0-9a-f-]{36})$/);
    if (bulletGet && req.method === 'GET') {
      const detail = bulletDetail(db, bulletGet[1]);
      return sendJson(res, 200, detail ?? { removed: true }); // 200 either way: a gone passage is an answer, not an error
    }
    const bulletMatch = url.pathname.match(/^\/api\/bullets\/([0-9a-f-]{36})$/);
    if (bulletMatch) {
      if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      if (typeof input.folded !== 'boolean') return sendJson(res, 400, { error: 'folded is true or false.' });
      const block = setFolded(db, bulletMatch[1], input.folded);
      return block ? sendJson(res, 200, block) : sendJson(res, 404, { error: 'No such bullet' });
    }
    if (url.pathname === '/api/notes') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedNotes(db));
        const q = url.searchParams.get('q');
        return sendJson(res, 200, q ? searchNotes(db, q) : listNotes(db));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkNoteInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 201, createNote(db, { title: input.title, body: input.body, ...(input.origin === 'assistant' ? { origin: 'assistant' } : {}) }));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const match = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})$/);
    if (match) {
      if (req.method === 'GET') {
        const note = getNote(db, match[1]);
        if (note && url.searchParams.get('version') === '1' && moduleOn(db, 'writing')) { listVersions(db, note.id); return sendJson(res, 200, { ...note, version: latestVersion(db, note.id)?.seq ?? null }); }
        return note ? sendJson(res, 200, note) : sendJson(res, 404, { error: 'No such note' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkNoteInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        // A save that says which version its text started from is merged three ways if the note moved on since (Writing 5).
        const saved = saveWithMerge(db, match[1], { title: input.title, body: input.body, home_id: input.home_id, base: input.base_version });
        if (!saved?.note) return sendJson(res, 404, { error: 'No such note' });
        return sendJson(res, 200, 'base_version' in input ? { ...saved.note, version: latestVersion(db, match[1])?.seq ?? null, merged: saved.merged, clashes: saved.clashes.length } : saved.note);
      }
      if (req.method === 'DELETE') {
        const note = deleteNote(db, match[1]);
        return note ? sendJson(res, 200, note) : sendJson(res, 404, { error: 'No such note' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const restore = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\/restore$/);
    if (restore) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      const note = restoreNote(db, restore[1]);
      return note ? sendJson(res, 200, note) : sendJson(res, 404, { error: 'No such note' });
    }

    // The journal:
    //   GET    /api/journals                    General first, then the owner's own, with entry counts
    //   POST   /api/journals                    add one: { name }
    //   DELETE /api/journals/:id                delete one; its entries move to General
    //   GET    /api/entries?day=YYYY-MM-DD      one day's entries, in the order written
    //   GET    /api/entries?before=YYYY-MM-DD   earlier entries, newest first (&limit=)
    //   GET    /api/entries?q=words             search entries
    //   GET    /api/entries?deleted=1           deleted entries
    //   GET    /api/entries/days?from=&to=      the days with entries, and how many
    //   (&journal=<id> narrows any of these to one journal)
    //   POST   /api/entries                     add one: { journal_id?, day?, title?, body? }
    //   GET / PATCH / DELETE /api/entries/:id   one entry; PATCH { title?, body?, journal_id? }
    //   POST   /api/entries/:id/restore         bring a deleted entry back
    // Files:
    //   POST /api/files          the file itself as the request body, its type as Content-Type
    //                            and its name in X-File-Name (URL-encoded). Answers its row
    //                            (201 when new, 200 when that content was already kept).
    //   GET  /api/files/:sha256  one file's row
    //   GET  /files/:sha256      the file itself
    if (url.pathname === '/api/files') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      // A name header can't be sent by another website without asking first; this server
      // never says yes, so only the app's own pages can add files.
      const name = req.headers['x-file-name'];
      if (!name) return sendJson(res, 400, { error: 'Send the file name in X-File-Name.' });
      let decoded;
      try { decoded = decodeURIComponent(name); } catch { return sendJson(res, 400, { error: 'X-File-Name is not valid.' }); }
      const { file, created } = await storeFile(db, dataDir, req, { name: decoded, type: req.headers['content-type'] });
      return sendJson(res, created ? 201 : 200, file);
    }

    const fileRow = url.pathname.match(/^\/api\/files\/([0-9a-f]{64})$/);
    if (fileRow) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const file = getFile(db, fileRow[1]);
      return file ? sendJson(res, 200, file) : sendJson(res, 404, { error: 'No such file' });
    }

    // Quick capture and the Inbox:
    //   GET    /api/captures                what waits in the Inbox, oldest first
    //   GET    /api/captures?deleted=1      captures let go
    //   GET    /api/captures/count          { waiting, snoozed, done, trash }: the sidebar, and the Inbox's four views
    //   GET    /api/captures?view=snoozed|done|trash   the other views of the Inbox
    //   POST   /api/captures                keep a thought: { body }
    //   GET / PATCH /api/captures/:id       one capture; PATCH { body?, home_id? }
    //   DELETE /api/captures/:id            let it go
    //   POST   /api/captures/:id/sort       { to: journal | note | task | done, note_id?, task?, day? (journal), body? (journal) }
    //   POST   /api/captures/:id/undo       take the decision back: it waits in the Inbox again
    if (url.pathname === '/api/captures') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedCaptures(db));
        const view = url.searchParams.get('view');
        if (view === 'snoozed') return sendJson(res, 200, snoozedCaptures(db));
        if (view === 'done') return sendJson(res, 200, doneCaptures(db));
        if (view === 'trash') return sendJson(res, 200, listDeletedCaptures(db));
        return sendJson(res, 200, waitingCaptures(db).map((c) => ({ ...c, home: homeOf(db, c), suggestion: suggestionOf(db, c.id) })));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkCaptureInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const made = createCapture(db, { body: input.body, world: input.world });
        reader.read(made.id); // saving never waits for it
        readLink(db, made.id, { fetcher: linkFetcher }); // nor for a pasted link's title
        return sendJson(res, 201, made);
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (url.pathname === '/api/captures/count') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, captureCounts(db));
    }

    //   POST   /api/captures/:id/accept     take your assistant's suggestion
    const capture = url.pathname.match(/^\/api\/captures\/([0-9a-f-]{36})(?:\/(sort|undo|accept))?$/);
    if (capture) {
      const [, id, action] = capture;
      if (action) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const input = await readJson(req);
        if (action === 'undo') return sendJson(res, 200, undoCapture(db, id));
        if (action === 'accept') return sendJson(res, 200, acceptSuggestion(db, id));
        if (input.to === 'task') {
          const problem = checkTaskInput(input.task ?? null, { creating: true });
          if (problem) return sendJson(res, 400, { error: problem });
        }
        return sendJson(res, 200, sortCapture(db, id, { to: input.to, note_id: input.note_id, task: input.task, day: input.day, body: input.body }));
      }
      if (req.method === 'GET') {
        const found = getCapture(db, id);
        return found ? sendJson(res, 200, { ...found, home: homeOf(db, found), suggestion: suggestionOf(db, id) }) : sendJson(res, 404, { error: 'No such capture' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkCaptureChange(input);
        if (problem) return sendJson(res, 400, { error: problem });
        if ('world' in input && !('body' in input)) {
          const moved = setWorld(db, id, input.world);
          return moved ? sendJson(res, 200, moved) : sendJson(res, 404, { error: 'No such capture' });
        }
        if ('snooze_until' in input) {
          const snoozed = snoozeCapture(db, id, input.snooze_until);
          return snoozed ? sendJson(res, 200, snoozed) : sendJson(res, 404, { error: 'No such capture' });
        }
        const before = getCapture(db, id);
        const changed = updateCapture(db, id, { body: input.body, home_id: input.home_id });
        if (changed && before && changed.body !== before.body && changed.state === 'waiting') { reader.read(id, { quiet: true }); readLink(db, id, { fetcher: linkFetcher }); }
        return changed ? sendJson(res, 200, { ...changed, home: homeOf(db, changed) }) : sendJson(res, 404, { error: 'No such capture' });
      }
      if (req.method === 'DELETE') return sendJson(res, 200, letGo(db, id));
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Links between pages:
    //   GET /api/links/suggest?q=words        pages to link to, for what was typed after [[
    //   GET /api/links/to?kind=&id=           "Linked from": the pages that link to this one
    //   GET /api/links/target?kind=&id=       what a link shows: the page's current name
    // kind is note, entry, day (with id YYYY-MM-DD), person, company or life.
    if (url.pathname.startsWith('/api/links/')) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const kind = url.searchParams.get('kind');
      const id = url.searchParams.get('id') ?? '';
      if (url.pathname === '/api/links/suggest') {
        const only = ['person', 'company'].includes(url.searchParams.get('only')) ? url.searchParams.get('only') : undefined;
        return sendJson(res, 200, suggestLinks(db, url.searchParams.get('q') ?? '', { today: localDay(), only }));
      }
      if (!['note', 'entry', 'day', 'person', 'company', 'life', 'event'].includes(kind)) {
        return sendJson(res, 400, { error: 'kind is note, entry, day, person, company, life or event.' });
      }
      if (url.pathname === '/api/links/to') return sendJson(res, 200, linkedFrom(db, kind, id));
      if (url.pathname === '/api/links/target') return sendJson(res, 200, linkTarget(db, kind, id));
      return sendJson(res, 404, { error: 'Not found' });
    }

    // People and companies (pkm/2):
    //   GET    /api/people?q=       everyone, by name (q narrows by name, company or role)
    //   GET    /api/people?deleted=1  people and companies deleted
    //   POST   /api/people          add someone: { name, company_id?, role?, emails?, phones?, how_met?, body? }
    //   GET / PATCH / DELETE /api/people/:id,  POST /api/people/:id/restore
    //   the same for /api/companies (name, website?, body?); a company comes with its people
    for (const [base, kind, check, create, get, list, update] of [
      ['/api/people', 'person', checkPersonInput, createPerson, getPerson, listPeople, updatePerson],
      ['/api/companies', 'company', checkCompanyInput, createCompany, getCompany, listCompanies, updateCompany],
    ]) {
      if (url.pathname === base) {
        if (req.method === 'GET') {
          if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedContacts(db));
          return sendJson(res, 200, list(db, { q: url.searchParams.get('q') ?? '' }));
        }
        if (req.method === 'POST') {
          const input = await readJson(req);
          const problem = check({ name: '', ...input });
          if (problem) return sendJson(res, 400, { error: problem });
          return sendJson(res, 201, create(db, input));
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      const one = url.pathname.startsWith(`${base}/`) && url.pathname.slice(base.length + 1).match(/^([0-9a-f-]{36})(\/restore)?$/);
      if (one) {
        const [, id, restoring] = one;
        if (restoring) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          await readJson(req);
          const restored = restoreContact(db, kind, id);
          return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
        }
        if (req.method === 'GET') {
          const found = get(db, id);
          return found ? sendJson(res, 200, found) : sendJson(res, 404, { error: 'Not found' });
        }
        if (req.method === 'PATCH') {
          const input = await readJson(req);
          const problem = check(input);
          if (problem) return sendJson(res, 400, { error: problem });
          const changed = update(db, id, input);
          return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
        }
        if (req.method === 'DELETE') {
          const deleted = deleteContact(db, kind, id);
          return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
    }

    // Tasks (tasks/1, tasks/2): lines in notes, entries, people's and companies' notes, and
    // tasks of their own:
    //   GET    /api/tasks              every open task, with where it lives and its home
    //   GET    /api/tasks?done=1       the done ones, most recently done first
    //   GET    /api/tasks?home=:id     the tasks at home in a My Life item, open and done (a Key Element's: also those under it)
    //   GET    /api/tasks?deleted=1    tasks of their own that were deleted
    //   POST   /api/tasks              add one of its own: { text, due?, flag?, estimate?, repeat?, home_id?, remind_time?, details?, mail_thread_id? (made from a mail, linked back) }
    //   PATCH  /api/tasks/:id          { done?, due?, flag?, estimate?, home_id?, text? (its own) }
    //   DELETE /api/tasks/:id,  POST /api/tasks/:id/restore   (a task of its own)
    //   GET    /api/reminders/due      reminders whose time has come
    //   GET    /api/reminders?state=waiting|done   every alarm in that state, with its task
    //   PATCH  /api/reminders/:id      { snooze?: minutes or "tomorrow", done?: true }  (done ends the alarm; the task stays open)
    if (url.pathname === '/api/tasks') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedTasks(db));
        const home = url.searchParams.get('home');
        if (home) return sendJson(res, 200, listTasks(db, { home }));
        const done = url.searchParams.get('done') === '1';
        return sendJson(res, 200, done ? listTasks(db, { done: true }).slice(0, 200) : listTasks(db, { done: false }));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkTaskInput(input, { creating: true });
        if (problem) return sendJson(res, 400, { error: problem });
        if (input.mail_thread_id && !db.prepare('SELECT 1 FROM mail_threads WHERE id = ? AND deleted_at IS NULL').get(input.mail_thread_id)) return sendJson(res, 400, { error: 'No such conversation.' });
        return sendJson(res, 201, createTask(db, input));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})(\/restore)?$/);
    if (taskMatch) {
      const [, id, restoring] = taskMatch;
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreTask(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkTaskInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = changeTask(db, id, input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'DELETE') {
        const deleted = deleteTask(db, id);
        return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/reminders/due') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, dueReminders(db));
    }
    if (url.pathname === '/api/reminders') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const state = url.searchParams.get('state') ?? 'waiting';
      if (!['waiting', 'done'].includes(state)) return sendJson(res, 400, { error: 'state is waiting or done.' });
      return sendJson(res, 200, listReminders(db, { state, limit: Number(url.searchParams.get('limit') ?? 30) }));
    }
    const reminderMatch = url.pathname.match(/^\/api\/reminders\/([0-9a-f-]{36})$/);
    if (reminderMatch) {
      if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const snooze = input?.snooze;
      if (snooze !== undefined && snooze !== 'tomorrow' && !(Number.isInteger(snooze) && snooze > 0 && snooze <= 24 * 60)) return sendJson(res, 400, { error: 'snooze is minutes, or tomorrow.' });
      if (input?.done !== undefined && input.done !== true) return sendJson(res, 400, { error: 'done is true.' });
      const changed = changeReminder(db, reminderMatch[1], { snooze, done: input?.done });
      return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
    }

    // Events (time/1):
    //   GET    /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD   the events of those days
    //   GET    /api/events?deleted=1                       the deleted ones
    //   POST   /api/events          { title, starts_at, ends_at, note? }  (YYYY-MM-DDTHH:MM)
    //   GET / PATCH / DELETE /api/events/:id,  POST /api/events/:id/restore
    if (url.pathname === '/api/events') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedEvents(db));
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to') ?? from;
        if (!isDay(from) || !isDay(to)) return sendJson(res, 400, { error: 'from and to are days: YYYY-MM-DD.' });
        // Your own events, and those of your other calendars (read-only).
        const own = eventsBetween(db, from, to).map(ownEvent(db));
        return sendJson(res, 200, withNotes(db, [...own, ...calendarEventsBetween(db, from, to)]
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkEventInput(input, { creating: true });
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 201, createEvent(db, input));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    //   POST   /api/events/note        { id }: the note about that event (made if there is none)
    //   GET    /api/events/at/:id      where the event a note links to is (its start)
    if (url.pathname === '/api/events/note') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      if (typeof input?.id !== 'string') return sendJson(res, 400, { error: 'Which event? Send its id.' });
      const made = noteAboutEvent(db, input.id);
      return sendJson(res, made.existing ? 200 : 201, made);
    }
    const eventAtMatch = url.pathname.match(/^\/api\/events\/at\/([0-9a-f-]{36})$/);
    if (eventAtMatch) {
      const found = eventAt(db, eventAtMatch[1]);
      return found ? sendJson(res, 200, found) : sendJson(res, 404, { error: 'Not found' });
    }
    const eventMatch = url.pathname.match(/^\/api\/events\/([0-9a-f-]{36})(\/restore)?$/);
    if (eventMatch) {
      const [, id, restoring] = eventMatch;
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreEvent(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        const found = getEvent(db, id);
        return found ? sendJson(res, 200, found) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkEventInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = updateEvent(db, id, input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'DELETE') {
        const deleted = deleteEvent(db, id);
        return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // The Planner (time/2):
    //   GET    /api/planner?day=YYYY-MM-DD   that day: its events, planned tasks, blocks, the Tray, settings
    //   GET / PATCH /api/settings            the Planner's settings
    //   POST   /api/blocks                   { day, starts_at, ends_at, kind, title? }  (HH:MM)
    //   PATCH / DELETE /api/blocks/:id,  POST /api/blocks/:id/restore
    if (url.pathname === '/api/planner') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const day = url.searchParams.get('day') ?? localDay();
      if (!isDay(day)) return sendJson(res, 400, { error: 'day is YYYY-MM-DD.' });
      const own = eventsBetween(db, day, day).map(ownEvent(db));
      const events = [...own, ...calendarEventsBetween(db, day, day)].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      return sendJson(res, 200, { ...plannerDay(db, day, { events }), closed: dayClose(db, day) });
    }
    //   GET    /api/planner/week?day=      the week that day is in
    //   PUT    /api/highlights/:day        { task_id }: that day's Highlight (null: none)
    //   GET / PATCH /api/planning/:kind/:period   a flow (weekly or daily): { step, state }
    const eventsOf = (d) => [...eventsBetween(db, d, d).map(ownEvent(db)),
      ...calendarEventsBetween(db, d, d)].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    if (url.pathname === '/api/planner/week') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const day = url.searchParams.get('day') ?? localDay();
      if (!isDay(day)) return sendJson(res, 400, { error: 'day is YYYY-MM-DD.' });
      const week = plannerWeek(db, day, { eventsOf });
      return sendJson(res, 200, { ...week, days: week.days.map((d) => ({ ...d, closed: dayClose(db, d.day) })) });
    }
    // Closing the day (time/4):
    //   GET    /api/shutdown/:day   how it was closed (null: never)
    //   PUT    /api/shutdown/:day   { line, highlight, leave: { <task id>: missed | tomorrow | no_day } }
    //   DELETE /api/shutdown/:day   reopen it (the line stays)
    const shutdownMatch = url.pathname.match(/^\/api\/shutdown\/(\d{4}-\d{2}-\d{2})$/);
    if (shutdownMatch) {
      const day = shutdownMatch[1];
      if (req.method === 'GET') return sendJson(res, 200, dayClose(db, day));
      if (req.method === 'PUT') {
        const input = await readJson(req);
        const problem = checkCloseInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, closeDay(db, day, input));
      }
      if (req.method === 'DELETE') {
        const reopened = reopenDay(db, day);
        return reopened ? sendJson(res, 200, reopened) : sendJson(res, 404, { error: 'That day was never closed.' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const highlightMatch = url.pathname.match(/^\/api\/highlights\/(\d{4}-\d{2}-\d{2})$/);
    if (highlightMatch) {
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      if (!(input?.task_id === null || typeof input?.task_id === 'string')) return sendJson(res, 400, { error: 'task_id is an id, or null.' });
      return sendJson(res, 200, setHighlight(db, highlightMatch[1], input.task_id));
    }
    const flowMatch = url.pathname.match(/^\/api\/planning\/(weekly|daily)\/(\d{4}-\d{2}-\d{2})$/);
    if (flowMatch) {
      const [, kind, period] = flowMatch;
      if (req.method === 'GET') return sendJson(res, 200, getFlow(db, kind, period));
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        if (!FLOWS[kind].includes(input?.step)) return sendJson(res, 400, { error: `step is one of: ${FLOWS[kind].join(', ')}.` });
        return sendJson(res, 200, setFlowStep(db, kind, period, input.step, input.state ?? null));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // The Weekly Review (time/4), for the week a day is in:
    //   GET    /api/reviews/week/:day   its look back (as kept, once closed), wins line
    //   PUT    /api/reviews/week/:day   { wins }: close the week, keeping its look back
    //   DELETE /api/reviews/week/:day   reopen it
    const weekReviewMatch = url.pathname.match(/^\/api\/reviews\/week\/(\d{4}-\d{2}-\d{2})$/);
    if (weekReviewMatch) {
      const day = weekReviewMatch[1];
      if (req.method === 'GET') return sendJson(res, 200, weekReview(db, day));
      if (req.method === 'PUT') {
        const input = await readJson(req);
        const problem = checkReviewInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, closeWeek(db, day, input));
      }
      if (req.method === 'DELETE') {
        const reopened = reopenWeek(db, day);
        return reopened ? sendJson(res, 200, reopened) : sendJson(res, 404, { error: 'That week is not closed.' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // The quarterly review (time/4), for the quarter a day is in:
    //   GET    /api/reviews/quarter/:day             its weeks, Goals, loose ends, next quarter's Goals
    //   PUT    /api/reviews/quarter/:day             { wins }: close it, keeping its look back
    //   DELETE /api/reviews/quarter/:day             reopen it
    //   PUT    /api/reviews/quarter/:day/goals/:id   { mark: reached | let_go | in_play }
    //   POST   /api/reviews/quarter/:day/next        { title }: a Goal for the next quarter
    const quarterMatch = url.pathname.match(/^\/api\/reviews\/quarter\/(\d{4}-\d{2}-\d{2})(?:\/(next)|\/goals\/([0-9a-f-]{36}))?$/);
    if (quarterMatch) {
      const [, day, next, goalId] = quarterMatch;
      if (goalId) {
        if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
        const input = await readJson(req);
        return sendJson(res, 200, markGoal(db, day, goalId, input?.mark));
      }
      if (next) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const input = await readJson(req);
        if (typeof input?.title !== 'string' || input.title.length > 200) return sendJson(res, 400, { error: 'title is text of at most 200 characters.' });
        return sendJson(res, 201, addNextGoal(db, day, input.title));
      }
      if (req.method === 'GET') return sendJson(res, 200, quarterReview(db, day));
      if (req.method === 'PUT') {
        const input = await readJson(req);
        const problem = checkReviewInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, closeQuarter(db, day, input));
      }
      if (req.method === 'DELETE') {
        const reopened = reopenQuarter(db, day);
        return reopened ? sendJson(res, 200, reopened) : sendJson(res, 404, { error: 'That quarter is not closed.' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // The assistant's tools over MCP (assistant/2), for the claude command the app starts.
    if (url.pathname === '/api/mcp') {
      return handleMcp(req, res, {
        secret: mcpSecret, readJson, sendJson, db,
        run: (id) => (id === READER ? { conversationId: READER, readOnly: true } : toolsFor(id)),
      });
    }
    // What the assistant may do alone (assistant/4):
    //   GET /api/assistant/permissions   the switches and the activity log
    //   PUT /api/assistant/permissions   { key, mode: alone | ask }
    if (url.pathname === '/api/assistant/permissions') {
      if (req.method === 'GET') return sendJson(res, 200, { permissions: getPermissions(db), allowed: allowedRules(db), activity: recentActivity(db) });
      if (req.method === 'PUT') {
        const input = await readJson(req);
        return sendJson(res, 200, { permissions: setPermission(db, input?.key, input?.mode), allowed: allowedRules(db), activity: recentActivity(db) });
      }
      // DELETE { rule }: a kind of step is no longer always allowed.
      if (req.method === 'DELETE') {
        const input = await readJson(req);
        removeRule(db, String(input?.rule ?? ''));
        return sendJson(res, 200, { permissions: getPermissions(db), allowed: allowedRules(db), activity: recentActivity(db) });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // The assistant's plans for the Planner board:  GET /api/assistant-actions/plans
    if (url.pathname === '/api/assistant-actions/plans') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, planCards(db));
    }
    // Cards under an answer:  POST /api/assistant-actions/:id/apply | dismiss | undo
    const cardMatch = url.pathname.match(/^\/api\/assistant-actions\/([0-9a-f-]{36})\/(apply|always|dismiss|undo)$/);
    if (cardMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      const [, id, what] = cardMatch;
      const card = what === 'always' ? applyAction(db, id, { always: true }) : { apply: applyAction, dismiss: dismissAction, undo: undoAction }[what](db, id);
      return card ? sendJson(res, 200, card) : sendJson(res, 404, { error: 'Not found' });
    }
    // The assistant (assistant/1):
    //   GET    /api/conversations                 every conversation, last used first
    //   POST   /api/conversations                 a new one, with its own folder
    //   GET    /api/conversations/:id             one, with its messages
    //   PATCH  /api/conversations/:id             { title }: rename it
    //   DELETE /api/conversations/:id,  POST /api/conversations/:id/restore
    //   POST   /api/conversations/:id/messages    { text }: the answer streams back as lines of JSON
    //   POST   /api/conversations/:id/stop        end the answer under way
    if (url.pathname === '/api/conversations') {
      if (req.method === 'GET') return sendJson(res, 200, listConversations(db));
      if (req.method === 'POST') { await readJson(req); return sendJson(res, 201, createConversation(db, dataDir)); }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})(?:\/(messages|stop|restore))?$/);
    if (conversationMatch) {
      const [, id, part] = conversationMatch;
      if (!part) {
        if (req.method === 'GET') {
          const conversation = getConversation(db, id);
          return conversation ? sendJson(res, 200, { ...conversation, answering: isAnswering(id), call_marks: callMarks(db, id) }) : sendJson(res, 404, { error: 'Not found' });
        }
        if (req.method === 'PATCH') {
          const input = await readJson(req);
          const renamed = renameConversation(db, id, input?.title);
          if (renamed === undefined) return sendJson(res, 400, { error: 'A name is 1 to 80 characters.' });
          return renamed ? sendJson(res, 200, renamed) : sendJson(res, 404, { error: 'Not found' });
        }
        if (req.method === 'DELETE') {
          const deleted = deleteConversation(db, id);
          return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      if (part === 'restore') {
        const restored = restoreConversation(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (part === 'stop') return sendJson(res, 200, { stopped: stopAnswer(id) });
      const problem = checkMessageInput(input);
      if (problem) return sendJson(res, 400, { error: problem });
      const line = (event) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
      const answered = sendMessage(db, id, input.text, {
        dataDir, ...ai(), send: line, mcp: { url: mcpUrl, secret: mcpSecret }, context: input.context ?? null, library: libraryServer(db),
        notes: takeClashNotes(db), // which side won a clash since it last heard (Writing 5)
        pick: moduleOn(db, 'ai-pick') ? getPick(db, id, ai().provider) : null, // the model and effort chosen for this chat (ai-pick.js)
      });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      await answered;
      res.end();
      return undefined;
    }
    // GET /api/timeline?kinds=note,entry,task,event,capture&q=words&before=YYYY-MM-DDTHH:MM:SS.mmm&limit=60&about=person:<id>|company:<id>
    //   everything that happened, newest first, read from the tables that keep it (advanced/people/2)
    if (url.pathname === '/api/timeline') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const problem = checkTimelineQuery(url.searchParams);
      if (problem) return sendJson(res, 400, { error: problem });
      const kinds = url.searchParams.get('kinds');
      const about = url.searchParams.get('about')?.split(':');
      return sendJson(res, 200, timeline(db, {
        ...(about ? { about: { kind: about[0], id: about[1] } } : {}),
        ...(kinds !== null ? { kinds: kinds.split(',').filter(Boolean) } : {}), q: url.searchParams.get('q') ?? '',
        before: url.searchParams.get('before') ?? '', ...(url.searchParams.get('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
      }));
    }
    // POST /api/dictation/session               a short-lived WebSocket address for one dictation (the key stays here);
    //                                            with no ElevenLabs key: { engine: 'local' } (the free voice model on this computer)
    // POST /api/dictation/local { audio }        the words in a piece of sound (base64 16-bit, 16 kHz, at most 30 s), heard here
    // POST /api/dictation/local/prepare          get the free voice model now (once); GET /api/dictation/settings says how far it is
    // GET / PUT /api/dictation/settings         the hold key ({ hold_key }), whether there is a key, and the free model's state
    // GET /api/dictations?q=&before=&limit=      the history, newest first;  POST /api/dictations { text, went_to?, outcome }
    if (url.pathname === '/api/dictation/session') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      if (!hasKey(dataDir)) {
        const local = localStatus(dataDir);
        if (local.state === 'ready') return sendJson(res, 200, { engine: 'local', sample_rate: 16000, max_seconds: 30, fixes: fixes(db) });
        if (local.state === 'missing' || local.state === 'failed') prepareLocal(dataDir).catch(() => {});
        const now = localStatus(dataDir);
        return sendJson(res, 409, {
          code: 'model_not_ready',
          error: now.state === 'getting' ? `Getting the free voice model, once (about 200 MB, ${now.percent}% so far). Dictation works when it is done.` : now.message ?? 'The free voice model is not ready.',
        });
      }
      try { return sendJson(res, 200, { engine: 'elevenlabs', ...(await startSession(dataDir, { keyterms: keyterms(db) })), fixes: fixes(db) }); } catch (err) {
        if (err.code) return sendJson(res, err.status, { error: err.message, code: err.code });
        throw err;
      }
    }
    // Voice calls with your assistant (advanced/voice/3-7, call.js), only while Dictation (the Voice module) is on:
    //   GET / PUT /api/call/settings      the voice it speaks with and its speed; whether the free models are here
    //   POST /api/call/warm               get and load the models now, so the first turn is quick: { ready }
    //   POST /api/call/speak { text }     the words as sound (audio/wav)
    //   POST /api/call/route { text, conversation_id? }   answered from your data ({ source: 'data', spoken, ... }) or { source: 'assistant' }
    //   POST /api/call/turns { call_id, conversation_id, ... }   how a turn went;  GET /api/call/stats  the numbers of the last 20 calls
    //   GET / POST /api/voice-log         the Voice log: every failure of a layer
    if (url.pathname.startsWith('/api/call/') || url.pathname === '/api/voice-log') {
      if (!moduleOn(db, 'voice')) return sendJson(res, 409, { error: 'Dictation is switched off (Settings › Modules).' });
      try {
        if (url.pathname === '/api/call/settings') {
          if (req.method === 'PUT') setCallSettings(db, await readJson(req));
          else if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return sendJson(res, 200, await callSettings(db, dataDir));
        }
        if (url.pathname === '/api/call/stats') return req.method === 'GET' ? sendJson(res, 200, callStats(db)) : sendJson(res, 405, { error: 'Method not allowed' });
        if (url.pathname === '/api/voice-log') {
          if (req.method === 'GET') return sendJson(res, 200, listVoiceLog(db));
          if (req.method === 'POST') return sendJson(res, 201, logVoice(db, await readJson(req)));
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const input = await readJson(req);
        if (url.pathname === '/api/call/warm') return sendJson(res, 200, await warmCall(db, dataDir));
        if (url.pathname === '/api/call/route') return sendJson(res, 200, routeTurn(db, dataDir, input));
        if (url.pathname === '/api/call/turns') {
          const problem = checkTurnInput(input);
          if (problem) return sendJson(res, 400, { error: problem });
          return sendJson(res, 201, addTurn(db, input));
        }
        if (url.pathname === '/api/call/speak') {
          const wav = await speak(db, dataDir, input?.text);
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' });
          res.end(wav);
          return undefined;
        }
        return sendJson(res, 404, { error: 'Not found' });
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        throw err;
      }
    }
    if (url.pathname === '/api/dictation/local') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      try { return sendJson(res, 200, { text: await hearPiece(dataDir, samplesOf(input?.audio)) }); } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        console.error('The free voice model could not hear that:', err.message);
        return sendJson(res, 500, { error: 'The free voice model could not hear that.' });
      }
    }
    if (url.pathname === '/api/dictation/local/prepare') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      prepareLocal(dataDir).catch(() => {});
      return sendJson(res, 200, localStatus(dataDir));
    }
    if (url.pathname === '/api/dictation/settings') {
      if (req.method === 'PUT') {
        const input = await readJson(req);
        setHoldKey(db, input?.hold_key);
      } else if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, getDictationSettings(db, dataDir));
    }
    // GET /api/glossary?q=            hints and fixes, fixes first; POST /api/glossary { term, heard_as?, learned? }
    // DELETE /api/glossary/:id, POST /api/glossary/:id/restore
    if (url.pathname === '/api/glossary') {
      if (req.method === 'GET') return sendJson(res, 200, listGlossary(db, { q: url.searchParams.get('q') ?? '' }));
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const problem = checkGlossaryInput(input);
      if (problem) return sendJson(res, 400, { error: problem });
      return sendJson(res, 201, addGlossary(db, input, { source: input.learned === true ? 'learned' : 'typed' }));
    }
    const glossaryMatch = url.pathname.match(/^\/api\/glossary\/([0-9a-f-]{32,36})(\/restore)?$/);
    if (glossaryMatch) {
      const [, id, restoring] = glossaryMatch;
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreGlossary(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const deleted = deleteGlossary(db, id);
      return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
    }
    // PUT /api/dictation/key { key }  keeps the key in data/elevenlabs.key;  DELETE removes it. The key is never sent back.
    if (url.pathname === '/api/dictation/key') {
      if (req.method === 'PUT') { saveKey(dataDir, (await readJson(req))?.key); return sendJson(res, 200, getDictationSettings(db, dataDir)); }
      if (req.method === 'DELETE') { removeKey(dataDir); return sendJson(res, 200, getDictationSettings(db, dataDir)); }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/dictations') {
      if (req.method === 'GET') {
        return sendJson(res, 200, listDictations(db, { q: url.searchParams.get('q') ?? '', before: url.searchParams.get('before') ?? '', limit: Number(url.searchParams.get('limit') ?? 50) }));
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const problem = checkDictationInput(input);
      if (problem) return sendJson(res, 400, { error: problem });
      return sendJson(res, 201, addDictation(db, input));
    }
    // GET /api/people/duplicates                  pairs that may be one person (advanced/people/7)
    // POST /api/people/duplicates/dismiss { a, b }  "Not the same person": the pair is hidden for good
    // POST /api/people/merge { keep, drop, fields? } keep one entry; Restore on the other (in Recently deleted) undoes it
    if (url.pathname === '/api/people/duplicates') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, findDuplicates(db));
    }
    if (url.pathname === '/api/people/duplicates/dismiss' || url.pathname === '/api/people/merge') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const id = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
      if (url.pathname.endsWith('/dismiss')) {
        if (!id(input.a) || !id(input.b)) return sendJson(res, 400, { error: 'Send { a, b }: two people’s ids.' });
        dismissDuplicate(db, input.a, input.b);
        return sendJson(res, 200, { dismissed: true });
      }
      if (!id(input.keep) || !id(input.drop)) return sendJson(res, 400, { error: 'Send { keep, drop }: two people’s ids.' });
      if (input.fields !== undefined && (typeof input.fields !== 'object' || input.fields === null || Array.isArray(input.fields))) return sendJson(res, 400, { error: 'fields is an object.' });
      return sendJson(res, 200, mergePeople(db, input.keep, input.drop, input.fields ?? {}));
    }
    // Bring your notes in (Writing 9):
    //   POST /api/import/obsidian { files: [{ path, text }], source?, dry_run? }   an Obsidian folder: every .md is a note (read only, safe to run twice)
    //   POST /api/import/dayone   { json, source?, dry_run? }                      a Day One export: every entry is a journal entry on its day
    //   GET  /api/import/runs                                                      the reports of earlier runs
    if (url.pathname === '/api/import/obsidian' || url.pathname === '/api/import/dayone' || url.pathname === '/api/import/runs') {
      if (!moduleOn(db, 'writing')) return sendJson(res, 409, { error: 'Writing and thinking is switched off.' });
      if (url.pathname === '/api/import/runs') return req.method === 'GET' ? sendJson(res, 200, listRuns(db)) : sendJson(res, 405, { error: 'Method not allowed' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try {
        return sendJson(res, 200, url.pathname.endsWith('obsidian')
          ? importObsidian(db, input.files, { dryRun: input.dry_run === true, source: String(input.source ?? '') })
          : importDayOne(db, input.json, { dryRun: input.dry_run === true, source: String(input.source ?? '') }));
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // POST /api/import/contacts { filename, text, dry_run? }   bring contacts in from a vCard or CSV (advanced/people/6)
    if (url.pathname === '/api/import/contacts') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      if (typeof input !== 'object' || input === null || typeof input.text !== 'string') return sendJson(res, 400, { error: 'Send { text, filename? } with the file’s text.' });
      return sendJson(res, 200, importContacts(db, { text: input.text, filename: String(input.filename ?? ''), dryRun: input.dry_run === true }));
    }
    // GET /api/reconnect                       who has a rhythm, the most overdue first (advanced/people/5)
    // POST /api/people/:id/remind              "Reconnect with <first name>" as a task for tomorrow
    if (url.pathname === '/api/reconnect') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, reconnectList(db));
    }
    const remindMatch = url.pathname.match(/^\/api\/people\/([0-9a-f-]{36})\/remind$/);
    if (remindMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      const made = remindToReconnect(db, remindMatch[1]);
      return made ? sendJson(res, made.existing ? 200 : 201, made) : sendJson(res, 404, { error: 'Not found' });
    }
    // POST /api/interactions { about: { kind: person|company, id }, kind, note, when? }   log what happened (advanced/people/4)
    // DELETE /api/interactions/:id, POST /api/interactions/:id/restore                     take it back, bring it back
    if (url.pathname === '/api/interactions') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const problem = checkInteractionInput(input);
      if (problem) return sendJson(res, 400, { error: problem });
      return sendJson(res, 201, logInteraction(db, input));
    }
    const interactionMatch = url.pathname.match(/^\/api\/interactions\/([0-9a-f-]{36})(\/restore)?$/);
    if (interactionMatch) {
      const [, id, restoring] = interactionMatch;
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreInteraction(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const deleted = deleteInteraction(db, id);
      return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
    }
    // Mail (advanced/mail/2). Every message you ever got, kept here; a Google Takeout .mbox is read in once.
    // POST /api/mail/import?account=<address>   the .mbox itself as the request body (X-File-Name: its name, URL-encoded),
    //                                            read one message at a time as it arrives; answers when it is all in
    // GET  /api/mail/import/status               what the file being read has done so far (read, added, per label)
    // GET  /api/mail?account=<id>                totals, labels with their counts, the files read in, the accounts
    // GET  /api/mail/threads?account=&label=&q=&before=&limit=   conversations, the latest first;  GET /api/mail/threads/:id one, with its messages
    if (url.pathname === '/api/mail/import') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      // A name header can't be sent by another website without asking first; this server never says yes.
      const name = req.headers['x-file-name'];
      if (!name) return sendJson(res, 400, { error: 'Send the file name in X-File-Name.' });
      let filename;
      try { filename = decodeURIComponent(name); } catch { return sendJson(res, 400, { error: 'X-File-Name is not valid.' }); }
      const email = checkAccountEmail(url.searchParams.get('account'));
      if (!email) return sendJson(res, 400, { error: 'Which address is this mail from? Give it as name@example.com.' });
      if (mailJob?.running) return sendJson(res, 409, { error: 'A mail file is being read in. Wait until it is done.' });
      const size = Number(req.headers['content-length']) || 0;
      const job = { running: true, filename, account: email, size, bytes: 0, read: 0, added: 0, already: 0, skipped: 0, labels: {}, started_at: new Date().toISOString(), finished_at: null, problem: '' };
      mailJob = job;
      try {
        const result = await importMboxStream(db, req, { email, filename, size, dataDir, onProgress: (p) => Object.assign(job, p) });
        Object.assign(job, { running: false, finished_at: new Date().toISOString() });
        return sendJson(res, 200, result);
      } catch (err) {
        Object.assign(job, { running: false, finished_at: new Date().toISOString(), problem: err.status ? err.message : 'The file could not be read to the end.' });
        throw err;
      }
    }
    // POST /api/mail/fill { account_id, everything? }   everything in Gmail newer than what is kept, or with everything: true all that is missing (read only; needs Read your mail on)
    // POST /api/mail/count-check { account_id }   each label: Gmail's count next to this app's
    if (url.pathname === '/api/mail/fill' || url.pathname === '/api/mail/count-check') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      const id = String(input.account_id ?? '');
      try {
        if (url.pathname === '/api/mail/count-check') return sendJson(res, 200, await countCheck(db, keyStore, { mailAccountId: id, env: googleEnv, fetcher: googleFetch }));
        if (mailJob?.running) return sendJson(res, 409, { error: 'A mail file is being read in. Wait until it is done.' });
        const job = { running: true, filename: 'Fill from Gmail', account: id, size: 0, bytes: 0, read: 0, added: 0, already: 0, skipped: 0, labels: {}, started_at: new Date().toISOString(), finished_at: null, problem: '' };
        mailJob = job;
        try {
          const result = await fillFromGmail(db, keyStore, { mailAccountId: id, dataDir, everything: input.everything === true, env: googleEnv, fetcher: googleFetch, onProgress: (p) => Object.assign(job, p) });
          Object.assign(job, { running: false, finished_at: new Date().toISOString() });
          return sendJson(res, 200, result);
        } catch (err) {
          Object.assign(job, { running: false, finished_at: new Date().toISOString(), problem: err.status ? err.message : 'The fill stopped half way.' });
          throw err;
        }
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        throw err;
      }
    }
    // The Mail app (Mail 5): the Inbox of what others sent you, in six splits by rules that can be read.
    // GET /api/mail/inbox?split=&account=&limit=&before=   the conversations of one split (inbox: the five together, important, calendar, money, news, other, done)
    //                                                      with the rule that put each there, and the count of every split
    // GET /api/mail/splits                                  the rules, in the order they are read
    if (url.pathname === '/api/mail/splits') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, describeSplits());
    }
    if (url.pathname === '/api/mail/inbox') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const split = url.searchParams.get('split') ?? 'inbox';
      if (!SPLIT_IDS.includes(split)) return sendJson(res, 400, { error: `split is ${SPLIT_IDS.join(', ')}.` });
      const account = url.searchParams.get('account') ?? '';
      const view = inboxView(db, { split, account, limit: Number(url.searchParams.get('limit') ?? 50), before: url.searchParams.get('before') ?? '' });
      // Drafts and the Outbox ride along with every split: the Outbox tab shows (with its count) only while something has not gone.
      const outbox = { drafts: listDrafts(db, { account }), sends: pendingSends(db, { account }), changes: pendingChanges(db, { account }) };
      view.counts.drafts = outbox.drafts.length;
      view.counts.outbox = outbox.sends.length + outbox.changes.length;
      view.outbox_failed = outbox.sends.filter((x) => x.state === 'failed').length + outbox.changes.filter((x) => x.state === 'failed').length;
      return sendJson(res, 200, { ...view, outbox });
    }
    // Drafts (schema 68): a mail being written, kept here as you type, in the Outbox until sent or discarded. Only here, never in Gmail.
    // GET /api/mail/unsent?account=   the drafts, the latest first;  POST /api/mail/unsent { id?, account_id, thread_id?, to, cc?, subject, body, remind_days?, confirm? }
    //   saves (answers { draft }, null when there was nothing worth keeping);  GET /api/mail/unsent/:id;  DELETE /api/mail/unsent/:id discards
    //   (kept, deleted_at);  POST /api/mail/unsent/:id/restore  Undo of a discard or a send
    if (url.pathname === '/api/mail/unsent') {
      if (req.method === 'GET') return sendJson(res, 200, listDrafts(db, { account: url.searchParams.get('account') ?? '' }));
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, { draft: saveDraft(db, (await readJson(req)) ?? {}) }); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    const unsentMatch = url.pathname.match(/^\/api\/mail\/unsent\/([0-9a-f-]{36})(\/restore)?$/);
    if (unsentMatch) {
      const [, id, restore] = unsentMatch;
      const run = restore ? (req.method === 'POST' ? restoreDraft : null) : req.method === 'GET' ? getDraft : req.method === 'DELETE' ? discardDraft : null;
      if (!run) return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, run(db, id)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // The Outbox (Sent and Outbox, 2026-11-11):
    // POST /api/mail/sends/:id/send-now | retry | dismiss    Send later → now; a failed mail again (you say so); let a failed one go (kept)
    // POST /api/mail/outbox/:id/retry | dismiss              a label change Gmail did not take: again, or let it go (skipped)
    const pendingMatch = url.pathname.match(/^\/api\/mail\/(sends|outbox)\/([0-9a-f-]{36})\/(send-now|retry|dismiss)$/);
    if (pendingMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const [, kind, id, act] = pendingMatch;
      const run = kind === 'sends' ? { 'send-now': sendNow, retry: retrySend, dismiss: dismissSend }[act] : { retry: retryMailChange, dismiss: dismissMailChange }[act];
      if (!run) return sendJson(res, 404, { error: 'Not found' });
      try { return sendJson(res, 200, run(db, id)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) }); throw err; }
    }
    // POST /api/mail/threads/:id/done           Done (e): the conversation leaves the Inbox; answers the mails changed
    // POST /api/mail/threads/:id/undo-done { messages }   Undo: exactly those mails come back to the Inbox
    // POST /api/mail/threads/:id/trash           Delete (#): every mail of it to Gmail's Trash (30 days there, never deleted for good), hidden here
    // POST /api/mail/threads/:id/undo-trash { messages, inbox }   Undo: out of the Trash, and back in the Inbox where they were
    const doneMatch = url.pathname.match(/^\/api\/mail\/threads\/([0-9a-f-]{36})\/(done|undo-done|trash|undo-trash)$/);
    if (doneMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      const act = { done: () => archiveThread(db, doneMatch[1]), 'undo-done': () => restoreToInbox(db, input.messages),
        trash: () => trashThread(db, doneMatch[1]), 'undo-trash': () => restoreFromTrash(db, input.messages, input.inbox) }[doneMatch[2]];
      try { return sendJson(res, 200, act()); } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message });
        throw err;
      }
    }
    // Mail 7: what you chose per sender. GET /api/mail/senders;  PUT /api/mail/senders { email, load_images }  (images are held back until you say so)
    if (url.pathname === '/api/mail/senders') {
      if (req.method === 'GET') return sendJson(res, 200, listSenders(db));
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      if (typeof input.load_images !== 'boolean') return sendJson(res, 400, { error: 'load_images is true or false.' });
      try { return sendJson(res, 200, setImagesOk(db, input.email, input.load_images)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // Writing mail (Mail 8). Needs the Google switch “Send mail as you”; every send waits ten seconds (Undo), or until you say.
    // GET  /api/mail/threads/:id/reply                    who a reply goes to, and its subject
    // POST /api/mail/sends { account_id, thread_id?, to, cc?, subject, body, when?: now | tomorrow | ISO time, remind_days?, delay_seconds? }
    // GET  /api/mail/sends?account=                        what was written, and where each is: waiting, sending, sent, undone, failed
    // POST /api/mail/sends/:id/undo                        take it back (only while it has not been claimed); answers its words
    // POST /api/mail/sends/run                             send what is due now, and make the reminders that are due
    const replyMatch = url.pathname.match(/^\/api\/mail\/threads\/([0-9a-f-]{36})\/reply$/);
    if (replyMatch) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, replyDraft(db, replyMatch[1])); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/mail/sends') {
      if (req.method === 'GET') return sendJson(res, 200, listSends(db, { account: url.searchParams.get('account') ?? '', limit: Number(url.searchParams.get('limit') ?? 20) }));
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try {
        const made = composeSend(db, { accountId: String(input.account_id ?? ''), threadId: input.thread_id ?? null, to: input.to, cc: input.cc ?? [], subject: input.subject, body: input.body,
          when: input.when ?? 'now', remindDays: input.remind_days ?? 0, seconds: Math.min(60, Number(input.delay_seconds ?? 10)), confirm: input.confirm === true });
        if (typeof input.card_id === 'string') markCardEdited(db, input.card_id, made.id); // a draft opened with Edit and sent from the composer is answered
        if (typeof input.draft_id === 'string') { try { discardDraft(db, input.draft_id); } catch { /* already gone */ } } // sent: no longer a draft (Undo brings it back)
        return sendJson(res, 201, made);
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/mail/sends/run') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const sent = await sendDue(db, keyStore, { env: googleEnv, fetcher: googleFetch });
      return sendJson(res, 200, { sent, reminders: remindDue(db) });
    }
    const undoSendMatch = url.pathname.match(/^\/api\/mail\/sends\/([0-9a-f-]{36})\/undo$/);
    if (undoSendMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, undoSend(db, undoSendMatch[1])); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) }); throw err; }
    }
    // Read confirmations (Mail 9). GET /api/mail/confirmations → { base, people };  PUT /api/mail/pixel-base { base }: the address of this app as the
    // other side can reach it, for the one-pixel picture ('' takes it away). Off by default, per mail, remembered per person.
    if (url.pathname === '/api/mail/confirmations') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, { base: pixelBase(db), people: confirmPeople(db) });
    }
    if (url.pathname === '/api/mail/pixel-base') {
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, setPixelBase(db, ((await readJson(req)) ?? {}).base)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // Mail meets People (Mail 10).
    // POST /api/mail/people { email, name?, subject? }     a new sender becomes a person, marked "From a mail" (the one already there if it is known)
    // GET  /api/mail/with?kind=person|company&id=          the conversations with a person or a company, and the day you were last in touch by mail
    if (url.pathname === '/api/mail/people') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try { const made = addSender(db, input); return sendJson(res, made.created ? 201 : 200, made); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/mail/with') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const kind = url.searchParams.get('kind');
      const id = url.searchParams.get('id') ?? '';
      if (!['person', 'company'].includes(kind) || !/^[0-9a-f-]{36}$/.test(id)) return sendJson(res, 400, { error: 'kind is person or company, and id is theirs.' });
      return sendJson(res, 200, mailWith(db, { kind, id, limit: Number(url.searchParams.get('limit') ?? 20) }));
    }
    // From mail to action (Mail 11).
    // POST /api/mail/threads/:id/task { split? }      t on a mail: a task with the subject, linked back to it (from Money: due in two weeks)
    // GET  /api/mail/limits                           what your assistant may do with your mail, read only: the numbers it is held to in code
    // GET  /api/mail/drafts/:cardId                   a draft your assistant made, to open in the composer (Edit)
    const taskMatch2 = url.pathname.match(/^\/api\/mail\/threads\/([0-9a-f-]{36})\/task$/);
    if (taskMatch2) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try { return sendJson(res, 201, mailToTask(db, taskMatch2[1], { split: String(input.split ?? '') })); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/mail/limits') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, { limits: LIMITS, rules: describeLimits(), drafted_today: draftsToday(db) });
    }
    const draftMatch = url.pathname.match(/^\/api\/mail\/drafts\/([0-9a-f-]{36})$/);
    if (draftMatch) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const card = getAction(db, draftMatch[1]);
      if (!card || card.kind !== 'mail_send' || card.state !== 'proposed') return sendJson(res, 404, { error: 'That draft is not waiting any more.' });
      return sendJson(res, 200, { ...card.after, card_id: card.id });
    }
    // Live with Gmail (Mail 4).
    // POST /api/mail/sync { account_id }          one round now: Gmail's changes in, yours out
    // POST /api/mail/live { account_id, on }      the job that does it every 20 seconds, for this account (off until switched on)
    // POST /api/mail/messages/:id/labels { add?, remove? }   change a mail's labels here (archive: remove Inbox; star: add Starred): the
    //                                                       list changes at once and the change goes to Gmail by the outbox
    // GET  /api/mail/outbox?account=              what was changed here, and where it is on its way
    if (url.pathname === '/api/mail/sync' || url.pathname === '/api/mail/live') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      const id = String(input.account_id ?? '');
      try {
        if (url.pathname === '/api/mail/live') {
          if (typeof input.on !== 'boolean') return sendJson(res, 400, { error: 'on is true or false.' });
          if (input.on && !canRead(db, id)) return sendJson(res, 409, { error: 'Switch on “Read your mail” for this address under Settings › Google first.' });
          return sendJson(res, 200, setLive(db, id, input.on));
        }
        return sendJson(res, 200, await syncOnce(db, keyStore, { mailAccountId: id, dataDir, env: googleEnv, fetcher: googleFetch }));
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        throw err;
      }
    }
    if (url.pathname === '/api/mail/outbox') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, listOutbox(db, { account: url.searchParams.get('account') ?? '', limit: Number(url.searchParams.get('limit') ?? 20) }));
    }
    const labelsMatch = url.pathname.match(/^\/api\/mail\/messages\/([0-9a-f-]{36})\/labels$/);
    if (labelsMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try { return sendJson(res, 200, changeLabels(db, labelsMatch[1], { add: input.add, remove: input.remove })); } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        throw err;
      }
    }
    if (url.pathname === '/api/mail/import/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, mailJob ?? { running: false });
    }
    if (url.pathname === '/api/mail') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const overview = mailOverview(db, { account: url.searchParams.get('account') ?? '' });
      return sendJson(res, 200, { ...overview, accounts: overview.accounts.map(({ google_account_id: g, ...a }) => ({ ...a, signed_in: Boolean(g), can_read: canRead(db, a.id), can_send: canSend(db, a.id), google_account_id: g ?? null, sync: syncState(db, a.id) })) });
    }
    if (url.pathname === '/api/mail/threads') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, listThreads(db, {
        account: url.searchParams.get('account') ?? '', label: url.searchParams.get('label') ?? '', q: url.searchParams.get('q') ?? '',
        before: url.searchParams.get('before') ?? '', limit: Number(url.searchParams.get('limit') ?? 50),
      }));
    }
    const threadMatch = url.pathname.match(/^\/api\/mail\/threads\/([0-9a-f-]{36})$/);
    if (threadMatch) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const thread = getThread(db, threadMatch[1]);
      return thread ? sendJson(res, 200, { ...thread, rule: explainThread(db, thread.id), confirmations: confirmationsOf(db, thread.id), people: peopleOfThread(db, thread.id), tasks: tasksOf(db, thread.id), invites: invitesOfThread(db, thread.id) }) : sendJson(res, 404, { error: 'No such conversation' });
    }
    // Invitations in a mail (Mail 12):
    //   POST /api/mail/messages/:id/invite { answer: yes | maybe | no }   your Calendar and the answer to the organiser, by mail (ten seconds to undo)
    //   POST /api/mail/messages/:id/invite/undo                          take it back, while the mail has not gone
    const inviteMatch = url.pathname.match(/^\/api\/mail\/messages\/([0-9a-f-]{36})\/invite(\/undo)?$/);
    if (inviteMatch) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      try {
        if (inviteMatch[2]) return sendJson(res, 200, undoAnswer(db, inviteMatch[1]));
        if (!PARTSTAT[input.answer]) return sendJson(res, 400, { error: 'answer is yes, maybe or no.' });
        return sendJson(res, 200, answerInvite(db, inviteMatch[1], PARTSTAT[input.answer]));
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message, code: err.code }); throw err; }
    }
    // Capture from anywhere (Tasks in depth 6): the devices that may post a capture from outside.
    //   GET    /api/capture/devices                    the devices (no token)
    //   POST   /api/capture/devices { name, kind }     a new device: answers it with its token, this once
    //   DELETE /api/capture/devices/:id                revoke: its token is forgotten
    if (url.pathname === '/api/capture/devices') {
      if (req.method === 'GET') return sendJson(res, 200, listDevices(db));
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      return sendJson(res, 201, await addDevice(db, captureKeys, { name: input.name, kind: input.kind }));
    }
    const deviceMatch = url.pathname.match(/^\/api\/capture\/devices\/([0-9a-f-]{36})$/);
    if (deviceMatch) {
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const gone = await revokeDevice(db, captureKeys, deviceMatch[1]);
      return gone ? sendJson(res, 200, gone) : sendJson(res, 404, { error: 'Not found' });
    }
    // Google (advanced/mail/1). No token ever leaves the key store, and none is sent to a page.
    // GET /api/google                          the client (its ID only), the accounts with their switches and health, the log
    // PUT /api/google/client { client_id, client_secret }   the owner's own Google client; DELETE removes it
    // POST /api/google/connect { account_id?, permission? } → { url }   the address of Google's sign-in page
    // GET /api/google/callback?code&state      where Google sends the browser back; then on to Settings
    // PATCH /api/google/accounts/:id { permission, on }  → { account } or { url } when Google has to be asked
    // POST /api/google/accounts/:id/check      does Google still let the app in?;  DELETE /api/google/accounts/:id signs out
    if (url.pathname.startsWith('/api/google')) {
      const sendState = async (status = 200) => { const problem = googleProblem; googleProblem = ''; return sendJson(res, status, await getGoogle(db, keyStore, { problem })); };
      try {
        if (url.pathname === '/api/google') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          return await sendState();
        }
        if (url.pathname === '/api/google/client') {
          if (req.method === 'PUT') { await saveClient(db, keyStore, (await readJson(req)) ?? {}); return await sendState(); }
          if (req.method === 'DELETE') { await removeClient(db, keyStore); return await sendState(); }
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        if (url.pathname === '/api/google/connect') {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
          const input = (await readJson(req)) ?? {};
          return sendJson(res, 200, await beginSignIn(db, keyStore, { pending: signIns, redirectUri: googleRedirect, accountId: input.account_id ?? null, permission: input.permission ?? null, env: googleEnv }));
        }
        if (url.pathname === '/api/google/callback') {
          if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
          const back = (outcome) => { res.writeHead(302, { Location: `/settings?google=${outcome}` }); res.end(); };
          if (url.searchParams.get('error')) { googleProblem = 'Google was not allowed to sign you in (you said no, or closed the page).'; return back('denied'); }
          try {
            const done = await finishSignIn(db, keyStore, { pending: signIns, state: url.searchParams.get('state') ?? '', code: url.searchParams.get('code') ?? '', env: googleEnv, fetcher: googleFetch });
            if (done.return_to) { res.writeHead(302, { Location: done.return_to }); return res.end(); } // back to the page it started from
            return back('ok');
          } catch (err) { googleProblem = err.status ? err.message : 'Something went wrong signing in.'; return back('failed'); }
        }
        const accountMatch = url.pathname.match(/^\/api\/google\/accounts\/([0-9a-f-]{36})(\/check)?$/);
        if (accountMatch) {
          const [, id, checking] = accountMatch;
          if (checking) {
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
            await readJson(req);
            return sendJson(res, 200, await checkHealth(db, keyStore, id, { env: googleEnv, fetcher: googleFetch }));
          }
          if (req.method === 'PATCH') {
            const input = (await readJson(req)) ?? {};
            return sendJson(res, 200, await switchPermission(db, keyStore, { pending: signIns, redirectUri: googleRedirect, id, permission: input.permission, on: input.on, returnTo: input.return_to ?? '', env: googleEnv }));
          }
          if (req.method === 'DELETE') { await disconnect(db, keyStore, id, { env: googleEnv, fetcher: googleFetch }); return await sendState(); }
          return sendJson(res, 405, { error: 'Method not allowed' });
        }
        return sendJson(res, 404, { error: 'Not found' });
      } catch (err) {
        if (err.status) return sendJson(res, err.status, { error: err.message, ...(err.code ? { code: err.code } : {}) });
        throw err;
      }
    }
    // Help pages (module help, advanced/last/2 and 3; off in a new install):
    //   GET /api/docs       the pages for the modules that are on: [{ id, title, module, paths }] ([] while Help pages is off)
    //   GET /api/docs/:id   one page: { id, title, module, paths, markdown }
    if (url.pathname === '/api/docs') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, listDocs(db).map(({ markdown, ...d }) => d));
    }
    const docMatch = url.pathname.match(/^\/api\/docs\/([a-z0-9-]+)$/);
    if (docMatch) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const doc = readDoc(db, docMatch[1]);
      return doc ? sendJson(res, 200, doc) : sendJson(res, 404, { error: 'There is no such help page, or Help pages is switched off.' });
    }
    if (url.pathname === '/api/modules') {
      if (req.method === 'GET') return sendJson(res, 200, listModules(db));
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkModuleInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, setModule(db, input.id, input.on));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // Phone, backups and moving (module everywhere, myICOR advanced/everywhere 3, 8 and 11; off in a new install):
    //   GET    /api/backups            the kept daily copies, newest first, each with its check { ok, rows, tables, problem? }
    //   POST   /api/backups/check {}   checks every kept copy again
    //   GET    /api/move/file          downloads a moving file: the database and every kept file, in one .tar.gz
    //   GET    /api/move               what waits to be brought in, and the last move
    //   POST   /api/move               a moving file as the body (Content-Type: application/x-sovran-move): read, checked, waits
    //   POST   /api/move/confirm {}    your yes: it takes the place of what is here at the restart that follows
    //   DELETE /api/move               the moving file that waits is put away; nothing changes
    //   GET    /api/phone              { addresses }: where a phone opens the Capture page (the private names in data/hosts.txt)
    if (url.pathname === '/api/phone' || url.pathname === '/api/backups' || url.pathname === '/api/backups/check' || url.pathname.startsWith('/api/move')) {
      if (!moduleOn(db, 'everywhere')) return sendJson(res, 409, { error: 'Phone, backups and moving is switched off (Settings › Modules).' });
      if (url.pathname === '/api/phone') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 200, { addresses: hosts.map((h) => `https://${h}/quick`) });
      }
      const shown = (list) => list.map(({ day, bytes, check }) => ({ day, bytes, check }));
      if (url.pathname === '/api/backups') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 200, shown(listBackups(dataDir)));
      }
      if (url.pathname === '/api/backups/check') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        return sendJson(res, 200, shown(checkAllBackups(dataDir)));
      }
      if (url.pathname === '/api/move/file') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${moveFileName()}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        try { await writeMoveFile(db, dataDir, res); } catch { res.destroy(); }
        return undefined;
      }
      if (url.pathname === '/api/move/confirm') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const status = confirmMove(dataDir);
        if (!onRestart) return sendJson(res, 200, { ...status, restarting: false });
        sendJson(res, 200, { ...status, restarting: true });
        setTimeout(onRestart, 100);
        return undefined;
      }
      if (url.pathname === '/api/move') {
        if (req.method === 'GET') return sendJson(res, 200, moveStatus(dataDir));
        if (req.method === 'DELETE') return sendJson(res, 200, cancelMove(dataDir));
        if (req.method === 'POST') {
          // A type another website can't send without asking first (and this server never says yes): only the app's own page.
          if (req.headers['content-type'] !== 'application/x-sovran-move') return sendJson(res, 415, { error: 'Send the moving file as application/x-sovran-move.' });
          return sendJson(res, 200, { ...(await receiveMoveFile(dataDir, req)), waiting: true, confirmed: false });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      return sendJson(res, 404, { error: 'Not found' });
    }

    // POST /api/quit {}   stops the app (npm run stop; updating needs it stopped). Only when started as the app itself.
    if (url.pathname === '/api/quit' && onQuit) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      sendJson(res, 200, { stopping: true });
      setTimeout(onQuit, 100);
      return undefined;
    }
    // POST /api/restart {}   stops the app and starts it again (Settings > Restart), so an update or a changed
    // database takes effect without the Terminal. Only when started as the app itself.
    if (url.pathname === '/api/restart' && onRestart) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      sendJson(res, 200, { restarting: true });
      setTimeout(onRestart, 100);
      return undefined;
    }
    // The welcome (welcome.js): GET /api/welcome → { seen, name, assistant_ready };  PATCH /api/welcome { name?, seen? }
    // The Sovran Library (sovran-library.js): GET /api/library → { connected, key_end };  PUT /api/library { key } ('' removes it)
    // The course page (course.js): GET /api/course → { url, own };  PUT /api/course { url } ('' goes back to the app's own)
    if (url.pathname === '/api/course') {
      if (req.method === 'GET') return sendJson(res, 200, getCourse(db));
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, setCourseUrl(db, ((await readJson(req)) ?? {}).url)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // Your assistant's AI (ai.js): GET /api/assistant/ai → { provider, ready: { claude, codex } };  PUT { provider: claude | codex }
    if (url.pathname === '/api/assistant/ai') {
      if (req.method === 'GET') return sendJson(res, 200, getAssistantChoice(db, commands));
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      try {
        setProvider(db, ((await readJson(req)) ?? {}).provider);
        return sendJson(res, 200, getAssistantChoice(db, commands));
      } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    // The Check button (ai.js): POST /api/assistant/check → { provider, program, platform, command, plan, result, detail },
    //   result one of working, missing, signed_out, free, other. One check at a time: a second press waits for the first.
    if (url.pathname === '/api/assistant/check') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!checking) {
        const { provider, command } = ai();
        checking = checkAssistant({ provider, command, folder: path.join(dataDir, 'assistant', 'check'), env: provider === 'codex' ? codexEnv() : claudeEnv() })
          .finally(() => { checking = null; });
      }
      return sendJson(res, 200, await checking);
    }
    // Model and effort (ai-pick.js, module ai-pick): GET /api/assistant/pick?chat=<id> → { on, provider, models, efforts, model, effort }
    //   for the AI that answers now; PUT { chat?, model?, effort? } keeps it, for that AI, for that chat and for a new chat
    if (url.pathname === '/api/assistant/pick') {
      const on = moduleOn(db, 'ai-pick');
      if (req.method === 'GET') {
        const chat = url.searchParams.get('chat');
        if (chat && !/^[0-9a-f-]{36}$/.test(chat)) return sendJson(res, 400, { error: 'chat is a chat’s id.' });
        return sendJson(res, 200, pickState(db, chat, on, ai().provider));
      }
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!on) return sendJson(res, 409, { error: 'Switch on Model and effort in Settings › Modules first.' });
      const input = { ...((await readJson(req)) ?? {}), provider: ai().provider };
      const problem = checkPickInput(input);
      if (problem) return sendJson(res, 400, { error: problem });
      setPick(db, input);
      return sendJson(res, 200, pickState(db, input.chat ?? null, on, input.provider));
    }
    if (url.pathname === '/api/library') {
      if (req.method === 'GET') return sendJson(res, 200, getLibrary(db));
      if (req.method !== 'PUT') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, setLibraryKey(db, ((await readJson(req)) ?? {}).key)); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/welcome') {
      if (req.method === 'GET') return sendJson(res, 200, getWelcome(db, ai()));
      if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
      try { return sendJson(res, 200, setWelcome(db, (await readJson(req)) ?? {}, ai())); } catch (err) { if (err.status) return sendJson(res, err.status, { error: err.message }); throw err; }
    }
    if (url.pathname === '/api/settings') {
      if (req.method === 'GET') return sendJson(res, 200, getSettings(db));
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkSettingsInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 200, updateSettings(db, input));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/blocks') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = await readJson(req);
      const problem = checkBlockInput(input, { creating: true });
      if (problem) return sendJson(res, 400, { error: problem });
      return sendJson(res, 201, createBlock(db, input));
    }
    const blockMatch = url.pathname.match(/^\/api\/blocks\/([0-9a-f-]{36})(\/restore)?$/);
    if (blockMatch) {
      const [, id, restoring] = blockMatch;
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreBlock(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkBlockInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = updateBlock(db, id, input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'DELETE') {
        const deleted = deleteBlock(db, id);
        return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // Your other calendars, by iCal link (time/1):
    //   GET    /api/calendars          each with its name, colour, when it was last read
    //   POST   /api/calendars          { url, name? }: added and read at once
    //   PATCH  /api/calendars/:id      { name?, colour? }
    //   DELETE /api/calendars/:id,  POST /api/calendars/:id/restore,  POST /api/calendars/:id/read
    // My events' colour:  GET / PATCH /api/calendars/own  { colour: 1 to 6 }
    if (url.pathname === '/api/calendars/own') {
      if (req.method === 'GET') return sendJson(res, 200, { colour: ownColour(db) });
      if (req.method === 'PATCH') { const input = await readJson(req); return sendJson(res, 200, setOwnColour(db, input?.colour)); }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    // Routines (Calendar in depth): GET / POST /api/templates, DELETE /api/templates/:id, POST /api/templates/:id/restore and
    // POST /api/templates/:id/place { due, plan_part, plan_at? } (makes a task, never an event).
    if (url.pathname === '/api/templates') {
      if (req.method === 'GET') return sendJson(res, 200, moduleOn(db, 'calendar-plus') ? listTemplates(db) : []);
      if (req.method === 'POST') {
        if (!moduleOn(db, 'calendar-plus')) return sendJson(res, 409, { error: 'Calendar in depth is switched off.' });
        const input = await readJson(req);
        const problem = checkTemplateInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 201, createTemplate(db, input));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const templateMatch = url.pathname.match(/^\/api\/templates\/([0-9a-f-]{36})(\/restore|\/place)?$/);
    if (templateMatch) {
      const [, id, action] = templateMatch;
      if (!moduleOn(db, 'calendar-plus')) return sendJson(res, 409, { error: 'Calendar in depth is switched off.' });
      if (action === '/place') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        return sendJson(res, 201, placeTemplate(db, id, await readJson(req)));
      }
      if (action === '/restore') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const back = restoreTemplate(db, id);
        return back ? sendJson(res, 200, back) : sendJson(res, 404, { error: 'No such routine.' });
      }
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const gone = removeTemplate(db, id);
      return gone ? sendJson(res, 200, gone) : sendJson(res, 404, { error: 'No such routine.' });
    }
    // Google Calendar (Calendar in depth 7): GET /api/gcal (what was read, per account), POST /api/gcal/read { account_id }.
    if (url.pathname === '/api/gcal') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, moduleOn(db, 'calendar-google') ? googleCalendarState(db) : []);
    }
    if (url.pathname === '/api/gcal/read') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      if (!moduleOn(db, 'calendar-google')) return sendJson(res, 409, { error: 'Google Calendar is switched off (Settings › Modules).' });
      return sendJson(res, 200, await readGoogleCalendar(db, keyStore, { accountId: String(input.account_id ?? ''), env: googleEnv, fetcher: googleFetch }));
    }
    // Changing Google events (Calendar in depth 8): PATCH /api/gevents/:id { title?, starts_at?, ends_at?, location?, note? } (the guards, the outbox),
    // GET /api/gcal/outbox, POST /api/gcal/outbox/send (send what waits now), POST /api/gcal/outbox/:id/resolve { use: mine | google },
    // GET / PATCH /api/gcal/guards { fields: [ids] }.
    // POST /api/gevents { account_id, calendar_id, title, starts_at, ends_at, location?, note?, people?: [ids], emails?: [..], meet? } makes a new event (Calendar 9);
    // PATCH /api/gevents/:id may carry scope: 'all' to move a whole repeating series; POST /api/gevents/:id/answer { response } answers an invitation;
    // GET /api/gcal/calendars lists where a new event may go.
    if (url.pathname === '/api/gevents') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 201, createGoogleEvent(db, (await readJson(req)) ?? {}));
    }
    if (url.pathname === '/api/gcal/calendars') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, moduleOn(db, 'calendar-google') ? writableCalendars(db) : []);
    }
    const gAnswer = url.pathname.match(/^\/api\/gevents\/([0-9a-f-]{36})\/answer$/);
    if (gAnswer) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, answerGoogleEvent(db, gAnswer[1], ((await readJson(req)) ?? {}).response));
    }
    const gEvent = url.pathname.match(/^\/api\/gevents\/([0-9a-f-]{36})$/);
    if (gEvent) {
      if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
      const input = (await readJson(req)) ?? {};
      return sendJson(res, 200, changeGoogleEvent(db, gEvent[1], input, { scope: input.scope === 'all' ? 'all' : 'this' }));
    }
    if (url.pathname === '/api/gcal/guards') {
      if (req.method === 'GET') return sendJson(res, 200, getGuards(db));
      if (req.method === 'PATCH') return sendJson(res, 200, setGuards(db, (await readJson(req)) ?? {}));
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/gcal/outbox') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, moduleOn(db, 'calendar-google') ? listGoogleOutbox(db) : []);
    }
    if (url.pathname === '/api/gcal/outbox/send') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      return sendJson(res, 200, await sendGoogleCalendar(db, keyStore, { env: googleEnv, fetcher: googleFetch, force: true }));
    }
    const gRetry = url.pathname.match(/^\/api\/gcal\/outbox\/([0-9a-f-]{36})\/retry$/);
    if (gRetry) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      return sendJson(res, 200, retryChange(db, gRetry[1]));
    }
    const gClash = url.pathname.match(/^\/api\/gcal\/outbox\/([0-9a-f-]{36})\/resolve$/);
    if (gClash) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, resolveGoogleClash(db, gClash[1], ((await readJson(req)) ?? {}).use));
    }
    // Settings › Background jobs: each job with how often it runs and when it last did.
    if (url.pathname === '/api/jobs') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 200, [calendarJob(db, readCalendarsEvery), googleCalendarJob(db, googleCalendarEvery), googleCalendarSendJob(db, googleCalendarSendEvery)]);
    }
    if (url.pathname === '/api/calendars') {
      if (req.method === 'GET') return sendJson(res, 200, listCalendars(db));
      if (req.method === 'POST') {
        if (!moduleOn(db, 'calendar-links')) return sendJson(res, 409, { error: 'Calendar links are switched off (Settings › Modules).' });
        const input = await readJson(req);
        const problem = checkCalendarInput(input, { creating: true });
        if (problem) return sendJson(res, 400, { error: problem });
        const added = addCalendar(db, input);
        return sendJson(res, 201, await readCalendar(db, added.id));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const calendarMatch = url.pathname.match(/^\/api\/calendars\/([0-9a-f-]{36})(\/restore|\/read)?$/);
    if (calendarMatch) {
      const [, id, action] = calendarMatch;
      if (action) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        if (!moduleOn(db, 'calendar-links')) return sendJson(res, 409, { error: 'Calendar links are switched off (Settings › Modules).' });
        const done = action === '/restore' ? restoreCalendar(db, id) : await readCalendar(db, id);
        return done ? sendJson(res, 200, done) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkCalendarInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = updateCalendar(db, id, input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'DELETE') {
        const removed = removeCalendar(db, id);
        return removed ? sendJson(res, 200, removed) : sendJson(res, 404, { error: 'Not found' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // My Life (pkm/3):
    //   GET    /api/life             every item that is not deleted, active and archived
    //   GET    /api/life?deleted=1   the items deleted
    //   POST   /api/life             add one: { kind, title, home_id?, serves?, …its fields }
    //   GET / PATCH / DELETE /api/life/:id,  POST /api/life/:id/restore
    //   GET    /api/life/:id/notes?offset=   the notes at home there (a Key Element's: also those under it, each with its home), newest first, 20 at a time
    if (url.pathname === '/api/life') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedLifeItems(db));
        // Habits (My Life in depth) are left out while the module is off; the rows wait.
        return sendJson(res, 200, moduleOn(db, 'mylife-plus') ? listLifeItems(db) : listLifeItems(db).filter((item) => item.kind !== 'habit'));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkLifeInput({ title: '', ...input });
        if (problem) return sendJson(res, 400, { error: problem });
        if (input.kind === 'habit' && !moduleOn(db, 'mylife-plus')) return sendJson(res, 409, { error: 'My Life in depth is switched off.' });
        return sendJson(res, 201, createLifeItem(db, input));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const lifeItem = url.pathname.match(/^\/api\/life\/([0-9a-f-]{36})(\/restore|\/notes)?$/);
    if (lifeItem) {
      const [, id, after] = lifeItem;
      if (after === '/notes') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
        return sendJson(res, 200, notesAtHome(db, id, { offset }));
      }
      const restoring = after === '/restore';
      if (restoring) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        await readJson(req);
        const restored = restoreLifeItem(db, id);
        return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'GET') {
        const found = getLifeItem(db, id);
        return found ? sendJson(res, 200, found) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkLifeInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = updateLifeItem(db, id, input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'Not found' });
      }
      if (req.method === 'DELETE') {
        const deleted = deleteLifeItem(db, id);
        return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'Not found' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (url.pathname === '/api/journals') {
      if (req.method === 'GET') return sendJson(res, 200, listJournals(db));
      if (req.method === 'POST') {
        const input = await readJson(req);
        return sendJson(res, 201, createJournal(db, input?.name));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const journal = url.pathname.match(/^\/api\/journals\/([0-9a-f-]{36})$/);
    if (journal) {
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const deleted = deleteJournal(db, journal[1]);
      return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'No such journal' });
    }

    const day = (name) => {
      const value = url.searchParams.get(name);
      if (value !== null && !isDay(value)) throw Object.assign(new Error(`${name} must be a date like 2026-10-25.`), { status: 400 });
      return value;
    };
    const journalId = url.searchParams.get('journal') || undefined;

    if (url.pathname === '/api/entries') {
      if (req.method === 'GET') {
        if (url.searchParams.get('deleted') === '1') return sendJson(res, 200, listDeletedEntries(db));
        if (url.searchParams.has('q')) return sendJson(res, 200, searchEntries(db, url.searchParams.get('q')));
        if (url.searchParams.has('before')) {
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 200);
          return sendJson(res, 200, entriesBefore(db, day('before'), { journalId, limit }));
        }
        return sendJson(res, 200, entriesOfDay(db, day('day') ?? localDay(), { journalId }));
      }
      if (req.method === 'POST') {
        const input = await readJson(req);
        const problem = checkEntryInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        return sendJson(res, 201, createEntry(db, {
          journal_id: input.journal_id, day: input.day, title: input.title, body: input.body,
        }));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (url.pathname === '/api/entries/days') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const from = day('from');
      const to = day('to');
      if (!from || !to) return sendJson(res, 400, { error: 'Send from and to, like from=2026-10-01&to=2026-10-31.' });
      return sendJson(res, 200, entryDays(db, from, to, { journalId }));
    }

    const entry = url.pathname.match(/^\/api\/entries\/([0-9a-f-]{36})$/);
    if (entry) {
      if (req.method === 'GET') {
        const found = getEntry(db, entry[1]);
        return found ? sendJson(res, 200, found) : sendJson(res, 404, { error: 'No such entry' });
      }
      if (req.method === 'PATCH') {
        const input = await readJson(req);
        const problem = checkEntryInput(input);
        if (problem) return sendJson(res, 400, { error: problem });
        const changed = updateEntry(db, entry[1], input);
        return changed ? sendJson(res, 200, changed) : sendJson(res, 404, { error: 'No such entry' });
      }
      if (req.method === 'DELETE') {
        const deleted = deleteEntry(db, entry[1]);
        return deleted ? sendJson(res, 200, deleted) : sendJson(res, 404, { error: 'No such entry' });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    const restoreEntryPath = url.pathname.match(/^\/api\/entries\/([0-9a-f-]{36})\/restore$/);
    if (restoreEntryPath) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      await readJson(req);
      const restored = restoreEntry(db, restoreEntryPath[1]);
      return restored ? sendJson(res, 200, restored) : sendJson(res, 404, { error: 'No such entry' });
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // Only pages from this app may use it: not another website open in the same browser.
    if (!ownHosts.includes(req.headers.host)) return sendJson(res, 403, { error: 'Not allowed' });

    if (url.pathname.startsWith('/api/')) {
      // Anything saved may have made or changed a long task.
      if (req.method !== 'GET' && url.pathname !== '/api/mcp') res.once('finish', () => titler.soon());
      try {
        return await api(req, res, url);
      } catch (err) {
        return sendJson(res, err.status ?? 500, { error: err.status ? err.message : 'Something went wrong' });
      }
    }

    // The one address anything outside may reach (Mail 9): the picture of a read confirmation. It looks the token up, writes a row, returns the
    // pixel, and answers the same picture for a token it does not know. Only while Mail is on.
    const pixelMatch = req.method === 'GET' && url.pathname.match(/^\/o\/([A-Za-z0-9_-]{20,40})\.gif$/);
    if (pixelMatch) {
      if (moduleOn(db, 'mail')) { try { recordOpen(db, pixelMatch[1], { userAgent: String(req.headers['user-agent'] ?? '') }); } catch { /* the picture is answered all the same */ } }
      res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': PIXEL.length, 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' });
      return res.end(PIXEL);
    }

    // POST /capture   { text?, link? } with the device's token in X-Capture-Token (or Authorization: Bearer): a capture for the
    // Inbox from outside the app (a bookmarklet, a share sheet). Another website may ask (OPTIONS): the answer is the token, not who asks.
    if (url.pathname === '/capture' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      const cors = {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600',
        'Access-Control-Allow-Headers': 'Content-Type, X-Capture-Token, Authorization', 'Access-Control-Allow-Private-Network': 'true',
      };
      const answer = (status, data) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      try {
        if (!moduleOn(db, 'tasks-plus')) return answer(503, { error: 'This module is off.' });
        const header = req.headers['x-capture-token'] ?? String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const device = await deviceForToken(db, captureKeys, header);
        if (!device) return answer(401, { error: 'That token is not known. Revoked, or not copied whole?' });
        const input = await readJson(req);
        const problem = checkShareInput(input);
        if (problem) return answer(400, { error: problem });
        const made = shareCapture(db, device, input);
        reader.read(made.id); // saving never waits for it
        readLink(db, made.id, { fetcher: linkFetcher });
        return answer(201, { ok: true, id: made.id, kept: 'In your Inbox.' });
      } catch (err) {
        return answer(err.status ?? 500, { error: err.status ? err.message : 'Something went wrong' });
      }
    }

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    // A kept file. Pictures, PDFs, text, sound and video show in the browser; anything
    // else (HTML, SVG…) is only handed over as a download, so it can never run as part of
    // the app. Either way the browser must not guess another type, and nothing in it may
    // run scripts.
    const kept = url.pathname.match(/^\/files\/([0-9a-f]{64})$/);
    if (kept) {
      const file = getFile(db, kept[1]);
      const onDisk = path.join(filesDir(dataDir), kept[1]);
      if (!file || !fs.existsSync(onDisk)) return sendJson(res, 404, { error: 'No such file' });
      const inline = showsInline(file.type);
      res.writeHead(200, {
        'Content-Type': inline ? file.type : 'application/octet-stream',
        'Content-Length': file.size,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        // A browser won't show a PDF in a sandbox; its own viewer keeps a PDF apart anyway.
        'Content-Security-Policy': `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'${file.type === 'application/pdf' ? '' : '; sandbox'}`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
      return fs.createReadStream(onDisk).pipe(res);
    }

    // The capture page for a phone's home screen (module everywhere, myICOR advanced/everywhere/8): /quick opens straight
    // into a box that keeps one thought in the Inbox. While the module is off it says so and points to Settings.
    if (req.method === 'GET' && url.pathname === '/quick') {
      const file = path.join(publicDir, moduleOn(db, 'everywhere') ? 'quick.html' : 'quick-off.html');
      return fs.readFile(file, (err, body) => {
        if (err) return sendJson(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(body);
      });
    }

    // Static files: only from public/, never from anywhere else. A path without a file
    // extension (like /notes/…) is a screen of the app: the page works out which.
    const page = url.pathname === '/' || !path.extname(url.pathname);
    const file = page ? path.join(publicDir, 'index.html') : path.join(publicDir, url.pathname);
    if (!file.startsWith(publicDir + path.sep)) return sendJson(res, 404, { error: 'Not found' });
    fs.readFile(file, (err, body) => {
      if (err) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    });
  });

  return new Promise((resolve) => {
    // 127.0.0.1 only: the app answers this computer, nobody else on the network.
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      ownHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, ...hosts];
      const url = `http://127.0.0.1:${actualPort}`;
      googleRedirect = `${url}/api/google/callback`;
      mcpUrl = `${url}/api/mcp`;
      mailSender = startMailSender(db, keyStore, { env: googleEnv, fetcher: googleFetch, every: mailSyncEvery ? 2000 : 0 }); // what is due goes, every two seconds
      mailSync = startMailSync(db, keyStore, { dataDir, env: googleEnv, fetcher: googleFetch, every: mailSyncEvery }); // Live with Gmail, for accounts switched to it
      googleCalendar = startGoogleCalendarRead(db, keyStore, { env: googleEnv, fetcher: googleFetch, every: googleCalendarEvery }); // each account with “Read your calendar” on, every minute
      googleCalendarSend = startGoogleCalendarSend(db, keyStore, { env: googleEnv, fetcher: googleFetch, every: googleCalendarSendEvery }); // what waits goes, with its etag
      backups = startBackups(db, dataDir, { every: backupEvery }); // a whole copy of the database each day (backup.js)
      reader.catchUp(); // what waits and was never read (the assistant was away, or the app stopped)
      titler.catchUp();
      // Your other calendars are read now and every ten minutes, while the app runs.
      const reading = readCalendarsEvery ? setInterval(() => readAllCalendars(db).catch(() => {}), readCalendarsEvery) : null;
      if (readCalendarsEvery) readAllCalendars(db).catch(() => {});
      const close = async () => {
        clearInterval(reading);
        mailSync?.stop();
        googleCalendar?.stop();
        googleCalendarSend?.stop();
        mailSender?.stop();
        backups?.stop();
        reader.stop();
        titler.stop();
        await stopAll();
        await new Promise((done) => { server.close(() => { db.close(); done(); }); server.closeAllConnections(); }); // a kept-open connection must not hold the app up
      };
      resolve({ url, close });
    });
  });
}

// Reads a JSON request. It must say it is JSON: a browser can't send that from another
// website without asking first, and this server never says yes.
function readJson(req) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return Promise.reject(fail(415, 'Send JSON (Content-Type: application/json).'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(fail(413, 'That is too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(fail(400, 'That is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

// data/hosts.txt: the private Tailscale name(s) the owner's phone opens the app by (INSTALL.md, "Use it on your phone").
// Kept in the data folder, so an update never removes it. Lines starting with # are notes.
export function hostsFile(dataDir) {
  try {
    return fs.readFileSync(path.join(dataDir, 'hosts.txt'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  } catch { return []; }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// Started with `node server.js` (not imported by a test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ownPort = Number(process.env.PORT ?? 3300);
  // Started by a restart: the one that was running is on its way out; wait until its address is free.
  if (process.env.RESTART_WAIT) {
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${ownPort}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const { url, close } = await startServer({
    port: Number(process.env.PORT ?? 3300), // 3300: never the same address as APP Daniel (3000) on one Mac
    dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : undefined,
    // HOSTS, and the names in data/hosts.txt (one a line), which also reach the Mac icon and the Windows shortcut.
    hosts: [...(process.env.HOSTS ?? '').split(','), ...hostsFile(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'))]
      .map((host) => host.trim()).filter(Boolean),
    // The command the assistant runs (tests give a stand-in): a JSON list, or the default claude.
    // Tests never go out to the web: a stand-in gives every page the title "A page on <its host>".
    ...(process.env.FAKE_LINK_TITLES ? { linkFetcher: async (url) => `A page on ${new URL(url).hostname}` } : {}),
    ...(process.env.ASSISTANT_COMMAND ? { assistantCommand: JSON.parse(process.env.ASSISTANT_COMMAND) } : {}),
    ...(process.env.CODEX_COMMAND ? { codexCommand: JSON.parse(process.env.CODEX_COMMAND) } : {}),
    // READ_CALENDARS=off: keep other calendars as they were last read (the demo copy).
    ...(process.env.READ_CALENDARS === 'off' ? { readCalendarsEvery: 0 } : {}),
    onQuit: () => process.kill(process.pid, 'SIGTERM'), // npm run stop (scripts/stop.js)
    // Settings > Restart: the same command again (same folder, same settings), on its own, then this one stops.
    onRestart: () => {
      spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: { ...process.env, PORT: new URL(url).port, RESTART_WAIT: '1' }, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      process.kill(process.pid, 'SIGTERM');
    },
  });
  console.log(`Listening on ${url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      setTimeout(() => process.exit(0), 5000).unref(); // never hang on the way out: what is saved is saved
      await close();
      process.exit(0);
    });
  }
}
