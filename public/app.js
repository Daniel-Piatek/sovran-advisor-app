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
//   /assistant          a chat with Sovran Advisor; /assistant/:id one conversation  (public/assistant.js)
//   /settings           what Sovran Advisor may do alone, and its activity  (public/settings.js)
//   /tags, /tags/:id    the Tags tab of Notes: every tag, or one tag's page  (public/tags-screen.js, module tags)
//   /boards             the Boards tab of Notes: boards of their own  (public/boards-list.js; module boards, off until switched on)
//   /boards/:id         a board opened large  (public/board-screen.js)
//   /mail               your mail: one list, six splits, a reader  (public/mail-app.js)
//   /mail/import        import a Takeout .mbox, fill from Gmail, Live with Gmail  (public/mail.js)
//   /welcome            the first screen of a new install  (public/welcome.js)
//   /reports, /reports/:report   your own Sovran reports, every one or one to read  (public/reports.js, module reports)
//   /group, /group/announcements, /group/circle   Group Circle: your Quest group's space  (public/group.js, module group)
//   /help, /help/:id    Help: Tell Daniel and his replies, then the help pages (modules tell, help), or one page  (public/help.js)
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
import { showBoards } from './boards-list.js';
import { showTags } from './tags-screen.js';
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
import { showTour } from './tour.js';
import { showReports } from './reports.js';
import { showGroup } from './group.js';
import { showQuest } from './quest.js';
import { showToldDaniel } from './told-daniel.js'; // the first address of What you told Daniel, now on Help (2026-11-24)
import { showHelp } from './help.js'; // the "?" after every title, while Help pages is on
import './page-video.js'; // "How <the page> works" at the right of a page's top bar: its film in the Tour
import './quick-add.js'; // q adds a task from anywhere
import './reminders.js'; // a reminder's notice, when its time comes
import './alerts.js'; // a Mac or Windows alert when something new happens in Group Circle (Settings › Alerts)
import './update-nudge.js'; // "Update" beside Settings, and a notice once, when a new version is ready

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
  { path: /^\/boards$/, show: showBoards },
  { path: /^\/tags(?:\/([0-9a-f-]{36}))?$/, show: showTags },
  { path: /^\/boards\/([0-9a-f-]{36})$/, show: showBoard },
  { path: /^\/settings$/, show: showSettings },
  { path: /^\/library$/, show: showLibrary },
  { path: /^\/tour$/, show: showTour },
  { path: /^\/reports(?:\/([a-z0-9-]+))?$/, show: showReports },
  { path: /^\/group(?:\/(announcements|circle|flags|people))?$/, show: showGroup }, // flags, people: the guide's (APP Daniel)
  { path: /^\/quest(?:\/(week-\d+(?:\/transcript)?))?$/, show: showQuest },
  { path: /^\/told-daniel$/, show: showToldDaniel },
  { path: /^\/help(?:\/([a-z0-9-]+))?$/, show: showHelp },
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
