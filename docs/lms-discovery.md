# Vedam LMS discovery and extraction note

## Evidence boundary

The following page structure was observed through an authenticated Brave UI session at `https://student.vedam.org/`. The unpacked extension was subsequently exercised on one course → session → question path, as recorded below. This is not a DOM or API audit, character-level proof of full source fidelity, or validation of other question layouts. No original question body is reproduced in this report, so the sample below leaves it null.

## Observed navigation

| Page | Visible structure observed | Relationship |
| --- | --- | --- |
| `/home` | **Your Subjects** cards with **Go to Class** actions. | Opens a course. |
| `/sessions?courseOfferingId=22` | Course **Analysis and Design of Algorithms B1**; dated **LAB** and **LEC** cards with assignment completion counts and a chevron. | Opens a session; this route identifies a course offering. |
| `/sessions/1061?courseOfferingId=22&attendanceStatus=Present` | **LEC 24** with **Session**, **Attendance**, and **Assignment** tabs. The Assignment tab showed two question rows with title, difficulty, and status. | Session 1061 belongs to course offering 22; a row opens a question. |
| `/sessions/1061/4483dfcb-b7fd-4899-b84c-6fbc96298c90?courseOfferingId=22&attendanceStatus=Present&type=dsa&questionId=703` | The first opened question was titled **HashMap_CountSubarraysWithEqualZerosAndOnes**. Its **Description** tab contained a title, problem statement, Example, Input/Output, and Constraints; an editor and test-case area were also present. | The route carries session ID 1061, an assignment-like UUID segment, and question ID 703. The exact meaning of the UUID still needs confirmation. |

This supports a course → session → assignment/question relationship for this observed route. The visual UI did not establish whether other question types use the same layout or whether all assignment rows expose separate `questionId` values.

## Current vertical slice

1. The content script checks the current Vedam URL and classifies `/sessions?courseOfferingId=…` as a course, `/sessions/{sessionId}` as a session, and `/sessions/{sessionId}/{uuid}?…&questionId=…` as a question.
2. A user requests sync from the popup. Course and session pages save the identifiers and any labels available to the script. No background crawling is performed.
3. On a question page, the script seeks a visible **Description** tab and a related panel, reads its rendered text, stores the panel HTML and selected content blocks, and shows the captured text for manual comparison. This worked on the observed question; the underlying selectors were not separately audited, and other layouts remain untested.
4. The extension service worker stores linked records in its own IndexedDB. Its SHA-256 source fingerprint includes captured text, the exact `htmlSnapshot` string, and selected semantic block fields (type, text, source URL, alt text) for repeat sync and source-change detection. `REVIEW_REQUIRED` remains the preservation status; there is currently no action that turns a manual comparison into a verified status.
5. The dashboard reads saved questions and source links without executing LMS HTML. It also has subject filters, a weekly planner with optional reminders, and a JSON download of all current IndexedDB stores. Import/restore is not implemented.

The editor/test-case area was observed alongside the Description. The current extraction targets the Description panel, so it should **not** be assumed to capture editor state, hidden test cases, or content outside that panel.

## Live Brave check: one question path

- The extension loaded unpacked in Brave. After the authenticated LMS tab was reloaded, the popup detected the course, and the course page synced.
- The LMS's single-page navigation to **LEC 24** and then its question worked with the extension. The session count was **1** after the session sync.
- Syncing the opened question saved **1** question and displayed the on-page review overlay.
- The dashboard showed the saved Description text without a generated rewrite, along with the subject, session, LMS source link, and `REVIEW_REQUIRED` status. This confirms display of the captured text, not an exact character-by-character match against the LMS.
- After Brave restarted, the question count remained **1**, confirming persistence for this record.

Repeat sync, reminder notifications, and additional question types were not tested in this check.

## Sample normalized source record

This is a **schema example built from observed URLs and labels**, not the saved question record from the Brave check. It deliberately contains no private problem statement or invented HTML. The UUID is provisionally treated as an assignment source ID by the current code.

```json
{
  "course": {
    "id": "vedam-course:22",
    "sourceCourseId": "22",
    "name": "Analysis and Design of Algorithms B1",
    "sourceUrl": "https://student.vedam.org/sessions?courseOfferingId=22"
  },
  "session": {
    "id": "vedam-session:1061",
    "courseId": "vedam-course:22",
    "sourceSessionId": "1061",
    "title": "LEC 24",
    "type": "LECTURE"
  },
  "assignment": {
    "id": "vedam-assignment:4483dfcb-b7fd-4899-b84c-6fbc96298c90",
    "sessionId": "vedam-session:1061",
    "sourceAssignmentId": "4483dfcb-b7fd-4899-b84c-6fbc96298c90"
  },
  "question": {
    "id": "vedam-question:22:4483dfcb-b7fd-4899-b84c-6fbc96298c90:703",
    "assignmentId": "vedam-assignment:4483dfcb-b7fd-4899-b84c-6fbc96298c90",
    "source": {
      "platform": "Vedam LMS",
      "url": "https://student.vedam.org/sessions/1061/4483dfcb-b7fd-4899-b84c-6fbc96298c90?courseOfferingId=22&attendanceStatus=Present&type=dsa&questionId=703",
      "sourceQuestionId": "703"
    },
    "original": {
      "text": null,
      "htmlSnapshot": null,
      "contentBlocks": [],
      "contentHash": null,
      "preservationStatus": "NOT_CAPTURED"
    },
    "metadata": {
      "subject": { "value": "Analysis and Design of Algorithms B1", "source": "LMS" },
      "week": { "value": null, "source": "UNKNOWN" },
      "topic": { "value": null, "source": "UNKNOWN" },
      "difficulty": { "value": "UNKNOWN", "source": "UNKNOWN" }
    }
  }
}
```

`NOT_CAPTURED` above describes this illustrative record; the running extractor does not persist empty question text. The question saved during the Brave check has `REVIEW_REQUIRED` status and a SHA-256 hash over text, the exact HTML snapshot, and selected semantic block fields. The visible question title is intentionally absent from the sample's `original.text`, because this report does not reproduce the captured Description wording. The Assignment tab had a difficulty column, but its value for this question was not established here.

## Data boundaries and storage

The source layer is the question's URL, IDs, captured rendered text, HTML snapshot, content blocks, hash, capture time, and preservation status. The metadata layer is subject, week, topic, subtopic, difficulty, question type, and each field's source (`LMS`, `USER`, `RULE`, `LOCAL_MODEL`, or `UNKNOWN` where supported). The current extractor does not infer topics or difficulty and never substitutes an AI rewrite for source text.

IndexedDB version 1 has `courses`, `sessions`, `assignments`, `questions`, `contentVersions`, `plans`, `syncRuns`, and `settings` stores. Course/session/assignment IDs connect question records to the observed navigation; `contentVersions` retains the previous original when the same question ID later has changed text. `plans` is independent study data. The service worker handles extraction writes, and the dashboard writes plans; both use the extension's IndexedDB rather than an LMS-origin database.

Manifest V3 declares host access only to `https://student.vedam.org/*`, plus `alarms` for optional study reminders and `notifications` for reminder display. Active-tab messaging and opening the dashboard do not require the broad `tabs` permission. IndexedDB needs no separate manifest storage permission. No password, cookie, token, cloud model endpoint, or cross-site crawler is part of this slice.

## Validation still needed before broader collection

- Compare saved `original.text`, the non-executed HTML snapshot, and content blocks against the full LMS Description character by character. Check punctuation, case, whitespace, code, Example, Input/Output, Constraints, images, tables, math, and links. Record any mismatch and leave the status under review.
- Repeat sync to check stable IDs and deduplication; navigate by a different route to see whether the course/session hints remain correct.
- Try more than one course, lecture, lab, assignment, and question type before considering bulk traversal or a verified preservation claim.
- Test planner alarms and notifications in Brave with browser and operating-system notification settings enabled; unit tests do not cover this UI flow.
- Download a JSON backup and inspect its saved records. No restore path exists yet.

Known risks are other SPA navigation paths, inaccessible or nonstandard Description markup, content outside that panel, lazy-loaded rows, media and formula fidelity, and the unconfirmed interpretation of the UUID route segment. The next milestone is a meticulous comparison of the saved question with its LMS source, followed by repeat-sync and additional-question tests.
