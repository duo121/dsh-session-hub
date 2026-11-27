import { engineers, releaseSteps } from './scenarios.js';

const ui = Object.fromEntries([
  'workspace', 'sessions', 'new-session', 'conversation-title', 'collaboration', 'experts', 'expert-panel',
  'transcript', 'composer', 'reset', 'announcement', 'demo-guide',
  'play', 'archived-sessions', 'archived-count', 'archived-list',
  'sidebar', 'conversation', 'open-drawer', 'close-drawer', 'drawer-backdrop',
].map((id) => [id, document.getElementById(id)]));
const mobileLayout = matchMedia('(max-width: 700px)');
let drawerOpen = false;
const steps = releaseSteps();
const byId = Object.fromEntries(engineers.map((person) => [person.id, person]));
const taskTimers = new Set();
const toolSummaryLang = new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'zh-CN';
const toolSummaries = {
  send: { 'zh-CN': '向「{title}」发送消息', en: 'Send a message to “{title}”' },
  create: { 'zh-CN': '新建会话「{title}」', en: 'Create session “{title}”' },
  rename: { 'zh-CN': '将会话改名为「{title}」', en: 'Rename session to “{title}”' },
  read: {
    list: { 'zh-CN': '查看会话清单', en: 'List sessions' },
    archived: { 'zh-CN': '查看已归档会话', en: 'List archived sessions' },
    all: { 'zh-CN': '查看全部会话', en: 'List all sessions' },
    search: { 'zh-CN': '{scope}（筛选「{query}」）', en: '{scope} matching “{query}”' },
    turns: { 'zh-CN': '读取「{title}」的逐轮摘要', en: 'Read turn summaries for “{title}”' },
    text: { 'zh-CN': '读取「{title}」的对话文本', en: 'Read conversation text for “{title}”' },
  },
  interrupt: { 'zh-CN': '中断「{title}」的当前任务', en: 'Interrupt the current task in “{title}”' },
  archive: { 'zh-CN': '归档「{title}」', en: 'Archive “{title}”' },
  unarchive: { 'zh-CN': '恢复「{title}」', en: 'Unarchive “{title}”' },
  pin: { 'zh-CN': '置顶「{title}」', en: 'Pin “{title}”' },
  unpin: { 'zh-CN': '取消置顶「{title}」', en: 'Unpin “{title}”' },
};
let state;
let playing = false;
let playbackTimer;
let guideTarget;

const icon = {
  chat: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.8 14.5a6.3 6.3 0 1 1 3 1.6L4 17zM7 9h6m-6 3h4"/></svg>',
  people: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 16v-1.4c0-2 1.7-3.5 3.6-3.5h2c2 0 3.6 1.6 3.6 3.5V16m2.2-4.6a3.1 3.1 0 0 1 3 3.1V16M12.6 4.2a2.5 2.5 0 0 1 0 5"/><circle cx="7.4" cy="7.4" r="2.5"/></svg>',
  send: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-4.5 4.5L10 4l4.5 4.5"/></svg>',
  relay: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9 17 3l-6 14-2.5-5.5L3 9Zm5.5 2.5L17 3"/></svg>',
  pin: '<svg class="icon pin-mark" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" stroke="none" d="M9.5 1.7 14.3 6.5a1 1 0 0 1-1.4 1.4l-.5-.5-2.2 2.2a3.7 3.7 0 0 1-.6 2.9L7.1 10 3 14.1l-1.1-1.1L6 8.9 3.5 6.4a3.7 3.7 0 0 1 2.9-.6l2.2-2.2-.5-.5a1 1 0 0 1 1.4-1.4Z"/></svg>',
  play: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6z"/></svg>',
  pause: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4v12m6-12v12"/></svg>',
};

const currentStep = () => steps[state.index];
const nameOf = (id) => id === 'lead' ? state.title : byId[id].name;
const escapeText = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const spinner = () => '<span class="indicator running" aria-hidden="true"></span>';

function reset({ keepPlaying = false } = {}) {
  for (const timer of taskTimers) clearTimeout(timer);
  taskTimers.clear();
  if (!keepPlaying) setPlaying(false);
  state = {
    index: 0, active: null, title: '新会话', view: 'chat', summarizing: false,
    expertsOpen: false, pickerOpen: false, referenced: false, pinned: false, created: [], archived: new Set(), events: [], tasks: {},
  };
  ui['archived-sessions'].open = false;
  setDrawer(false);
  render({ bottom: true });
}

function setDrawer(open) {
  drawerOpen = open && mobileLayout.matches;
  ui.workspace.toggleAttribute('data-drawer-open', drawerOpen);
  ui['open-drawer'].setAttribute('aria-expanded', String(drawerOpen));
  ui.conversation.inert = drawerOpen;
  if (drawerOpen) {
    ui.sidebar.setAttribute('role', 'dialog');
    ui.sidebar.setAttribute('aria-modal', 'true');
  } else {
    ui.sidebar.removeAttribute('role');
    ui.sidebar.removeAttribute('aria-modal');
  }
}

function toggleDrawer(open) {
  setDrawer(open);
  if (open) {
    state.expertsOpen = false;
    state.pickerOpen = false;
    render();
    if (!playing) (guideTarget?.closest('#sidebar') ? guideTarget : ui['close-drawer']).focus({ preventScroll: true });
  } else {
    renderGuide();
    schedulePlayback();
    if (!playing) ui['open-drawer'].focus({ preventScroll: true });
  }
}

function advance() {
  state.index++;
  state.referenced = false;
  state.pickerOpen = false;
  if (currentStep().kind === 'done') setPlaying(false);
}

function navigate(id) {
  if (state.archived.has(id)) return;
  const step = currentStep();
  setDrawer(false);
  state.active = id;
  state.expertsOpen = false;
  state.pickerOpen = false;
  state.view = 'chat';
  if (id === step.session && (step.kind === 'visit' || state.tasks[step.waitFor] === 'done')) advance();
  render({ bottom: true });
  if (!playing) ui.transcript.focus({ preventScroll: true });
}

function reference(id) {
  const name = escapeText(nameOf(id));
  if (state.archived.has(id)) return `<span class="mention">${icon.chat}${name} · 已归档</span>`;
  return `<button type="button" class="reference" data-session="${id}">${icon.chat}${name}</button>`;
}

function renderSessions() {
  const ids = state.created.filter((id) => !state.archived.has(id)).reverse();
  if (state.pinned) ids.unshift(ids.splice(ids.indexOf('lead'), 1)[0]);
  ui.sessions.innerHTML = ids.map((id) => {
    const running = state.tasks[id] === 'running';
    const pinned = id === 'lead' && state.pinned;
    return `<button type="button" class="session" data-session="${id}" ${state.active === id ? 'aria-current="true"' : ''}>
      <span class="session-name">${escapeText(nameOf(id))}</span>
      <span class="session-trailing">${running ? `${spinner()}<span class="sr-only">运行中</span>` : ''}${pinned ? `${icon.pin}<span class="sr-only">已置顶</span>` : ''}</span>
    </button>`;
  }).join('');
  ui['archived-sessions'].hidden = state.archived.size === 0;
  ui['archived-count'].textContent = `已归档 · ${state.archived.size}`;
  ui['archived-list'].innerHTML = [...state.archived].map((id) => `<li>${escapeText(nameOf(id))}</li>`).join('');
}

function renderExperts() {
  const { active, tasks } = state;
  const sent = engineers.map(({ id }) => id).filter((id) => tasks[id] && !state.archived.has(id));
  const peers = active === 'lead' ? sent.slice().reverse() : sent.includes(active) ? ['lead'] : [];
  ui.collaboration.hidden = peers.length === 0;
  const label = `${peers.length} 个协作专家`;
  ui.experts.setAttribute('aria-label', label);
  ui.experts.innerHTML = `${icon.people}<span class="expert-label">${label}</span><span class="chevron" aria-hidden="true"></span><span class="expert-count" aria-hidden="true">${peers.length}</span>`;
  ui.experts.setAttribute('aria-expanded', String(state.expertsOpen));
  ui['expert-panel'].hidden = !state.expertsOpen;
  ui['expert-panel'].innerHTML = peers.map((id) => {
    const running = tasks[id] === 'running';
    const outgoing = active === 'lead' ? tasks[id] !== 'done' : tasks[active] === 'done';
    const status = running ? '运行中' : '空闲';
    return `<button type="button" class="expert-row" data-session="${id}">
      ${running ? spinner() : '<span class="indicator" aria-hidden="true"></span>'}
      <span><strong>${outgoing ? '→' : '←'} ${escapeText(nameOf(id))}</strong><small>${outgoing ? '我发出的' : '我收到的'} · ${status}</small></span>
    </button>`;
  }).join('');
}

function recordToolCall(call) {
  // Keep the title as it was when the call ran, even if the session is renamed later.
  const toolId = call.args?.session_id;
  const sessionId = typeof toolId === 'string' && toolId.startsWith('session-')
    ? toolId.slice('session-'.length) : undefined;
  const knownSession = sessionId === 'lead' || Object.hasOwn(byId, sessionId);
  return { ...call, targetTitle: knownSession ? nameOf(sessionId) : undefined };
}

function toolSummary({ args, targetTitle }) {
  const { action, session_id, scope, query, mode, turn, from_turn, to_turn } = args ?? {};
  if (typeof action !== 'string' || !action.trim()) {
    const label = toolSummaryLang === 'en' ? 'Tool call' : '工具调用';
    return `session · ${label}`;
  }
  let templates = Object.hasOwn(toolSummaries, action) ? toolSummaries[action] : undefined;
  if (action === 'read') {
    if (typeof session_id === 'string' && session_id.length > 0) {
      const hasTextOptions = [mode, turn, from_turn, to_turn].some((value) => value !== undefined);
      templates = hasTextOptions ? templates.text : templates.turns;
    } else {
      const scopeLabel = (scope === 'archived' ? templates.archived : scope === 'all' ? templates.all : templates.list)[toolSummaryLang];
      const text = typeof query === 'string' && query.trim()
        ? templates.search[toolSummaryLang].replace(/\{(scope|query)\}/g, (_, key) => key === 'scope' ? scopeLabel : query.trim())
        : scopeLabel;
      return `session · ${text}`;
    }
  }
  let title = targetTitle;
  if (action === 'create') title = args.title;
  if (action === 'rename') title = args.content;
  const template = templates?.[toolSummaryLang];
  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  if (!template || (template.includes('{title}') && !hasTitle)) return `session · ${action}`;
  return `session · ${template.replace('{title}', () => title)}`;
}

function toolTrace(call, key, expanded) {
  const { args = {}, output } = call;
  return `<details class="tool-row" data-tool-key="${key}" ${expanded ? 'open' : ''}>
    <summary><span class="tool-name" lang="${toolSummaryLang}">${escapeText(toolSummary(call))}</span></summary>
    <div class="tool-body"><p class="tool-caption">输入</p><pre aria-label="请求参数">${escapeText(JSON.stringify(args, null, 2))}</pre>${output ? `<div class="tool-output"><p class="tool-caption">输出</p><p>${escapeText(output)}</p></div>` : ''}</div>
  </details>`;
}

function renderEvent(event, index, opened) {
  const trace = state.view === 'trace';
  if (event.receipt) {
    const id = event.receipt;
    if (trace) return `<p class="trace-event">↩ ${escapeText(nameOf(id))} · 自动回执</p>`;
    const timestamp = new Date(event.receivedAt);
    const clock = timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const sender = `session-${id}`;
    const body = `Session ${sender} replied (receipt): 【来自另一个会话 · ${sender} · 协作专家回执】\n${byId[id].result}`;
    return `<details class="transcript-item receipt" data-receipt-key="${index}" ${opened.has(`receipt-${index}`) ? 'open' : ''}>
      <summary>${icon.relay}<span>收到任务消息</span><time datetime="${timestamp.toISOString()}">${clock}</time><span class="chevron" aria-hidden="true"></span></summary>
      <div class="receipt-body"><p>这条通知触发了本轮回复。</p><pre>${escapeText(body)}</pre></div>
    </details>`;
  }
  const tools = event.calls ?? (event.tool ? [event.tool] : []);
  const rows = tools.map((call, i) => {
    const key = `${index}-${i}`;
    return toolTrace(call, key, trace || opened.has(key));
  }).join('');
  const reply = event.result ? `<p class="reply${event.calls ? ' release-summary' : ''}">${escapeText(event.result)}</p>` : '';
  const working = event.pending ? `<p class="working">${spinner()} 正在读取并汇总会话</p>` : '';
  return `<article class="transcript-item${event.calls ? ' summary-turn' : ''}">
    ${trace ? '' : `<div class="message"><div class="bubble">${event.dispatch ? reference(event.dispatch) : ''} ${escapeText(event.prompt)}</div></div>`}
    ${rows || working ? `<div class="tool-group">${rows}${working}</div>` : ''}${reply}</article>`;
}

function renderTranscript() {
  const { active, events, tasks, view } = state;
  let content = '';
  if (!active) {
    content = '<div class="welcome"><img src="./harness-mark.svg" width="32" height="24" alt=""><div><strong>V1.8 发布</strong><p>创建第一个会话，或从右上角播放完整演示。</p></div></div>';
  } else if (active === 'lead') {
    const opened = new Set();
    for (const row of ui.transcript.querySelectorAll('.thread[data-view="chat"] details[open]')) {
      if (row.dataset.toolKey) opened.add(row.dataset.toolKey);
      if (row.dataset.receiptKey) opened.add(`receipt-${row.dataset.receiptKey}`);
    }
    content = events.map((event, index) => renderEvent(event, index, opened)).join('');
  } else if (tasks[active]) {
    const person = byId[active];
    const task = events.findLast(({ dispatch }) => dispatch === active);
    if (view === 'trace') {
      content = '<p class="trace-event">收到来源会话的任务</p>';
      if (tasks[active] === 'done') content += '<p class="trace-event">↩ 自动回执已送达</p>';
      if (tasks[active] === 'interrupted') content += '<p class="trace-event">当前轮已中断</p>';
    } else {
      content = `<article class="message transcript-item incoming"><div class="bubble"><div class="source">来自 ${reference('lead')}</div><p>${escapeText(task.prompt)}</p></div></article>
        <article class="reply transcript-item">${tasks[active] === 'running'
          ? `<p class="working">${spinner()} 正在处理发布任务</p>`
          : tasks[active] === 'interrupted'
            ? '<p>旧版接口检查已中断。这轮没有自动回执。</p>'
            : `<p>${person.result}</p><p class="reference-note">已自动回执给${escapeText(state.title)}</p>`}</article>`;
    }
  }
  ui.transcript.innerHTML = `<div class="thread" data-view="${view}">${content}</div>`;
}

function renderComposer() {
  const step = currentStep();
  const canSend = state.active === 'lead' && step.kind === 'send' && !state.summarizing;
  const person = canSend && step.dispatch ? byId[step.dispatch] : null;
  const needsReference = step.pick && !state.referenced;
  const done = step.kind === 'done' && state.active === 'lead';
  const waiting = step.kind === 'return' && state.tasks[step.waitFor] === 'running';
  let placeholder = '发消息或创建任务';
  if (done) placeholder = '发布检查已汇总，两个协作会话已归档。';
  if (waiting) placeholder = `正在等待${nameOf(step.waitFor)}的自动回执…`;
  if (state.summarizing) placeholder = '正在汇总发布检查…';
  const picker = person && state.pickerOpen ? `<div class="picker" id="picker"><p>对话</p>
    <button type="button" class="picker-row selected" data-action="pick">${icon.chat}${person.name}</button></div>` : '';
  ui.composer.innerHTML = `${picker}<div class="composer">
    ${canSend ? `<p class="draft">${person && !needsReference ? `<span class="mention">${icon.chat}${person.name}</span> ` : ''}${escapeText(step.prompt)}</p>` : `<p class="placeholder">${placeholder}</p>`}
    <div class="composer-bar"><div class="composer-tools">
      <button type="button" class="at-button" data-action="at" aria-label="@ 引用会话" aria-expanded="${state.pickerOpen}" ${person ? '' : 'disabled'}>@</button><span>演示模式</span>
    </div><button type="button" class="send-button" data-action="${done ? 'reset' : 'send'}" aria-label="${done ? '再演示一次' : '发送'}" ${(canSend && !needsReference) || done ? '' : 'disabled'}>${done ? '↺' : icon.send}</button></div>
  </div>`;
}

function sessionCue(target, label) {
  if (mobileLayout.matches && !drawerOpen) return { target: ui['open-drawer'], label: `打开列表，${label}` };
  return { target, label };
}

function guide() {
  const step = currentStep();
  if (step.kind === 'new') return sessionCue(ui['new-session'], step.label);
  if (step.kind === 'visit') return sessionCue(ui.sessions.querySelector(`[data-session="${step.session}"]`), step.label);
  if (step.kind === 'return') {
    if (state.tasks[step.waitFor] !== 'done') return null;
    return sessionCue(ui.sessions.querySelector('[data-session="lead"]'), step.label);
  }
  if (state.active !== 'lead') return sessionCue(ui.sessions.querySelector('[data-session="lead"]'), '返回项目负责人');
  if (drawerOpen) return { target: ui['close-drawer'], label: '返回对话继续演示' };
  if (state.summarizing) return null;
  if (state.pickerOpen) return { target: ui.composer.querySelector('[data-action="pick"]'), label: '引用负责人会话' };
  if (step.pick && !state.referenced) return { target: ui.composer.querySelector('[data-action="at"]'), label: '选择要引用的会话' };
  return { target: ui.composer.querySelector(`[data-action="${step.kind === 'done' ? 'reset' : 'send'}"]`), label: step.label };
}

function positionGuide() {
  const label = ui['demo-guide'];
  if (!guideTarget?.isConnected || !guideTarget.getClientRects().length) { label.hidden = true; return; }
  const rect = guideTarget.getBoundingClientRect();
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  label.hidden = rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width;
  if (label.hidden) return;
  const w = label.offsetWidth;
  const h = label.offsetHeight;
  const xCenter = rect.left + rect.width / 2;
  const yCenter = rect.top + rect.height / 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const inSidebar = guideTarget.closest('.sidebar');
  const gap = 10;
  let side;
  let x;
  let y;
  if (inSidebar && width > 700 && rect.right + gap + w < width - 8) {
    side = 'left';
    x = rect.right + gap;
    y = clamp(yCenter - h / 2, 8, height - h - 8);
  } else if (!inSidebar && rect.left - gap - w >= 8) {
    side = 'right';
    x = rect.left - gap - w;
    y = clamp(yCenter - h / 2, 8, height - h - 8);
  } else {
    side = rect.bottom + gap + h <= height - 8 ? 'top' : 'bottom';
    x = clamp(xCenter - w / 2, 8, width - w - 8);
    y = clamp(side === 'top' ? rect.bottom + gap : rect.top - gap - h, 8, height - h - 8);
  }
  label.style.left = `${x}px`;
  label.style.top = `${y}px`;
  label.dataset.arrow = side;
  const vertical = side === 'top' || side === 'bottom';
  label.style.setProperty('--arrow-offset', `${clamp(vertical ? xCenter - x : yCenter - y, 7, (vertical ? w : h) - 7)}px`);
}

function renderGuide() {
  const previous = ui['demo-guide'].textContent;
  guideTarget?.removeAttribute('aria-describedby');
  const cue = guide();
  guideTarget = cue?.target;
  if (guideTarget) {
    guideTarget.setAttribute('aria-describedby', 'demo-guide');
    ui['demo-guide'].textContent = cue.label;
  }
  positionGuide();
  if (cue && previous !== cue.label && !ui['demo-guide'].hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ui['demo-guide'].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  }
}

function render({ bottom = false } = {}) {
  const activeElement = document.activeElement;
  const focusedAction = activeElement?.dataset.action;
  const focusedSession = activeElement?.closest('#sessions') && activeElement.dataset.session;
  const focusedDisclosure = activeElement?.matches('summary') ? activeElement.parentElement?.dataset : undefined;
  const step = currentStep();
  ui['new-session'].disabled = step.kind !== 'new';
  ui.reset.disabled = step.kind === 'new';
  ui.conversation.toggleAttribute('data-blank', !state.active);
  ui['conversation-title'].textContent = state.active ? nameOf(state.active) : '新版发布';
  renderSessions();
  renderExperts();
  renderTranscript();
  renderComposer();
  for (const button of ui.workspace.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  if (bottom) ui.transcript.scrollTop = ui.transcript.scrollHeight;
  renderGuide();
  if (!playing && !activeElement?.isConnected) {
    let replacement;
    if (focusedDisclosure?.toolKey) {
      replacement = ui.transcript.querySelector(`[data-tool-key="${focusedDisclosure.toolKey}"] > summary`);
    } else if (focusedDisclosure?.receiptKey) {
      replacement = ui.transcript.querySelector(`[data-receipt-key="${focusedDisclosure.receiptKey}"] > summary`);
    } else if (focusedAction) {
      replacement = ui.composer.querySelector(`[data-action="${focusedAction}"]:not(:disabled)`);
    } else if (focusedSession) {
      replacement = ui.sessions.querySelector(`[data-session="${focusedSession}"]`);
    }
    (replacement ?? guideTarget)?.focus({ preventScroll: true });
  }
  schedulePlayback();
}

function dispatchTask({ dispatch: id, prompt, superseded }) {
  const person = byId[id];
  state.tasks[id] = 'running';
  state.expertsOpen = true;
  const result = `已投递到会话「${person.name}」，并请求自动回执。`;
  const tool = recordToolCall({
    args: { action: 'send', session_id: `session-${id}`, content: prompt, receipt: true },
    output: result,
  });
  state.events.push({ dispatch: id, prompt, tool, result });
  // The demo holds the outdated check open until the guided interrupt.
  if (superseded) return;
  const timer = setTimeout(() => {
    taskTimers.delete(timer);
    const { scrollHeight, scrollTop, clientHeight } = ui.transcript;
    const follow = scrollHeight - scrollTop - clientHeight < 32;
    state.tasks[id] = 'done';
    state.events.push({ receipt: id, receivedAt: Date.now() });
    if (currentStep().waitFor === id && state.active === 'lead') advance();
    render({ bottom: follow });
    ui.announcement.textContent = `收到${person.name}的自动回执。`;
  }, person.duration);
  taskTimers.add(timer);
}

function summarize({ prompt, calls, result }) {
  const recordedCalls = calls.map(recordToolCall);
  const turn = { prompt, calls: [], pending: true };
  state.summarizing = true;
  state.events.push(turn);
  render({ bottom: true });

  function showNextResult() {
    const transcript = ui.transcript;
    const follow = state.active === 'lead' && transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 32;
    const call = recordedCalls[turn.calls.length];
    if (call) {
      turn.calls.push(call);
      render({ bottom: follow });
      scheduleNextResult();
    } else {
      turn.result = result;
      turn.pending = false;
      state.summarizing = false;
      advance();
      render({ bottom: follow });
      ui.announcement.textContent = result;
    }
  }

  function scheduleNextResult() {
    const timer = setTimeout(() => {
      taskTimers.delete(timer);
      showNextResult();
    }, 480);
    taskTimers.add(timer);
  }

  scheduleNextResult();
}

function send() {
  const step = currentStep();
  if (step.kind !== 'send' || state.active !== 'lead' || state.summarizing || (step.pick && !state.referenced)) return;
  state.view = 'chat';
  const { dispatch, prompt, args, result, effect } = step;
  if (step.calls) { summarize(step); return; }
  if (dispatch) dispatchTask(step);
  else {
    const tool = recordToolCall({ args, output: result });
    if (effect?.rename) state.title = effect.rename;
    if (effect?.create) state.created.push(effect.create);
    if (typeof effect?.pin === 'boolean') state.pinned = effect.pin;
    if (effect?.archive) state.archived.add(effect.archive);
    if (effect?.unarchive) state.archived.delete(effect.unarchive);
    if (effect?.interrupt) state.tasks[effect.interrupt] = 'interrupted';
    state.events.push({ prompt, tool, result });
  }
  advance();
  render({ bottom: true });
  if (dispatch) {
    const rect = ui['expert-panel'].getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) ui.experts.scrollIntoView({ block: 'nearest' });
  }
  ui.announcement.textContent = dispatch ? `已投递给${nameOf(dispatch)}。协作专家列表已展开。` : result;
}

function schedulePlayback() {
  clearTimeout(playbackTimer);
  if (!playing || !guideTarget || currentStep().kind === 'done') return;
  const target = guideTarget;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  positionGuide();
  playbackTimer = setTimeout(() => {
    if (playing && target === guideTarget && target.isConnected) target.click();
  }, currentStep().kind === 'visit' ? 2200 : 1500);
}

function setPlaying(value) {
  playing = value;
  const label = value ? '暂停播放' : '自动播放';
  ui.play.setAttribute('aria-label', label);
  ui.play.title = label;
  ui.play.innerHTML = `${value ? icon.pause : icon.play}<span>${label}</span>`;
  if (!value) clearTimeout(playbackTimer);
}

ui.workspace.addEventListener('click', (event) => {
  if (event.target === ui['drawer-backdrop']) {
    setPlaying(false);
    toggleDrawer(false);
    return;
  }
  const button = event.target.closest('button');
  if (!button) {
    if (event.isTrusted && playing && event.target.closest('.tool-row > summary, .receipt > summary')) {
      setPlaying(false);
    }
    return;
  }
  if (button === ui.play) {
    setPlaying(!playing);
    if (playing && currentStep().kind === 'done') reset({ keepPlaying: true });
    else schedulePlayback();
    return;
  }
  if (event.isTrusted && playing) setPlaying(false);
  if (button === ui['open-drawer'] || button === ui['close-drawer']) {
    toggleDrawer(button === ui['open-drawer']);
    return;
  }
  if (button === ui.experts) {
    state.expertsOpen = !state.expertsOpen;
    renderExperts();
    return;
  }
  if (!event.composedPath().includes(ui.collaboration)) {
    state.expertsOpen = false;
    renderExperts();
  }
  if (button.dataset.session) { navigate(button.dataset.session); return; }
  if (button.dataset.view) {
    state.view = button.dataset.view;
    render({ bottom: true });
    return;
  }
  if (button === ui.reset || button.dataset.action === 'reset') {
    reset();
    guideTarget?.focus({ preventScroll: true });
    return;
  }
  const action = button.dataset.action;
  if (action === 'new' && currentStep().kind === 'new') {
    state.active = 'lead';
    state.created.push('lead');
    setDrawer(false);
    advance();
    render();
    if (!playing) guideTarget?.focus({ preventScroll: true });
  } else if (action === 'send') {
    send();
  } else if (action === 'at' || action === 'pick') {
    if (action === 'pick') state.referenced = true;
    state.pickerOpen = action === 'at' && !state.pickerOpen;
    render();
    const target = ui.composer.querySelector(state.pickerOpen ? '[data-action="pick"]' : '[data-action="send"]');
    target?.focus({ preventScroll: true });
  }
});

document.addEventListener('keydown', (event) => {
  if (drawerOpen && event.key === 'Tab') {
    const controls = [...ui.sidebar.querySelectorAll('button:not(:disabled), summary, a[href]')]
      .filter((element) => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key !== 'Escape') return;
  if (playing) setPlaying(false);
  if (drawerOpen) {
    event.preventDefault();
    toggleDrawer(false);
    return;
  }
  if (state.expertsOpen) {
    state.expertsOpen = false;
    renderExperts();
    ui.experts.focus({ preventScroll: true });
  }
  if (state.pickerOpen) {
    state.pickerOpen = false;
    render();
    ui.composer.querySelector('[data-action="at"]').focus({ preventScroll: true });
  }
});

mobileLayout.addEventListener('change', () => {
  const wasOpen = drawerOpen;
  setDrawer(false);
  render();
  if (wasOpen && !playing) (guideTarget ?? ui.transcript).focus({ preventScroll: true });
});
window.addEventListener('resize', positionGuide);
window.addEventListener('scroll', positionGuide, { passive: true });
ui.sidebar.addEventListener('scroll', positionGuide, { passive: true });
reset();
