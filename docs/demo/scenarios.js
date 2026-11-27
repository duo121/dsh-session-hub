const leadSessionId = 'session-876370dd-bf29-4bfc-8c8c-46c777b3284b';

const releaseNotes = {
  id: 'session-437a4895-00d8-43cf-a49b-4bca2ea66df3',
  draftTitle: '发布记录',
  title: 'V1.8 发布记录',
};

const engineers = [
  {
    id: 'session-8e542fc8-7134-4619-8088-f6b5ce77759f',
    title: '前端工程师',
    request: '请检查新版发布页的加载、空数据和失败提示，完成后告诉我结果。',
    progress: '我先检查了慢速网络下的加载提示和空数据时的占位内容，再模拟接口失败，确认重试后能回到正常页面。',
    result: '加载、空数据和失败重试均已验证，移动端布局正常。',
  },
  {
    id: 'session-341b9e80-5b3b-4420-a179-facc0c71081b',
    title: '后端工程师',
    request: '请核对发布状态接口的响应和错误码，完成后告诉我联调结果。',
    progress: '我分别核对了已发布版本、找不到版本、服务暂时不可用三种响应，并确认错误码与前端约定一致。',
    result: '发布状态接口已联调，成功响应以及 404、503 错误码均符合约定。',
  },
];

const testSession = {
  id: 'session-a6cab884-5958-4721-a44c-82eb265c2b16',
  title: 'V1.8 回归测试',
  request: '请再跑一次 V1.8 发布页回归测试，并在结束后回执。',
};

function prepare({ button, trace, setStatus, actions, resetButton }) {
  const commands = [
    {
      prompt: `请新建一个叫「${releaseNotes.draftTitle}」的会话。`,
      args: { action: 'create', title: releaseNotes.draftTitle },
      result: `已新建会话 ${releaseNotes.id}。已命名为「${releaseNotes.draftTitle}」，并挂到「新版发布」工作区。`,
      status: `已创建「${releaseNotes.draftTitle}」。接下来可以把版本号加到标题里。`,
    },
    {
      prompt: `把「${releaseNotes.draftTitle}」改名为「${releaseNotes.title}」。`,
      args: { action: 'rename', session_id: releaseNotes.id, content: releaseNotes.title },
      result: `已把会话 ${releaseNotes.id} 重命名为「${releaseNotes.title}」。`,
      status: `已改名为「${releaseNotes.title}」。接下来可以把它置顶。`,
    },
    {
      prompt: `请置顶「${releaseNotes.title}」，发布时方便找到。`,
      args: { action: 'pin', session_id: releaseNotes.id },
      result: `已置顶会话 ${releaseNotes.id}，它会排在未置顶会话之前。`,
      status: `「${releaseNotes.title}」已置顶，准备完成。`,
    },
  ];
  let step = 0;

  function showNext() {
    const command = commands[step];
    if (!command) {
      actions.replaceChildren();
      actions.hidden = true;
      return;
    }
    const next = button(command.prompt, () => {
      trace(command);
      step++;
      showNext();
      setStatus(command.status);
      const nextControl = actions.hidden ? resetButton : actions.firstElementChild;
      nextControl.focus();
    });
    actions.replaceChildren(next);
  }

  setStatus('还没有发布记录会话。');
  showNext();
}

function selectField(make, text, options) {
  const label = make('label');
  const select = make('select');
  select.setAttribute('aria-label', text);
  for (const [value, title] of options) {
    const option = make('option', '', title);
    option.value = value;
    select.append(option);
  }
  label.append(make('span', '', text), select);
  return { label, select };
}

function summarize({ make, button, trace, setStatus, actions, message }) {
  const seen = new Set();
  const target = selectField(make, '会话', engineers.map(({ id, title }) => [id, title]));
  const mode = selectField(make, '读取方式', [['digest', '逐轮摘要'], ['dialog', '完整对话']]);
  const fields = make('div', 'scenario-read-controls');
  fields.hidden = true;

  function read() {
    const engineer = engineers.find(({ id }) => id === target.select.value);
    const dialog = mode.select.value === 'dialog';
    const args = { action: 'read', session_id: engineer.id };
    if (dialog) args.mode = 'dialog';
    const type = dialog ? '完整对话' : '逐轮摘要';
    trace({
      prompt: `请读取「${engineer.title}」的${type}。`,
      args,
      result: [
        `会话：${engineer.title} · ${type} · 共 1 轮`,
        '',
        ...(dialog ? [
          `用户：${engineer.request}`,
          `助手：${engineer.progress}`,
          `助手：${engineer.result}`,
        ] : [
          '第 1 轮',
          `问：${engineer.request}`,
          `答：${engineer.result}`,
        ]),
      ].join('\n'),
    });
    seen.add(engineer.id);
    report.disabled = seen.size < engineers.length;
    setStatus(`已读取${engineer.title}的${type}。${report.disabled ? '再读取另一位工程师的会话。' : '两位工程师的结果都已读到，可以汇总。'}`);
  }

  const readButton = button('读取所选会话', read);
  const report = button('汇总两位工程师的发布检查结果', () => {
    message('汇总两位工程师的发布检查结果。');
    message(`V1.8 发布检查已完成。${engineers.map(({ result }) => result).join('')}`, '发布助手');
    setStatus('汇总完成。仍可切换会话和读取方式。');
  });
  report.disabled = true;
  fields.append(target.label, mode.label, readButton, report);

  const list = button('请列出当前工作区的会话', () => {
    trace({
      prompt: '请列出当前工作区的会话，找出两位发布工程师。',
      args: { action: 'read' },
      result: [
        '会话清单（未归档）共 3 条',
        '',
        `项目负责人 · 2 轮 · 用户\n${leadSessionId}`,
        ...engineers.map(({ title, id }) => `${title} · 1 轮 · 用户\n${id}`),
        '',
        '传入 session_id 读取逐轮摘要，再传 mode=dialog 可查看完整对话。',
      ].join('\n'),
    });
    list.hidden = true;
    fields.hidden = false;
    setStatus('找到了前端工程师和后端工程师。请选择要读的会话和读取方式。');
    target.select.focus();
  });
  actions.append(list, fields);
  setStatus('两位工程师已完成检查。先从会话清单找到他们的会话。');
}

function closeRelease({ button, trace, setStatus, actions }) {
  const frontend = engineers[0];
  let archived = false;
  let pinned = true;
  let test = 'ready';

  function refresh(focusTarget) {
    archive.hidden = archived;
    restore.hidden = !archived;
    unpin.hidden = !pinned;
    start.hidden = test !== 'ready';
    interrupt.hidden = test !== 'running';
    const frontendState = archived ? '已归档' : '在会话列表中（已完成）';
    const testState = { ready: '未启动', running: '模拟运行中', interrupted: '已中断，无自动回执' };
    setStatus(`前端工程师${frontendState}。发布记录${pinned ? '已置顶' : '已取消置顶'}。回归测试${testState[test]}。`);
    if (focusTarget) focusTarget.focus();
  }

  const archive = button('归档已完成检查的前端工程师', () => {
    trace({
      prompt: '前端检查已完成，请归档前端工程师的会话。',
      args: { action: 'archive', session_id: frontend.id },
      result: '已归档「前端工程师」。它已从未归档列表移除，对话内容保留，可随时取消归档。',
    });
    archived = true;
    refresh(restore);
  });
  const restore = button('恢复前端工程师会话', () => {
    trace({
      prompt: '我还要查看前端检查记录，请恢复前端工程师的会话。',
      args: { action: 'unarchive', session_id: frontend.id },
      result: '已取消归档「前端工程师」，它已回到未归档列表。',
    });
    archived = false;
    refresh(archive);
  });
  const unpin = button('取消置顶 V1.8 发布记录', () => {
    trace({
      prompt: '发布已结束，请取消置顶「V1.8 发布记录」。',
      args: { action: 'unpin', session_id: releaseNotes.id },
      result: '已取消置顶「V1.8 发布记录」，会话仍保留在未归档列表。',
    });
    pinned = false;
    refresh(archived ? restore : archive);
  });
  const start = button('模拟运行一次回归测试（可选）', () => {
    trace({
      prompt: testSession.request,
      args: { action: 'send', session_id: testSession.id, content: testSession.request, receipt: true },
      result: `已向「${testSession.title}」投递任务，已请求自动回执。测试会保持模拟运行状态，直到你中断或重置本章。`,
    });
    test = 'running';
    refresh(interrupt);
  });
  const interrupt = button('中断正在运行的 V1.8 回归测试', () => {
    trace({
      prompt: '这次回归测试不用继续了，请中断「V1.8 回归测试」当前这一轮。',
      args: { action: 'interrupt', session_id: testSession.id },
      result: '已中断「V1.8 回归测试」当前这一轮。排队中的消息不受影响。该轮没有正常完成，项目负责人不会收到自动回执。',
    });
    test = 'interrupted';
    refresh(archived ? restore : archive);
  });
  actions.append(archive, restore, unpin, start, interrupt);
  refresh();
}

const chapters = [
  {
    id: 'prepare',
    title: '准备会话',
    description: '新建带标题的发布记录会话，再改名和置顶。',
    intro: '项目负责人需要一个地方保存 V1.8 的发布记录。',
    run: prepare,
  },
  {
    id: 'summarize',
    title: '汇总工程师进展',
    description: '查找两位工程师，切换逐轮摘要和完整对话。',
    intro: '前端与后端的 V1.8 发布检查均已完成。项目负责人想把两份结果合成一段发布记录。',
    run: summarize,
  },
  {
    id: 'close',
    title: '收尾发布',
    description: '归档、恢复、取消置顶，也可以试着中断一轮测试。',
    intro: 'V1.8 已发布。项目负责人要整理已完成的会话，还可以试着中断一轮单独模拟的回归测试。',
    run: closeRelease,
  },
];

export function mountScenarios(container, { onCollaboration, onChapter, onOperation }) {
  function make(tag, className, text) {
    const node = container.ownerDocument.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(text, onClick) {
    const node = make('button', 'scenario-action', text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function showPicker({ focus = false } = {}) {
    const picker = make('div', 'scenario-picker');
    const heading = make('h2', '', 'V1.8 发布 · 可选章节');
    heading.tabIndex = -1;
    const actions = make('div', 'scenario-actions');
    for (const chapter of chapters) {
      const entry = button(chapter.title, () => showChapter(chapter.id));
      entry.dataset.scenario = chapter.id;
      entry.replaceChildren(make('strong', '', chapter.title), make('span', '', chapter.description));
      actions.append(entry);
    }
    const nav = make('nav', 'scenario-nav');
    nav.setAttribute('aria-label', '演示导航');
    nav.append(button('返回跨会话协作', () => onCollaboration()));
    picker.append(heading, make('p', 'reference-note', '每章可独立体验。所有操作都使用固定的模拟会话。'), actions, nav);
    container.replaceChildren(picker);
    if (focus) heading.focus();
  }

  function showChapter(id, reset = false) {
    const chapter = chapters.find((entry) => entry.id === id);
    if (!chapter) return;
    onChapter?.(id, id === 'close' ? releaseNotes.title : null);
    const heading = make('h2', '', chapter.title);
    heading.tabIndex = -1;
    const nav = make('nav', 'scenario-nav');
    nav.setAttribute('aria-label', '章节导航');
    const resetButton = button('重置本章', () => showChapter(id, true));
    nav.append(button('返回章节选择', () => showPicker({ focus: true })), resetButton);
    const intro = make('p', 'reference-note', chapter.intro);
    const transcript = make('div', 'scenario-transcript');
    transcript.setAttribute('role', 'region');
    transcript.setAttribute('aria-label', '会话消息与工具轨迹');
    transcript.tabIndex = 0;
    const status = make('p', 'scenario-status');
    status.setAttribute('role', 'status');
    const actions = make('div', 'scenario-actions');

    function message(text, speaker = '项目负责人') {
      const item = make('article', 'message transcript-item');
      if (speaker !== '项目负责人') item.classList.add('scenario-reply');
      const bubble = make('div', 'bubble');
      bubble.append(make('div', 'source', speaker), make('p', '', text));
      item.append(bubble);
      transcript.append(item);
      transcript.scrollTop = transcript.scrollHeight;
    }

    function trace({ prompt, args, result }) {
      message(prompt);
      const row = make('details', 'tool-row');
      row.open = true;
      const summary = make('summary', '', '工具调用 · ');
      summary.append(make('code', '', `session · ${args.action}`));
      const body = make('div', 'scenario-tool-body');
      const parameters = make('pre', '', JSON.stringify(args, null, 2));
      const output = make('pre', '', result);
      body.append(make('p', '', '请求参数'), parameters, make('p', '', '工具结果'), output);
      row.append(summary, body);
      transcript.append(row);
      transcript.hidden = false;
      transcript.scrollTop = transcript.scrollHeight;
      onOperation?.(args);
    }

    function setStatus(text) {
      status.textContent = text;
    }

    transcript.hidden = true;
    container.replaceChildren(heading, nav, intro, transcript, status, actions);
    chapter.run({ make, button, trace, setStatus, actions, message, resetButton });
    if (reset) resetButton.focus();
    else heading.focus();
    if (reset) status.textContent = `本章已重置。${status.textContent}`;
  }

  showPicker();
  return { showPicker, showChapter };
}
