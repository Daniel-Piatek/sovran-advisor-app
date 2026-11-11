// The page: works out which screen to show from the address, and draws it.
//   /                   the notes list          (public/notes-screens.js)
//   /notes/:id          one note
//   /deleted            Recently deleted
//   /journal            today's journal page   (public/journal.js)
//   /journal/YYYY-MM-DD any day's page
//   /journal/entries/:id one entry
//   /journal/new        a new entry (made once you write in it)
//   /inbox              the Inbox: sort what was captured   (public/inbox.js)
//   /tasks              every open task, from every page     (public/tasks.js)
//   /calendar, /calendar/YYYY-MM-DD   your events, a week or a day  (public/calendar.js)
//   /planner, /planner/YYYY-MM-DD     a day: its events and the tasks you plan  (public/planner.js)
//   /people, /companies the address book; /people/:id, /companies/:id  (public/people.js)
//   /life               My Life: Key Elements, Goals, Projects, Topics; /life/:id one item  (public/life.js)
//   /assistant          a chat with your assistant; /assistant/:id one conversation  (public/assistant.js)
//   /settings           what your assistant may do alone, and its activity  (public/settings.js)
//   /boards/:id         a board opened large  (public/board-screen.js)
//   /mail               your mail: one list, six splits, a reader  (public/mail-app.js)
//   /mail/import        import a Takeout .mbox, fill from Gmail, Live with Gmail  (public/mail.js)
//   /welcome            the first screen of a new install  (public/welcome.js)
//   /library            the design library: every token and piece, with its live value  (public/library.js)
// The frame around every screen (sidebar, bottom bar, moving between screens) is in
// public/shell.js; small shared pieces are in public/ui.js.

import { startRouter, loadCourse } from './shell.js';
import { showList, showNote, showDeleted } from './notes-screens.js';
import { showJournalDay, showEntry, showNewEntry } from './journal.js';
import { showInbox } from './inbox.js';
import { showAssistant } from './assistant.js';
import { showSettings } from './settings.js';
import { showLibrary } from './library.js';
import { showBoard } from './board-screen.js';
import { showPeople, showContact } from './people.js';
import { showLife } from './life.js';
import { showTasks } from './tasks.js';
import { showCalendar, showCalendarEvent } from './calendar.js';
import { showPlanner } from './planner.js';
import { showTimeline } from './timeline.js';
import { loadModules } from './modules.js';
import { showWelcome, welcomeState } from './welcome.js';
import { showMailImport } from './mail.js';
import { showMailApp } from './mail-app.js';
import './quick-add.js'; // q adds a task from anywhere
import './reminders.js'; // a reminder's notice, when its time comes

await loadModules(); // which optional parts are on, before any screen is drawn
loadCourse(); // the Course link's address, when it comes
// A new install opens on the welcome, until it has been seen once.
if (location.pathname === '/' && !(await welcomeState().catch(() => ({ seen: true }))).seen) history.replaceState({}, '', '/welcome');

startRouter([
  { path: /^\/notes\/([0-9a-f-]{36})$/, show: showNote },
  { path: /^\/journal\/entries\/([0-9a-f-]{36})$/, show: showEntry },
  { path: /^\/journal\/new$/, show: showNewEntry },
  { path: /^\/journal(?:\/(\d{4}-\d{2}-\d{2}))?$/, show: showJournalDay },
  { path: /^\/deleted$/, show: showDeleted },
  { path: /^\/inbox$/, show: showInbox },
  { path: /^\/boards\/([0-9a-f-]{36})$/, show: showBoard },
  { path: /^\/settings$/, show: showSettings },
  { path: /^\/library$/, show: showLibrary },
  { path: /^\/welcome$/, show: showWelcome },
  { path: /^\/mail\/import$/, show: showMailImport },
  { path: /^\/mail$/, show: showMailApp },
  { path: /^\/assistant(?:\/([0-9a-f-]{36}))?$/, show: showAssistant },
  { path: /^\/tasks$/, show: showTasks },
  { path: /^\/planner(?:\/(\d{4}-\d{2}-\d{2}))?$/, show: showPlanner },
  { path: /^\/calendar\/events\/([0-9a-f-]{36})$/, show: showCalendarEvent },
  { path: /^\/calendar(?:\/(\d{4}-\d{2}-\d{2}))?$/, show: showCalendar },
  { path: /^\/timeline$/, show: showTimeline },
  { path: /^\/people$/, show: () => showPeople('person') },
  { path: /^\/companies$/, show: () => showPeople('company') },
  { path: /^\/people\/([0-9a-f-]{36})$/, show: (id) => showContact('person', id) },
  { path: /^\/companies\/([0-9a-f-]{36})$/, show: (id) => showContact('company', id) },
  { path: /^\/life(?:\/([0-9a-f-]{36}))?$/, show: showLife },
  { path: /^\/$/, show: showList },
  { path: /^/, show: showList },
]);
