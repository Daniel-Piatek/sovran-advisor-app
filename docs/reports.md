---
title: Reports
module: reports
paths: ^/reports(/|$)
---
Reports is where you read your own Sovran reports: the Sovran Pattern now, later reports as they are made, and your Layered Portrait at the top once it begins.

## How you use it

- Open **Reports** in the sidebar. Each report is a card with its version, the day it was approved, its length and its sections.
- Press a card to read the report. It opens on its own ivory page, in the look of the printed report: the crown, the title and the Live Sovran wordmark at the top, a gold label on each part. **Contents** takes you to any section, and the downloads are at the top.
- **PDF download**, the small link under the title, saves the report as a white PDF, made for printing. Reading here comes first: this is where you highlight and comment.
- **Highlight and comment.** Select some words in a report: a small bar offers **Highlight** or **Comment**. Highlights show in soft gold; your comments sit beside the section (under it on a phone). Press a highlight to change its comment or remove it (with Undo). **Your highlights** at the top lists them all.
- Your highlights and comments stay only in this app. The report in your Sovran Library is never changed, so you always keep a clean copy.
- Ask your assistant about a report ("what does my Pattern say about my gifts?"): it reads your reports too, with your highlights and comments, so you can ask about what struck you.
- Your reports come from your Sovran Library, so the page needs your Library key (Settings › Sovran Library) and the internet.

## How it works

Reports is the module `reports` (Settings › Modules). The reports machine keeps each report in the Sovran Library (schema sovran_machine), locked to your own Library key; only a final report is ever given. `reports.js` asks the library link with your key (its reads list_my_reports, read_my_report and the file address) and passes the answer to the page; the key never reaches the page and nothing is kept on this computer. The addresses are `GET /api/reports`, `/api/reports/:report` and `/api/reports/:report/files/:kind` (pdf or for-your-ai); the page is `public/reports.js`; the assistant's tool is `reports_read`. Without a key, made-up reports in data/reports are read instead (only the tests use that). Highlights and comments are the table `report_marks` (`report-marks.js`, `public/report-marks.js`; `GET`/`POST /api/reports/:report/marks`, `PATCH`/`DELETE /api/report-marks/:id`, `POST /api/report-marks/:id/restore`): each keeps the chosen words with a little text before and after, so it finds its place again in a newer version of the report, and one whose words are gone is listed as no longer found.
