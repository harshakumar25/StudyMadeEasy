# LMS Question Intelligence

A local study dashboard and early Manifest V3 extension for the Vedam student LMS. It stores question content from pages you choose to sync, keeps source content separate from study metadata, and lets you plan what to solve or cover during the week.

**Status:** This is a testable prototype, loaded as an unpacked extension in Brave. One authenticated Vedam course, session, and question were synced successfully; the saved question appeared in the dashboard and remained after restarting Brave. Its captured Description was compared visually, but full character-level and rich-content fidelity across question types is not yet verified. Saved questions remain `REVIEW_REQUIRED`. See [LMS discovery](docs/lms-discovery.md).

## Load in Brave

1. Open `brave://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this repository directory, the folder containing `manifest.json`.
3. Sign in to `https://student.vedam.org/` using your normal account, then reload the LMS tab so the content script is present.
4. Open the extension popup. It should report whether this tab is a supported LMS page and show counts from the local database.
5. Open a course, a session, and then an individual question. Use the popup's context-specific **Sync** button on each page you want to save. It reads only the **current page**; it does not crawl a whole course or assignment. A question must be open on its **Description** tab for question content to be captured.
6. After syncing a question, compare the on-page review copy and the dashboard's saved text with the LMS Description. Check wording, punctuation, line breaks, code, examples, constraints, images, and tables. The record remains **REVIEW_REQUIRED**; the extension does not automatically certify it as exact.
7. Select **Open Question Bank** or **My planner** from the popup to open the dashboard.

There is no build step. For local code checks, run `npm ci` and then `npm run check` with Node.js/npm installed. These checks cover syntax and database behavior; they do not establish compatibility across other LMS question types or browser notification behavior.

## Study dashboard

- **Overview:** actual saved-question and task counts, today's and overdue tasks, subject cards, and a short “What should I do?” list based on due tasks and saved questions.
- **Question bank:** select a subject; combine text search with week, session type, session, topic, subtopic, difficulty, question type, assignment, extraction status, and classification-source filters. Browse the Subject → Week → Topic groups and sort the visible results. Open a saved question to see its exact captured text, a safe rendering of captured content blocks, a non-executed HTML snapshot as text if available, metadata, and its LMS source link. Use **Edit metadata** to correct week, topic, subtopic, difficulty, or question type; edits are marked `USER`, update filters, and do not change captured source content. Clearing a field marks it `UNKNOWN`.
- **My planner:** navigate weeks or switch to Today, then add a task to solve a saved question, cover a topic, or complete a personal study item. Set a due date and optional earlier reminder, and edit, complete, reopen, or delete tasks. Subject selection scopes the dashboard and planner.

An optional reminder time creates a browser alarm for an open task. If it fires while the extension and Brave can run, a Brave notification is requested; clicking it opens the planner. Alarms are refreshed after plan changes and on extension installation/startup. Browser and operating-system notification settings can prevent display, and missed reminders are not replayed after their time passes. The dashboard also shows open tasks whose reminder time has passed.

## How data moves

`src/content.js` runs only on `student.vedam.org`. On a manual sync, it uses the current URL to identify course, session, assignment, and question IDs. On a question page it looks for the visible **Description** tab and its associated panel, then collects its rendered text, an HTML snapshot, and content blocks. This lookup worked for the observed coding question; other layouts are untested. It refuses to save a question if it cannot find usable description text.

`src/background.js` receives the extraction and writes it through `src/db.js` to IndexedDB owned by the extension. Stores are `courses`, `sessions`, `assignments`, `questions`, `contentVersions`, `plans`, `syncRuns`, and `settings`. The source question has a SHA-256 hash of its text, HTML snapshot, and semantic content blocks. Repeated sync of the same source ID and content leaves its original intact; changed content archives the prior version and flags the new one for review. Study plans live separately from question source content. `dashboard/dashboard.js` reads those stores locally and calculates its counts, filters, suggestions, and week view.

The captured `original.text`, `original.htmlSnapshot`, and `original.contentBlocks` are source representations. `metadata` holds subject, week, topic, difficulty, question type, and provenance separately. Missing fields stay unknown; no model is used to fill them. The dashboard renders LMS HTML snapshots as **text**, without executing them. A source link opens the LMS page for comparison.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `https://student.vedam.org/*` host access | Run the content script on the supported LMS origin. |
| `alarms` | Schedule optional plan reminders. |
| `notifications` | Display due study-task reminders. |

The question bank and plans are stored in the browser extension's local IndexedDB. The code does not send question content to an AI service or a project server, and does not read or save passwords, cookies, or authentication tokens. It accesses content visible in the authenticated tab when you request a sync. Anyone with access to this browser profile may be able to access local extension data. The dashboard can export a JSON backup of the saved records. There is currently no import, cloud sync, or encryption feature.

## Manual verification checklist

1. With the extension loaded, open `https://student.vedam.org/home`. Confirm the popup detects the LMS but does not report a successful extraction merely from detection.
2. Open a class and sync its course page. Open one session and sync it. Confirm the popup's stored-session count changes only after a successful save.
3. Open one question's Description tab and sync that page. Inspect the side-by-side review copy, then open the dashboard and compare the full saved text and HTML snapshot with the original LMS page. Record any missing image, formula, table, or code formatting; do not mark it verified on the basis of a nonempty text field.
4. Sync the same question again. Confirm it remains one question in the dashboard. Close and reopen Brave, then confirm that the question and planner tasks persist.
5. Try combined filters and a subject with no matching questions. The result count should reflect only actual saved records.
6. Add topic, personal, and saved-question tasks for the current week. Set a reminder a few minutes ahead, keep Brave running with notifications allowed, and check that the notification opens the planner. Complete or edit a task and confirm its reminder is cancelled or rescheduled.

## Current limits and next work

Live Brave validation covered one coding question and showed persistence across a browser restart. Repeat sync, notifications, additional question layouts, and exact rich-content fidelity still need browser checks. Syncing is manual and page by page; lecture/lab cards and assignment rows are not traversed automatically. Session title and date hints depend on normal navigation and may be absent. Images and embedded content may not be faithfully replayable from saved text/HTML; all captured questions remain `REVIEW_REQUIRED`. Difficulty, week, topic, and subtopic classification are not yet populated by an inference pipeline. There is no AI integration, question-set selector, JSON restore, or verified full-fidelity rendering.

The next step is to repeat the live question sync and test a reminder notification, then inspect additional question types and compare each saved representation against the LMS before adding bulk collection or AI classification.
