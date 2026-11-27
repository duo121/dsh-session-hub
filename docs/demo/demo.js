import { createReleaseState, releaseCommands, releaseNotes } from './scenarios.js';

const lead = { id: 'lead', name: '项目负责人' };
const engineers = [
  {
    id: 'frontend', name: '前端工程师', duration: 4900,
    request: '请检查新版发布页的加载、空数据和失败提示，完成后告诉我结果。',
    progress: '我先检查了慢速网络下的加载提示和空数据占位，再模拟接口失败和重试。',
    result: '加载、空数据和失败重试均已验证，移动端布局正常。',
  },
  {
    id: 'backend', name: '后端工程师', duration: 6900,
    request: '请核对发布状态接口的响应和错误码，完成后告诉我联调结果。',
    progress: '我分别核对了已发布版本、找不到版本和服务暂时不可用三种响应。',
    result: '发布状态接口已联调，成功响应以及 404、503 错误码均符合约定。',
  },
];
const people = [lead, ...engineers];
const byId = Object.fromEntries(people.map((person) => [person.id, person]));
const ui = Object.fromEntries([
  'workspace', 'sessions', 'conversation-title', 'collaboration', 'experts', 'expert-panel',
  'transcript', 'composer', 'reset', 'announcement', 'demo-guide',
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
    chapter: 'collaboration', release: createReleaseState(), command: null,
  };
  render();
}

function navigate(id) {
  if (id === 'frontend' && state.release.archived) return;
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
  if (id === 'frontend' && state.release.archived) return `<span class="mention">${icon.chat}前端工程师 · 已归档</span>`;
  return `<button class="reference" type="button" data-session="${id}" data-focus="${focus}">${icon.chat}${byId[id].name}</button>`;
}

function isCollaborator(id) {
  return id === 'lead' || engineers.some((person) => person.id === id);
}

function renderExperts() {
  const { active, events, tasks, expertsOpen } = state;
  const peers = new Map();
  for (const event of [...events].reverse()) {
    if (event.type === 'command' || (active !== 'lead' && active !== event.id)) continue;
    if (state.release.archived && event.id === 'frontend') continue;
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

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function toolTrace(args, result, { expanded = false, target = '' } = {}) {
  return `<details class="tool-row" ${expanded ? 'open' : ''}>
    <summary><span aria-hidden="true">☷</span> 工具调用 <span class="muted">·</span> <code>session · ${args.action}</code>${target ? `<span class="tool-target">${target}</span>` : ''}</summary>
    <div class="tool-body"><pre aria-label="请求参数">${escapeText(JSON.stringify(args, null, 2))}</pre></div>
  </details><p class="tool-output">${escapeText(result)}</p>`;
}

function sendTrace(person, expanded) {
  return toolTrace({ action: 'send', session_id: `session-${person.id}`, content: person.request, receipt: true },
    `已投递到会话「${person.name}」。`, { expanded, target: person.name });
}

function commandTurn({ prompt, args, result }) {
  return `<article class="transcript-item">
    <div class="message"><div class="bubble">${escapeText(prompt)}</div></div>
    ${args.action ? toolTrace(args, result) : `<div class="reply release-summary">${escapeText(result)}</div>`}
  </article>`;
}

function renderTranscript() {
  const { active, view, events, tasks } = state;
  const person = byId[active];
  let markup;
  if (view === 'trace') {
    const shown = active === 'lead' ? events : events.filter((event) => event.id === active);
    markup = shown.map(({ type, id, command }) => {
      if (type === 'command') return command.args.action ? toolTrace(command.args, command.result, { expanded: true }) : '';
      if (type === 'receipt') return `<p class="trace-event">↩ ${byId[id].name} · 自动回执</p>`;
      if (active !== 'lead') return '<p class="trace-event">收到来自项目负责人的消息</p>';
      return sendTrace(byId[id], true);
    }).join('') || '<p class="empty">发送任务后，投递与回执会显示在这里。</p>';
  } else if (active === 'lead') {
    markup = '<p class="empty"><strong>V1.8 发布</strong><br>检查发布页和接口，汇总结果并整理工作区。</p>';
    if (events.length) markup = events.map(({ type, id, command }) => {
      if (type === 'command') return commandTurn(command);
      const engineer = byId[id];
      if (type === 'receipt') return `<article class="message transcript-item receipt">
        <div class="bubble"><div class="source">↩ 自动回执 · ${reference(id, `receipt-${id}`)}</div><p>${engineer.result}</p></div>
      </article>`;
      return `<article class="transcript-item">
        <div class="message"><div class="bubble">${reference(id, `out-${id}`)} ${engineer.request}</div></div>
        ${sendTrace(engineer, false)}
      </article>`;
    }).join('');
  } else if (active === 'record') {
    markup = '<p class="empty">发布记录会话已创建。</p>';
  } else if (active === 'regression') {
    markup = state.release.test === 'running'
      ? `<p class="working">${spinner(true)} 正在运行 V1.8 回归测试</p>`
      : '<p class="empty">测试已中断，本轮无自动回执。</p>';
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
  const { active, chapter, draft, tasks, unread, pickerOpen } = state;
  if (active === 'lead' && chapter !== 'collaboration') {
    return !pickerOpen && selectedCommand() ? { action: 'send', label: '发送指令' } : {};
  }
  if (!isCollaborator(active)) return {};
  if (active !== 'lead') {
    const status = tasks[active];
    if (status === 'done') return { session: 'lead', label: '查看回执' };
    if (status === 'ready') return { session: 'lead', label: '去派发任务' };
    return {};
  }

  const [pendingVisit] = unread;
  if (pendingVisit) return { session: pendingVisit, label: '查看任务' };
  if (draft && !pickerOpen) return { action: 'send', label: `发送给${byId[draft].name}` };
  if (engineers.every(({ id }) => tasks[id] === 'done' || (id === 'frontend' && state.release.archived))) return { action: 'replay', label: '再演示一次' };
  return {};
}

let guideTarget;

function positionGuide() {
  const guide = ui['demo-guide'];
  if (!guideTarget?.isConnected) {
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

function chapterCommands() {
  return releaseCommands(state.chapter, state.release, engineers, state.tasks, hasDispatches());
}

function readyEngineers() {
  return engineers.filter(({ id }) => state.tasks[id] === 'ready' && !(id === 'frontend' && state.release.archived));
}

function hasDispatches() {
  return state.events.some(({ type }) => type === 'send');
}

function selectedCommand(commands = chapterCommands()) {
  if (state.chapter === 'summarize' && state.release.reported && !state.command) return undefined;
  return commands.find(({ id }) => id === state.command) ?? commands[0];
}

function renderComposer(step) {
  const { active, chapter, draft, pickerOpen } = state;
  const commands = active === 'lead' ? chapterCommands() : [];
  const command = selectedCommand(commands);
  const person = active === 'lead' && chapter === 'collaboration' && draft ? byId[draft] : null;
  let picker = '';
  if (pickerOpen && person) {
    picker = `<div class="picker" id="picker"><p>对话</p>${readyEngineers().map(({ id, name }) => `
      <button class="picker-row${draft === id ? ' selected' : ''}" type="button" data-draft="${id}" data-focus="pick-${id}">${icon.chat}${name}<span>刚刚</span></button>`).join('')}</div>`;
  } else if (pickerOpen && commands.length) {
    picker = `<div class="picker" id="picker"><p>预设指令</p>${commands.map(({ id, label }) => `
      <button class="picker-row${command?.id === id ? ' selected' : ''}" type="button" data-command="${id}" data-focus="pick-${id}">${escapeText(label)}</button>`).join('')}</div>`;
  }
  const input = person ? `<p class="draft"><span class="mention">${icon.chat}${person.name}</span> ${person.request}</p>`
    : command ? `<p class="draft">${escapeText(command.prompt)}</p>`
    : `<p class="placeholder">${active === 'lead' ? (chapter === 'collaboration' ? '协作任务已发送' : '可以切换发布阶段，继续演示。') : '发消息或创建任务'}</p>`;
  const replay = step.action === 'replay';
  const action = replay ? 'replay' : 'send';
  const actionName = replay ? step.label : '发送';
  const toolName = commands.length ? '选择预设指令' : '@ 引用会话';
  const toolIcon = commands.length ? '/' : '@';
  ui.composer.innerHTML = `${picker}<div class="composer">${input}<div class="composer-bar">
    <div class="composer-tools"><button type="button" class="at-button" data-at data-focus="at" aria-label="${toolName}" title="${toolName}" aria-expanded="${pickerOpen}" ${person || commands.length > 1 ? '' : 'disabled'}>${toolIcon}</button><span>演示模式</span></div>
    <button class="send-button" type="button" data-${action} data-focus="${action}" aria-label="${actionName}" title="${actionName}" ${person || command || replay ? '' : 'disabled'}>
      <span class="send-icon">${replay ? '<span aria-hidden="true">↺</span>' : icon.send}</span>
    </button>
  </div></div>`;
}

function setChapter(id) {
  state.chapter = id;
  state.active = 'lead';
  state.view = 'chat';
  state.pickerOpen = false;
  state.expertsOpen = false;
  state.command = null;
  if (id === 'close' && !state.release.record) {
    state.release.record = releaseNotes.title;
    state.release.pinned = true;
  }
  render({ bottom: true });
}

function sendCommand() {
  const command = selectedCommand();
  if (!command) return;
  command.apply();
  if (state.release.archived) state.unread.delete('frontend');
  if (!readyEngineers().some(({ id }) => id === state.draft)) state.draft = readyEngineers()[0]?.id ?? null;
  state.events.push({ type: 'command', command });
  state.command = null;
  state.pickerOpen = false;
  state.view = 'chat';
  render({ bottom: true });
  ui.announcement.textContent = command.result;
  if (document.activeElement === document.body) ui.transcript.focus({ preventScroll: true });
}

function render({ bottom = false } = {}) {
  const focus = document.activeElement?.dataset.focus;
  const step = nextStep();
  const { active, chapter, release } = state;
  const visiblePeople = people.filter(({ id }) => id !== 'frontend' || !release.archived);
  if (release.record) {
    const record = { id: 'record', name: release.record };
    if (release.pinned) visiblePeople.unshift(record);
    else visiblePeople.push(record);
  }
  if (release.test !== 'ready') visiblePeople.push({ id: 'regression', name: 'V1.8 回归测试' });
  ui.sessions.innerHTML = visiblePeople.map(({ id, name }) => {
    const running = state.tasks[id] === 'running' || (id === 'regression' && release.test === 'running');
    return `<button type="button" class="session" data-session="${id}" data-focus="session-${id}" ${state.active === id ? 'aria-current="true"' : ''}>
      <span>${release.pinned && id === 'record' ? '<span class="pin-mark" aria-label="已置顶">◆</span> ' : ''}${escapeText(name)}</span>${running ? `<span class="session-status">${spinner(true)}<span class="sr-only">运行中</span></span>` : ''}
    </button>`;
  }).join('');
  ui['conversation-title'].textContent = active === 'record' ? release.record : active === 'regression' ? 'V1.8 回归测试' : byId[active].name;
  for (const button of ui.workspace.querySelectorAll('.chapters [data-chapter]')) {
    if (button.dataset.chapter === chapter) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  for (const button of ui.workspace.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  ui.reset.disabled = chapter === 'collaboration' && state.events.length === 0 && state.active === 'lead' && !state.pickerOpen && state.draft === 'frontend';
  renderExperts();
  renderTranscript();
  renderComposer(step);
  renderGuide(step);
  if (focus) ui.workspace.querySelector(`[data-focus="${focus}"]:not(:disabled)`)?.focus({ preventScroll: true });
  if (bottom) ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function send(fromKeyboard) {
  const id = state.draft;
  if (state.active !== 'lead' || !readyEngineers().some((person) => person.id === id)) return;
  const person = byId[id];
  state.tasks[id] = 'running';
  state.events.push({ type: 'send', id });
  state.unread.add(id);
  state.draft = readyEngineers()[0]?.id ?? null;
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
    setChapter(button.dataset.chapter);
    ui.transcript.focus({ preventScroll: true });
    return;
  }
  if (button.dataset.session) navigate(button.dataset.session);
  if (button.dataset.view) {
    state.view = button.dataset.view;
    render({ bottom: true });
  }
  if ('at' in button.dataset) {
    state.pickerOpen = !state.pickerOpen;
    render();
    if (state.pickerOpen) {
      const option = ui.composer.querySelector('.picker-row.selected') ?? ui.composer.querySelector('.picker-row');
      option?.focus({ preventScroll: true });
    }
  }
  if (button.dataset.draft) {
    state.draft = button.dataset.draft;
    state.pickerOpen = false;
    render();
    ui.composer.querySelector('[data-send]').focus({ preventScroll: true });
  }
  if (button.dataset.command) {
    state.command = button.dataset.command;
    state.pickerOpen = false;
    render();
    ui.composer.querySelector('[data-send]').focus({ preventScroll: true });
  }
  if ('send' in button.dataset) {
    if (state.chapter === 'collaboration') send(event.detail === 0);
    else if (state.active === 'lead') sendCommand();
  }
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
