(() => {
  'use strict';

  const HOST = 'student.vedam.org';
  const pendingCourseKey = 'lmsqi-pending-course';
  const pendingSessionKey = 'lmsqi-pending-session';

  function pageContext() {
    const url = new URL(location.href);
    if (url.hostname !== HOST) return { supported: false, pageType: 'OTHER', courseTitle: null };
    const parts = url.pathname.split('/').filter(Boolean);
    const courseSourceId = url.searchParams.get('courseOfferingId');
    const questionSourceId = url.searchParams.get('questionId');
    const isQuestion = parts[0] === 'sessions' && parts.length >= 3 && Boolean(questionSourceId);
    const isSession = parts[0] === 'sessions' && parts.length === 2;
    const isCourse = parts[0] === 'sessions' && parts.length === 1;
    let courseTitle = null;
    if (isCourse) {
      const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .map(el => el.textContent?.trim())
        .filter(Boolean);
      courseTitle = candidates.find(text => /\bClass\s*$/.test(text))?.replace(/\s+Class\s*$/, '') || null;
      if (!courseTitle) {
        const text = document.body.innerText.match(/([^\n]+)\s+Class\s*\n/);
        courseTitle = text?.[1]?.trim() || null;
      }
    } else {
      try {
        const pending = JSON.parse(sessionStorage.getItem(pendingCourseKey) || 'null');
        if (pending?.courseSourceId === courseSourceId) courseTitle = pending.name;
      } catch { /* A malformed transient hint is ignored. */ }
    }
    return {
      supported: true,
      pageType: isQuestion ? 'QUESTION' : isSession ? 'SESSION' : isCourse ? 'COURSE' : parts[0] === 'home' ? 'HOME' : 'OTHER',
      courseTitle,
      courseSourceId,
      sessionSourceId: isSession || isQuestion ? parts[1] : null,
      assignmentSourceId: isQuestion ? parts[2] : null,
      questionSourceId: isQuestion ? questionSourceId : null,
      url: location.href,
    };
  }

  function textFrom(element) {
    return element?.innerText?.trim() || element?.textContent?.trim() || '';
  }

  function visible(element) {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  // The observed Vedam question page has a Description tab before the problem
  // body. Only use its associated panel; refuse a broad whole-page scrape.
  function descriptionPanel() {
    const tab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find(el => visible(el) && textFrom(el) === 'Description');
    if (!tab || tab.getAttribute('aria-selected') === 'false') return null;
    const controlled = tab.getAttribute('aria-controls');
    if (controlled) {
      const panel = document.getElementById(controlled);
      if (panel && visible(panel)) return panel;
    }
    const tabList = tab.closest('[role="tablist"]');
    if (!tabList) return null;
    const candidates = Array.from(document.querySelectorAll('[role="tabpanel"]'))
      .filter(el => visible(el) && (tabList.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    return candidates[0] || null;
  }

  function meaningfulBlocks(root) {
    const tags = 'h1,h2,h3,h4,h5,h6,p,pre,code,li,table,img,math,blockquote';
    return Array.from(root.querySelectorAll(tags)).filter(visible).map((element, order) => {
      const tag = element.tagName.toLowerCase();
      return {
        order,
        type: tag,
        text: tag === 'img' ? null : element.textContent,
        html: element.outerHTML,
        sourceUrl: tag === 'img' ? new URL(element.getAttribute('src') || '', location.href).href : null,
        alt: tag === 'img' ? element.getAttribute('alt') : null,
      };
    });
  }

  function sourceText(panel) {
    // innerText follows the rendered source, retaining visual line breaks. The
    // original panel HTML is stored separately for inspection and comparison.
    return panel.innerText;
  }

  function dateFromPage(context) {
    // A question Description can contain dates in its examples. Only the
    // session detail page is allowed to supply a session date.
    if (context.pageType !== 'SESSION') return { date: null, dateText: null };
    const sessionTab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find(el => visible(el) && textFrom(el) === 'Session' && el.getAttribute('aria-selected') !== 'false');
    const controlled = sessionTab?.getAttribute('aria-controls');
    const panel = controlled ? document.getElementById(controlled) : null;
    const fullDates = (element) => [...new Set((textFrom(element).match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g) || []))];
    const panelDates = panel && visible(panel) ? fullDates(panel) : [];
    const dates = panelDates.length ? panelDates : fullDates(document.querySelector('main') || document.body);
    if (dates.length !== 1) return { date: null, dateText: null };
    const dateText = dates[0];
    const parts = dateText.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!parts) return { date: null, dateText: null };
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const year = Number(parts[4]);
    const month = months.indexOf(parts[2]) + 1;
    const day = Number(parts[3]);
    const parsed = new Date(0);
    parsed.setUTCFullYear(year, month - 1, day);
    parsed.setUTCHours(0, 0, 0, 0);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || parsed.getUTCDay() !== weekdays.indexOf(parts[1])) {
      return { date: null, dateText: null };
    }
    const date = `${parts[4]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { date, dateText };
  }

  function transientSession(context) {
    try {
      const pending = JSON.parse(sessionStorage.getItem(pendingSessionKey) || 'null');
      if (pending?.courseSourceId !== context.courseSourceId) return null;
      if (pending.sourceSessionId && pending.sourceSessionId !== context.sessionSourceId) return null;
      if (!pending.sourceSessionId && Date.now() - pending.capturedAt > 60_000) return null;
      if (!pending.sourceSessionId) {
        pending.sourceSessionId = context.sessionSourceId;
        sessionStorage.setItem(pendingSessionKey, JSON.stringify(pending));
      }
      return pending;
    } catch { /* Ignore stale navigation hints. */ }
    return null;
  }

  function makeBasePayload(context) {
    const courseId = context.courseSourceId ? `vedam-course:${context.courseSourceId}` : null;
    if (!courseId) throw new Error('The LMS page does not expose a course offering ID.');
    const now = new Date().toISOString();
    const course = {
      id: courseId,
      sourceCourseId: context.courseSourceId,
      name: context.courseTitle,
      code: null,
      semester: null,
      sourceUrl: `https://${HOST}/sessions?courseOfferingId=${encodeURIComponent(context.courseSourceId)}`,
      lastSyncedAt: now,
    };
    const payload = { course };
    if (context.sessionSourceId) {
      const hint = transientSession(context);
      const pageDate = dateFromPage(context);
      payload.session = {
        id: `vedam-session:${context.sessionSourceId}`,
        courseId,
        sourceSessionId: context.sessionSourceId,
        title: hint?.title || null,
        type: hint?.type || 'UNKNOWN',
        date: pageDate.date || hint?.date || null,
        dateText: pageDate.dateText || hint?.dateText || null,
        dateSource: pageDate.date || hint?.date ? 'LMS' : null,
        week: null,
        sourceUrl: `https://${HOST}/sessions/${encodeURIComponent(context.sessionSourceId)}?courseOfferingId=${encodeURIComponent(context.courseSourceId)}`,
        assignmentCount: hint?.assignmentCount ?? null,
        lastSyncedAt: now,
      };
    }
    return payload;
  }

  function extractQuestion(context, payload) {
    if (!context.questionSourceId || !context.assignmentSourceId) throw new Error('This question has no source identifier in the URL.');
    const panel = descriptionPanel();
    if (!panel) throw new Error('The question Description panel was not found. Open the Description tab and retry.');
    const originalText = sourceText(panel);
    if (!originalText || originalText.length < 12) throw new Error('The question Description panel is empty or incomplete.');
    const blocks = meaningfulBlocks(panel);
    const issues = [];
    if (blocks.some(block => block.type === 'img')) issues.push('Question contains an image. Compare the stored content with the LMS.');
    if (panel.querySelector('iframe,canvas,svg')) issues.push('Question contains embedded or drawn content that may need manual review.');
    const courseId = payload.course.id;
    const sessionId = payload.session.id;
    const assignmentId = `vedam-assignment:${context.assignmentSourceId}`;
    const now = new Date().toISOString();
    payload.assignment = {
      id: assignmentId,
      courseId,
      sessionId,
      sourceAssignmentId: context.assignmentSourceId,
      title: null,
      sourceUrl: context.url,
      extractionStatus: 'REVIEW_REQUIRED',
    };
    payload.question = {
      id: `vedam-question:${context.courseSourceId}:${context.assignmentSourceId}:${context.questionSourceId}`,
      courseId,
      sessionId,
      assignmentId,
      order: Number(document.body.innerText.match(/\bQuestion\s+(\d+)\b/)?.[1]) || null,
      original: {
        text: originalText,
        htmlSnapshot: panel.outerHTML,
        contentBlocks: blocks,
        contentHash: null,
        contentVersion: 1,
        preservationStatus: 'REVIEW_REQUIRED',
        extractionIssues: issues,
      },
      source: {
        platform: 'Vedam LMS',
        url: context.url,
        sourceQuestionId: context.questionSourceId,
        extractionMethod: 'DOM_DESCRIPTION_PANEL',
        extractedAt: now,
        preservationStatus: 'REVIEW_REQUIRED',
      },
      metadata: {
        subject: { value: context.courseTitle, source: context.courseTitle ? 'LMS' : 'UNKNOWN' },
        week: { value: null, source: 'UNKNOWN' },
        topic: { value: null, source: 'UNKNOWN' },
        subtopic: { value: null, source: 'UNKNOWN' },
        difficulty: { value: 'UNKNOWN', source: 'UNKNOWN' },
        questionType: { value: 'UNKNOWN', source: 'UNKNOWN' },
        classificationSource: 'UNKNOWN',
        tags: [],
      },
      searchText: originalText.toLocaleLowerCase(),
    };
    return payload;
  }

  function showReview(question, result) {
    document.getElementById('lmsqi-review')?.remove();
    const dialog = document.createElement('aside');
    dialog.id = 'lmsqi-review';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Compare extracted LMS question');
    Object.assign(dialog.style, {
      position: 'fixed', zIndex: '2147483647', right: '16px', top: '16px',
      width: 'min(46vw, 640px)', maxHeight: '90vh', overflow: 'auto',
      background: '#fff', color: '#132437', padding: '18px',
      border: '2px solid #7040b7', borderRadius: '12px',
      boxShadow: '0 16px 48px #0004', font: '14px/1.45 system-ui, sans-serif',
    });
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px';
    const title = document.createElement('strong');
    title.textContent = result.questionChange === 'NEW' ? 'Saved question for comparison' : 'Question sync complete';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.remove());
    header.append(title, close);
    const note = document.createElement('p');
    note.textContent = 'Compare this stored copy with the LMS page. It remains marked Needs review until source fidelity is checked.';
    const copy = document.createElement('pre');
    copy.textContent = question.original.text;
    copy.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f2fa;padding:12px;border-radius:8px';
    dialog.append(header, note, copy);
    document.body.append(dialog);
  }

  async function syncCurrentPage() {
    const context = pageContext();
    if (!context.supported || context.pageType === 'OTHER' || context.pageType === 'HOME') {
      throw new Error('Open a Vedam class, session, or question page before syncing.');
    }
    const payload = makeBasePayload(context);
    if (context.pageType === 'QUESTION') extractQuestion(context, payload);
    const response = await chrome.runtime.sendMessage({ type: 'SAVE_EXTRACTION', payload });
    if (!response?.ok) throw new Error(response?.error || 'The extraction could not be saved.');
    if (payload.question) showReview(payload.question, response.summary);
    return { ok: true, summary: response.summary, pageType: context.pageType };
  }

  // Carry source labels across normal navigation; no private auth data is read.
  document.addEventListener('click', event => {
    const context = pageContext();
    if (context.pageType === 'SESSION') {
      const pageDate = dateFromPage(context);
      if (pageDate.date) {
        const previous = transientSession(context) || {};
        sessionStorage.setItem(pendingSessionKey, JSON.stringify({
          ...previous,
          courseSourceId: context.courseSourceId,
          sourceSessionId: context.sessionSourceId,
          date: pageDate.date,
          dateText: pageDate.dateText,
          capturedAt: Date.now(),
        }));
      }
    }
    if (context.pageType === 'HOME') {
      const button = event.target.closest('button');
      if (!button || textFrom(button) !== 'Go to Class') return;
      const card = button.closest('article') || button.parentElement?.parentElement;
      const name = card?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim();
      if (name) sessionStorage.setItem(pendingCourseKey, JSON.stringify({ name, capturedAt: Date.now() }));
    }
    if (context.pageType === 'COURSE') {
      let node = event.target;
      for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
        const text = textFrom(node);
        const match = text.match(/\b(LEC|LAB)\s*(\d+)\b/);
        if (!match || !/Assignments/i.test(text) || text.length > 600) continue;
        const dateText = text.match(/\b\d{1,2},\s*[A-Z][a-z]+\b/)?.[0] || null;
        sessionStorage.setItem(pendingSessionKey, JSON.stringify({
          courseSourceId: context.courseSourceId,
          title: `${match[1]} ${match[2]}`,
          type: match[1] === 'LEC' ? 'LECTURE' : 'LAB',
          dateText,
          assignmentCount: Number(text.match(/Assignments\s+(\d+)\s*\/\s*(\d+)/i)?.[2]) || null,
          capturedAt: Date.now(),
        }));
        break;
      }
      if (context.courseTitle) sessionStorage.setItem(pendingCourseKey, JSON.stringify({
        courseSourceId: context.courseSourceId, name: context.courseTitle, capturedAt: Date.now(),
      }));
    }
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'GET_PAGE_CONTEXT') {
      respond(pageContext());
      return;
    }
    if (message?.type === 'SYNC_CURRENT_PAGE') {
      syncCurrentPage().then(respond).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
  });
})();
