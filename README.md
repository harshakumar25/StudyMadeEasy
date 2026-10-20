```text
   _____ _             _       __  __           _       ______                 
  / ____| |           | |     |  \/  |         | |     |  ____|                
 | (___ | |_ _   _  __| |_   _| \  / | __ _  __| | ___ | |__   __ _ ___ _   _ 
  \___ \| __| | | |/ _` | | | | |\/| |/ _` |/ _` |/ _ \|  __| / _` / __| | | |
  ____) | |_| |_| | (_| | |_| | |  | | (_| | (_| |  __/| |___| (_| \__ \ |_| |
 |_____/ \__|\__,_|\__,_|\__, |_|  |_|\__,_|\__,_|\___||______\__,_|___/\__, |
                          __/ |                                           __/ |
                         |___/                                           |___/ 
```

> **StudyMadeEasy** is a local-first browser extension for the Vedam student LMS. It preserves questions exactly as presented, organizes them by subject and week, and provides a study dashboard with task scheduling and reminders.

---

## ✨ Features

- **Local-First Question Bank**: Captures full question descriptions, examples, code blocks, constraints, and HTML snapshots directly in your browser's local IndexedDB.
- **Direct LMS Redirect**: Jump straight to any question on the Vedam LMS with a single click via **Open in LMS ↗**.
- **Study Planner & Reminders**: Schedule tasks to practice questions or review topics, with native browser notifications when tasks are due.
- **Offline Backup & Restore**: One-click **Export JSON** and **Import JSON** to back up and restore your entire question repository anytime.

---

## 🚀 Quick Setup (Load Unpacked)

1. **Clone or download the repository:**
   ```bash
   git clone https://github.com/harshakumar25/StudyMadeEasy.git
   cd StudyMadeEasy
   ```

2. **Open Extensions in your browser:**
   - Chrome: Navigate to `chrome://extensions`
   - Brave: Navigate to `brave://extensions`
   - Edge: Navigate to `edge://extensions`

3. **Enable Developer Mode:**
   - Turn on the **Developer mode** toggle in the top-right corner.

4. **Load the Extension:**
   - Click **Load unpacked** (top-left).
   - Select the cloned `StudyMadeEasy` folder (the directory containing `manifest.json`).

5. **Pin to Toolbar:**
   - Click the puzzle icon (Extensions) in your browser toolbar and pin **LMS Question Intelligence** for quick access.

---

## 📖 How to Use

1. Log into your LMS at **`https://student.vedam.org/`**.
2. Open any course, session, or individual question (ensure the *Description* tab is open).
3. Click the extension popup in your browser toolbar and click **Sync This Question** (or course/session).
4. Click **Open Question Bank** or **My planner** to launch your dashboard.
5. Click **Open in LMS ↗** on any question card or detail view to jump directly to that problem on Vedam.

---

## 🔒 Privacy & Storage

All data is stored 100% locally on your machine in the browser's IndexedDB. No question content, credentials, or personal information is ever transmitted to external servers or cloud services.
