import { mountScenarios } from './scenarios.js';

const lead = { id: 'lead', name: '项目负责人' };
const engineers = [
  {
    id: 'frontend', name: '前端工程师', duration: 4900,
    request: '请检查新版发布页的加载、空数据和失败提示，完成后告诉我结果。',
    result: '加载、空数据和失败重试均已验证，移动端布局正常。',
  },
  {
    id: 'backend', name: '后端工程师', duration: 6900,
    request: '请核对发布状态接口的响应和错误码，完成后告诉我联调结果。',
    result: '发布状态接口已联调，成功响应以及 404、503 错误码均符合约定。',
  },
];
const people = [lead, ...engineers];
const byId = Object.fromEntries(people.map((person) => [person.id, person]));
const ui = Object.fromEntries([
  'workspace', 'sessions', 'conversation-title', 'collaboration', 'experts', 'expert-panel',
  'transcript', 'composer', 'reset', 'announcement', 'demo-guide', 'scenario', 'chapter-sessions',
].map((id) => [id, document.getElementById(id)]));
const timers = new Map();
let state;

const icon = {
  chat: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.8 14.5a6.3 6.3 0 1 1 3 1.6L4 17zM7 9h6m-6 3h4"/></svg>',
  people: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 16v-1.4c0-2 1.7-3.5 3.6-3.5h2c2 0 3.6 1.6 3.6 3.5V16m2.2-4.6a3.1 3.1 0 0 1 3 3.1V16M12.6 4.2a2.5 2.5 0 0 1 0 5"/><circle cx="7.4" cy="6.7" r="2.5"/></svg>',
  send: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-4.5 4.5L10 4l4.5 4.5"/></svg>',
};

function reset() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  state = {
    active: 'lead', draft: 'frontend', pickerOpen: false, expertsOpen: false, view: 'chat', events: [],
    tasks: Object.fromEntries(engineers.map(({ id }) => [id, 'ready'])),
    unread: new Set(),
  };
  render();
}

function navigate(id) {
  state.active = id;
  state.unread.delete(id);
  state.view = 'chat';
  state.expertsOpen = false;
  state.pickerOpen = false;
  render({ bottom: true });
  ui.transcript.focus({ preventScroll: true });
}

function spinner(running) {
  return `<span class="indicator${running ? ' running' : ''}" aria-hidden="true"></span>`;
}

function reference(id, focus) {
  return `<button class="reference" type="button" data-session="${id}" data-focus="${focus}">${icon.chat}${byId[id].name}</button>`;
}

function renderExperts() {
  const { active, events, tasks, expertsOpen } = state;
  const peers = new Map();
  for (const event of [...events].reverse()) {
    if (active !== 'lead' && active !== event.id) continue;
    const id = active === 'lead' ? event.id : lead.id;
    if (peers.has(id)) continue;
    peers.set(id, {
      id, outgoing: active === 'lead' ? event.type === 'send' : event.type === 'receipt',
      running: tasks[id] === 'running',
    });
  }
  const rows = [...peers.values()];
  ui.collaboration.hidden = rows.length === 0;
  ui.experts.innerHTML = `${rows.some(({ running }) => running) ? spinner(true) : icon.people} <span>${rows.length} 个协作专家</span> <span class="chevron" aria-hidden="true"></span>`;
  ui.experts.setAttribute('aria-expanded', String(expertsOpen));
  ui['expert-panel'].hidden = !expertsOpen;
  ui['expert-panel'].innerHTML = rows.map(({ id, outgoing, running }) => `
    <button type="button" class="expert-row" data-session="${id}" data-focus="expert-${id}">
      ${spinner(running)}<span><strong>${outgoing ? '→' : '←'} ${byId[id].name}</strong><small>刚刚 · ${outgoing ? '我发出的' : '我收到的'} · ${running ? '运行中' : '空闲'}</small></span>
    </button>`).join('');
}

function sendTrace(person, expanded) {
  return `<details class="tool-row" ${expanded ? 'open' : ''}>
    <summary><span aria-hidden="true">☷</span> 工具调用 <span class="muted">·</span> <code>session · send</code><span class="tool-target">${person.name}</span></summary>
    <p>已投递到会话「${person.name}」。</p>
  </details>`;
}

function renderTranscript() {
  const { active, view, events, tasks } = state;
  const person = byId[active];
  let markup;
  if (view === 'trace') {
    const shown = active === 'lead' ? events : events.filter((event) => event.id === active);
    markup = shown.map(({ type, id }) => {
      if (type === 'receipt') return `<p class="trace-event">↩ ${byId[id].name} · 自动回执</p>`;
      if (active !== 'lead') return '<p class="trace-event">收到来自项目负责人的消息</p>';
      return sendTrace(byId[id], true);
    }).join('') || '<p class="empty">发送任务后，投递与回执会显示在这里。</p>';
  } else if (active === 'lead') {
    markup = '<p class="empty"><strong>V1.8 发布前检查</strong><br>先确认发布页，再核对接口。选择一个会话发送任务。</p>';
    if (events.length) markup = events.map(({ type, id }) => {
      const engineer = byId[id];
      if (type === 'receipt') return `<article class="message transcript-item receipt">
        <div class="bubble"><div class="source">↩ 自动回执 · ${reference(id, `receipt-${id}`)}</div><p>${engineer.result}</p></div>
      </article>`;
      return `<article class="transcript-item">
        <div class="message"><div class="bubble">${reference(id, `out-${id}`)} ${engineer.request}</div></div>
        ${sendTrace(engineer, tasks[id] === 'running')}
      </article>`;
    }).join('');
  } else if (tasks[active] === 'ready') {
    markup = '<p class="empty">等待项目负责人发送任务。</p>';
  } else {
    markup = `<article class="message transcript-item incoming"><div class="bubble">
      <div class="source">来自 ${reference('lead', 'source')}：</div><p>${person.request}</p>
    </div><p class="reference-note">引用会话 · 项目负责人</p></article>
    <article class="reply transcript-item">${tasks[active] === 'running'
      ? `<p class="working">${spinner(true)} 正在处理发布任务</p>`
      : `<p>${person.result}</p><p class="reference-note">已自动回执给项目负责人</p>`}</article>`;
  }
  ui.transcript.innerHTML = `<div class="thread">${markup}</div>`;
}

function nextStep() {
  const { active, draft, tasks, unread, pickerOpen } = state;
  if (active !== 'lead') {
    const status = tasks[active];
    if (status === 'done') return { session: 'lead', label: '查看回执' };
    if (status === 'ready') return { session: 'lead', label: '去派发任务' };
    return {};
  }

  const [pendingVisit] = unread;
  if (pendingVisit) return { session: pendingVisit, label: '查看任务' };
  if (draft && !pickerOpen) return { action: 'send', label: `发送给${byId[draft].name}` };
  if (engineers.every(({ id }) => tasks[id] === 'done')) return { action: 'replay', label: '再演示一次' };
  return {};
}

let guideTarget;

function positionGuide() {
  const guide = ui['demo-guide'];
  if (!ui.scenario.hidden || !guideTarget?.isConnected) {
    guide.hidden = true;
    return;
  }

  const rect = guideTarget.getBoundingClientRect();
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  const margin = 8;
  const gap = 11;
  guide.hidden = rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width;
  if (guide.hidden) return;

  const w = guide.offsetWidth;
  const h = guide.offsetHeight;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const clampX = (value) => clamp(value, margin, width - w - margin);
  const clampY = (value) => clamp(value, margin, height - h - margin);
  const session = ui.sessions.contains(guideTarget);
  let x;
  let y;
  let side;

  if (session && width > 700 && rect.right + gap + w <= width - margin) {
    x = rect.right + gap;
    y = clampY(centerY - h / 2);
    side = 'left';
  } else if (!session && rect.left - gap - w >= margin) {
    x = rect.left - gap - w;
    y = clampY(centerY - h / 2);
    side = 'right';
  } else {
    x = clampX(centerX - w / 2);
    const below = rect.bottom + gap + h <= height - margin;
    y = clampY(below ? rect.bottom + gap : rect.top - gap - h);
    side = below ? 'top' : 'bottom';
  }

  guide.style.left = `${x}px`;
  guide.style.top = `${y}px`;
  guide.dataset.arrow = side;
  const vertical = side === 'top' || side === 'bottom';
  guide.style.setProperty('--arrow-offset', `${clamp(vertical ? centerX - x : centerY - y, 7, (vertical ? w : h) - 7)}px`);
}

function renderGuide(step) {
  const guide = ui['demo-guide'];
  const previousAnchor = guideTarget?.dataset.focus;
  guideTarget?.removeAttribute('aria-describedby');
  guideTarget = step.session
    ? ui.sessions.querySelector(`[data-session="${step.session}"]`)
    : step.action && ui.composer.querySelector(`[data-${step.action}]`);
  if (guideTarget) {
    guideTarget.setAttribute('aria-describedby', guide.id);
    guide.textContent = step.label;
  }
  positionGuide();
  if (!guide.hidden && guideTarget.dataset.focus !== previousAnchor &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    guide.getAnimations().forEach((animation) => animation.cancel());
    guide.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }
}

function renderComposer(step) {
  const { active, draft, pickerOpen, tasks } = state;
  const person = active === 'lead' && draft ? byId[draft] : null;
  const picker = person && pickerOpen ? `
    <div class="picker" id="picker"><p>对话</p>${engineers.filter(({ id }) => tasks[id] === 'ready').map(({ id, name }) => `
      <button class="picker-row${draft === id ? ' selected' : ''}" type="button" data-draft="${id}" data-focus="pick-${id}">${icon.chat}${name}<span>刚刚</span></button>`).join('')}</div>` : '';
  const input = person
    ? `<p class="draft"><span class="mention">${icon.chat}${person.name}</span> ${person.request}</p>`
    : `<p class="placeholder">${active === 'lead' ? '两个任务均已发送' : '来自项目负责人的任务会显示在上方'}</p>`;
  const replay = step.action === 'replay';
  const action = replay ? 'replay' : 'send';
  const actionName = replay ? step.label : '发送';
  ui.composer.innerHTML = `${picker}<div class="composer">${input}<div class="composer-bar">
    <div class="composer-tools"><button type="button" class="at-button" data-at data-focus="at" aria-label="@ 引用会话" aria-expanded="${pickerOpen}" ${person ? '' : 'disabled'}>@</button><span>演示模式</span></div>
    <button class="send-button" type="button" data-${action} data-focus="${action}" aria-label="${actionName}" title="${actionName}" ${person || replay ? '' : 'disabled'}>
      <span class="send-icon">${replay ? '<span aria-hidden="true">↺</span>' : icon.send}</span>
    </button>
  </div></div>`;
}

let releaseRecord;
let frontendArchived = false;
const conversation = ui.transcript.closest('.conversation');

function renderChapterSessions() {
  const active = !ui.scenario.hidden;
  ui.sessions.querySelector('[data-session="frontend"]')?.toggleAttribute('hidden', active && frontendArchived);
  const list = ui['chapter-sessions'];
  list.hidden = !active || !releaseRecord;
  list.textContent = releaseRecord ? `${releaseRecord.pinned ? '◆  ' : ''}${releaseRecord.title}` : '';
  if (releaseRecord?.pinned) ui.sessions.before(list);
  else ui.sessions.after(list);
}

function setChapter(id) {
  const collaboration = id === 'collaboration';
  ui.scenario.hidden = collaboration;
  conversation.hidden = !collaboration;
  for (const button of ui.workspace.querySelectorAll('.chapters [data-chapter]')) {
    if (button.dataset.chapter === id) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  renderChapterSessions();
  positionGuide();
}

const scenarios = mountScenarios(ui.scenario, {
  onCollaboration() {
    setChapter('collaboration');
    ui.transcript.focus({ preventScroll: true });
  },
  onChapter(id, title) {
    releaseRecord = title ? { title, pinned: true } : null;
    frontendArchived = false;
    setChapter(id);
  },
  onOperation({ action, title, content }) {
    if (action === 'create') releaseRecord = { title, pinned: false };
    if (action === 'rename') releaseRecord.title = content;
    if (action === 'pin' || action === 'unpin') releaseRecord.pinned = action === 'pin';
    if (action === 'archive' || action === 'unarchive') frontendArchived = action === 'archive';
    renderChapterSessions();
  },
});

function render({ bottom = false } = {}) {
  const focus = document.activeElement?.dataset.focus;
  const step = nextStep();
  ui.sessions.innerHTML = people.map(({ id, name }) => {
    const running = state.tasks[id] === 'running';
    return `<button type="button" class="session" data-session="${id}" data-focus="session-${id}" ${state.active === id ? 'aria-current="true"' : ''}>
      <span>${name}</span>${running ? `<span class="session-status">${spinner(true)}<span class="sr-only">运行中</span></span>` : ''}
    </button>`;
  }).join('');
  renderChapterSessions();
  ui['conversation-title'].textContent = byId[state.active].name;
  for (const button of ui.workspace.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  ui.reset.disabled = state.events.length === 0 && state.active === 'lead' && !state.pickerOpen && state.draft === 'frontend';
  renderExperts();
  renderTranscript();
  renderComposer(step);
  renderGuide(step);
  if (focus) ui.workspace.querySelector(`[data-focus="${focus}"]:not(:disabled)`)?.focus({ preventScroll: true });
  if (bottom) ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function send(fromKeyboard) {
  const id = state.draft;
  if (state.active !== 'lead' || state.tasks[id] !== 'ready') return;
  const person = byId[id];
  state.tasks[id] = 'running';
  state.events.push({ type: 'send', id });
  state.unread.add(id);
  state.draft = engineers.find((entry) => state.tasks[entry.id] === 'ready')?.id ?? null;
  state.pickerOpen = false;
  state.expertsOpen = true;
  state.view = 'chat';
  render({ bottom: true });
  const panel = ui['expert-panel'].getBoundingClientRect();
  if (panel.top < 0 || panel.bottom > document.documentElement.clientHeight) {
    ui.workspace.scrollIntoView({ block: 'start' });
  }
  const destination = nextStep().session;
  if (fromKeyboard && destination) ui.sessions.querySelector(`[data-session="${destination}"]`).focus();
  ui.announcement.textContent = `已向${person.name}发送任务。协作专家列表已展开，选择${person.name}查看任务。`;
  const timer = setTimeout(() => {
    timers.delete(id);
    state.tasks[id] = 'done';
    state.events.push({ type: 'receipt', id });
    render({ bottom: state.active === 'lead' || state.active === id });
    ui.announcement.textContent = state.active === 'lead'
      ? `收到${person.name}的自动回执。`
      : `${person.name}已完成任务，回执已发回项目负责人。`;
  }, person.duration);
  timers.set(id, timer);
}

reset();
window.addEventListener('resize', positionGuide);
window.addEventListener('scroll', positionGuide, { passive: true });

// Use the original event path: rendering can replace the clicked button's icon or row.
document.addEventListener('click', (event) => {
  const path = event.composedPath();
  const button = event.target.closest('button');
  if (state.expertsOpen && !path.includes(ui.collaboration)) {
    state.expertsOpen = false;
    renderExperts();
  }
  if (state.pickerOpen && !path.includes(ui.composer)) {
    state.pickerOpen = false;
    const step = nextStep();
    renderComposer(step);
    renderGuide(step);
  }
  if (!button || !path.includes(ui.workspace)) return;
  if (button.dataset.chapter) {
    if (button.dataset.chapter === 'collaboration') {
      setChapter('collaboration');
      ui.transcript.focus({ preventScroll: true });
    } else {
      scenarios.showChapter(button.dataset.chapter);
    }
    return;
  }
  if (button === ui.reset && !ui.scenario.hidden) setChapter('collaboration');
  if (button.dataset.session) {
    setChapter('collaboration');
    navigate(button.dataset.session);
  }
  if (button.dataset.view) {
    state.view = button.dataset.view;
    render({ bottom: true });
  }
  if ('at' in button.dataset) {
    state.pickerOpen = !state.pickerOpen;
    render();
    if (state.pickerOpen) ui.composer.querySelector('.picker-row.selected')?.focus({ preventScroll: true });
  }
  if (button.dataset.draft) {
    state.draft = button.dataset.draft;
    state.pickerOpen = false;
    render();
    ui.composer.querySelector('[data-send]').focus({ preventScroll: true });
  }
  if ('send' in button.dataset) send(event.detail === 0);
  if ('replay' in button.dataset || button === ui.reset) {
    reset();
    ui.announcement.textContent = '演示已重置。发送按钮已准备好。';
    ui.composer.querySelector('[data-send]').focus({ preventScroll: true });
  }
  if (button === ui.experts) {
    state.expertsOpen = !state.expertsOpen;
    renderExperts();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (state.expertsOpen) {
    state.expertsOpen = false;
    renderExperts();
    ui.experts.focus();
  }
  if (state.pickerOpen) {
    state.pickerOpen = false;
    render();
    ui.composer.querySelector('[data-at]').focus();
  }
});
