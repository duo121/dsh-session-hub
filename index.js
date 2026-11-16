/**
 * session-hub：会话中心的全部能力收在 `session` 一个工具里。
 *
 * 不传 action  → 只读：列清单 / 读逐轮摘要
 * 传 action    → 写：create / rename / send / interrupt / archive / unarchive / pin / unpin
 *
 * 设计要点：
 *   1. 归档闸门前置：归档会话的 pre-step 会被 archived-session-gate 静默拒绝，
 *      所以 send 之前必须先查归档集，绝不静默成功。
 *   2. 子会话一律拒绝：origin === 'subagent' 的会话由 subagent 路由持有。
 *   3. 来源标注：prompt 的 source 是 {kind:'user'}，不加前缀目标会话会误以为是
 *      是用户在说话，因此正文强制加「来自会话 X」。
 *   4. 环路防护：目标最近一条用户消息若来自本会话，则拒绝，防 A→B→A 烧 token。
 *   5. 运行中归档：必须先显式确认，确认后带 stopActivity 打断。
 *   6. create 必须挂靠 workspace：只传 cwd 时 session.create 不 attachSession，
 *      新会话不会进分组、界面上等于消失。
 *
 * 本文件刻意不 import 任何包：profile 的 link: 安装解析不到 dsh 安装目录下的
 * 依赖，直接构造 ToolDefinition 数据对象即可满足注册契约。
 */

/** Host Context 上本插件依赖的服务。 */
export const inject = ['tools', 'sessionQuery', 'workspaceRegistry'];

/** 归档范围取值。 */
const SCOPE_VALUES = ['active', 'archived', 'all'];
/** 来源取值。 */
const ORIGIN_VALUES = ['any', 'user', 'subagent'];
/** 写操作 action 的取值。 */
const ACTION_VALUES = ['send', 'create', 'rename', 'interrupt', 'archive', 'unarchive', 'pin', 'unpin'];

/**
 * 归一化会话 id 用于比较。
 *
 * 注意：`sessionQuery.listSessions()` 对已归档/冷却的持久化会话返回的
 * `header.id` 是**原始 uuid**（不带 `session-` 前缀），而归档集、置顶集、
 * 会话目录名与页面 URL 用的都是 `session-<uuid>`。两边必须统一，
 * 否则会出现「清单里看得到却报找不到」以及「归档闸门被绕过」。
 *
 * @param raw 任意写法的会话 id。
 * @returns 去前缀后的裸 id。
 */
function normalizeId(raw) {
  const value = String(raw).trim();
  return value.startsWith('session-') ? value.slice('session-'.length) : value;
}

/**
 * 把记录里的 header.id 规范成带 `session-` 前缀的对外 id。
 * @param header 会话头。
 * @returns `session-<uuid>`。
 */
function publicId(header) {
  return `session-${normalizeId(header.id)}`;
}

/**
 * 在 records 里按 id 找到会话（接受带/不带 `session-` 前缀）。
 * @param records `sessionQuery.listSessions()` 的结果。
 * @param rawId 模型给的会话 id。
 * @returns 命中的记录或 undefined。
 */
function findRecord(records, rawId) {
  const wanted = normalizeId(rawId);
  return records.find((record) => normalizeId(record.header.id) === wanted);
}

/**
 * 把 epoch 毫秒格式化为本地时间。
 * @param {number | undefined} ms epoch 毫秒。
 * @returns {string} `MM-DD HH:mm` 或 `-`。
 */
function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** @returns 当前归档会话 id 集合（裸 uuid，便于与 listSessions 的 header.id 直接比较）。 */
function archivedSet(ctx) {
  return new Set((ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).map((id) => normalizeId(id)));
}

/** @returns 当前置顶会话 id 集合（裸 uuid）。 */
function pinnedSet(ctx) {
  return new Set((ctx.get('workspaceRegistry')?.pinnedSessionIds ?? []).map((id) => normalizeId(id)));
}

/** @returns 该会话是否已归档。 */
function isArchived(archived, header) {
  return archived.has(normalizeId(header.id));
}

/** @returns 该会话是否已置顶。 */
function isPinned(pinned, header) {
  return pinned.has(normalizeId(header.id));
}

/**
 * 从一份投影快照里取出标题、轮数与逐轮大纲。
 * @param values 投影快照的 values。
 * @param into 累积目标。
 */
function absorbValues(values, into) {
  if (values === undefined || values === null) return;
  if (into.title === undefined && typeof values.title === 'string' && values.title.length > 0) {
    into.title = values.title;
  }
  const turns = values.sessionStats?.turns;
  if (into.turns === undefined && typeof turns === 'number') into.turns = turns;
  if (into.outline === undefined && Array.isArray(values.turnOutline)) {
    into.outline = values.turnOutline;
  }
}

/**
 * 读取一个会话的标题、轮数与逐轮大纲。
 * 在线会话读活投影；冷会话按 header 读持久化投影缓存（零日志 I/O）。
 * @param ctx Host Context。
 * @param header 会话头。
 * @returns `{ title, turns, outline }`，取不到的字段为 undefined。
 */
async function readHints(ctx, header) {
  const hints = { title: undefined, turns: undefined, outline: undefined };

  const projections = ctx.get('sessionProjections');
  const live = findSession(ctx, header);
  if (projections !== undefined && live !== undefined) {
    try {
      absorbValues(projections.cachedSnapshot(live)?.values, hints);
    } catch {
      // 投影缺失不是错误：继续降级。
    }
  }

  if (hints.title === undefined || hints.turns === undefined || hints.outline === undefined) {
    const cache = ctx.get('sessionProjectionCache');
    if (cache !== undefined) {
      try {
        absorbValues(cache.cachedSnapshot(header)?.values, hints);
      } catch {
        // 缓存缺失或身份不匹配时降级。
      }
    }
  }

  if (hints.title === undefined) {
    try {
      const snapshot = await ctx.sessionQuery.readTitle(header.id);
      if (typeof snapshot?.title === 'string' && snapshot.title.length > 0) {
        hints.title = snapshot.title;
      }
    } catch {
      // 冷会话无标题是正常情况。
    }
  }

  return hints;
}

/**
 * 按来源、归档状态筛选会话。
 * @param records listSessions 的返回值。
 * @param options 筛选条件。
 * @returns 筛选后的记录。
 */
function filterRecords(records, options) {
  const { origin, scope, archived } = options;
  return records.filter((record) => {
    const header = record.header;
    if (origin === 'user' && header.origin === 'subagent') return false;
    if (origin === 'subagent' && header.origin !== 'subagent') return false;
    const onArchived = isArchived(archived, header);
    if (scope === 'active') return !onArchived;
    if (scope === 'archived') return onArchived;
    return true;
  });
}

/**
 * 渲染会话清单。
 * @param rows 已排序的条目。
 * @param options 统计与展示选项。
 * @returns 文本。
 */
function renderList(rows, options) {
  const { scope, limit, cwdTotal, workspaceTotal } = options;
  const scopeLabel = { active: '未归档', archived: '已归档', all: '全部' }[scope];
  const shown = rows.slice(0, limit);

  const head = [
    `会话清单（scope=${scope}，${scopeLabel}）本范围共 ${rows.length} 条`,
    rows.length > shown.length ? `，显示前 ${shown.length} 条` : '',
    cwdTotal !== workspaceTotal ? `；当前目录 ${cwdTotal} 条，全部工作目录 ${workspaceTotal} 条` : '',
    '。',
  ].join('');

  const lines = [head, '', '时间\t轮数\t来源\t会话 id\t标题'];
  for (const row of shown) {
    const marks = [];
    if (row.live && !row.archived) marks.push('在线');
    if (row.archived) marks.push('已归档');
    if (row.pinned) marks.push('置顶');
    lines.push(
      `${row.time}\t${row.turns ?? '?'}\t${row.origin === 'subagent' ? '子智能体' : '用户'}\t` +
        `${row.sessionId}${marks.length > 0 ? ` [${marks.join(' ')}]` : ''}\t${row.title ?? '(无标题)'}`,
    );
  }
  if (rows.length === 0) lines.push('（该范围内没有会话）');
  lines.push(
    '',
    '要看某个会话讲了什么，传 session_id 获取逐轮摘要；按关键词搜正文用 session_search。',
    '要给它发消息或归档，给本工具传 action 与同一个 session_id。',
  );
  return lines.join('\n');
}

/**
 * 渲染一个会话的逐轮摘要。
 * @param header 会话头。
 * @param hints 投影信息。
 * @param options 展示选项。
 * @returns 文本。
 */
function renderDigest(header, hints, options) {
  const { archived, pinned, maxTurns } = options;
  const outline = hints.outline ?? [];

  const state = [archived ? '已归档' : '未归档', pinned ? '置顶' : ''].filter(Boolean).join('，');
  const lines = [
    `会话：${hints.title ?? '(无标题)'}`,
    `id：${header.id}`,
    `创建：${formatTime(header.createdAt)}`,
    `轮数：${hints.turns ?? '未知'}`,
    `来源：${header.origin === 'subagent' ? '子智能体' : '用户'}`,
    `目录：${header.cwd ?? '-'}`,
    `状态：${state}`,
    '',
  ];

  if (outline.length === 0) {
    lines.push('没有可用的逐轮摘要（该会话为 0 轮，或投影尚未生成）。');
    lines.push('若确需正文，可用 session_search 定位后以 session_event_read 逐条读取。');
    return lines.join('\n');
  }

  const shown = outline.slice(0, maxTurns);
  lines.push(`逐轮摘要（共 ${outline.length} 轮${shown.length < outline.length ? `，显示前 ${shown.length} 轮` : ''}）：`);
  lines.push('');
  for (const entry of shown) {
    lines.push(`第 ${entry.turn} 轮 [seq=${entry.seq}]`);
    lines.push(`  问：${entry.prompt.length > 0 ? entry.prompt : '（无预览）'}`);
    lines.push(`  答：${entry.response.length > 0 ? entry.response : '（无预览）'}`);
    lines.push('');
  }
  if (shown.length < outline.length) {
    lines.push(`其余 ${outline.length - shown.length} 轮已省略，可调大 max_turns。`);
  }
  lines.push('需要某轮完整原文：session_event_read 传 session_id 与该轮 seq。');
  return lines.join('\n');
}

// ───────────────────────── 完整对话抽取 ─────────────────────────

/** 对话模式的取值。 */
const MODE_VALUES = ['summary', 'dialog', 'full'];

/** 单个会话单次返回的字节上限（含标题等开销）。 */
const TRANSCRIPT_BYTE_BUDGET = 100 * 1024;

/**
 * 从会话事件流里抽出对话文本。
 *
 * 只保留用户消息与助手产出的 text 块；工具调用参数、工具结果、请求头、
 * job/hook/step 等协议事件一律丢弃——实测它们占原始事件的九成以上，
 * 且对理解"这个会话在干什么"几乎没有帮助。
 *
 * @param events 会话事件数组（`session/page` 或 `readSession` 的结果）。
 * @param mode summary | dialog | full。
 * @returns `{ turns, truncated }`，每轮含 user/assistant 文本。
 */
function extractDialog(events, mode) {
  const turns = [];
  let current = undefined;
  let nextTurn = 1;

  for (const event of events) {
    const type = event?.type;

    // turn/start 划定轮次边界，之后的 user/assistant 都归这一轮。
    if (type === 'turn/start') {
      const turn = typeof event.data?.turn === 'number' ? event.data.turn : nextTurn;
      nextTurn = turn + 1;
      current = { turn, user: [], assistant: [] };
      turns.push(current);
      continue;
    }

    if (type === 'user/message') {
      const source = event.data?.source ?? {};
      // 只收真正的用户输入；system-reminder / 时间上下文 / 模型切换提示都跳过。
      if (source.kind !== 'user') continue;
      const parts = (event.data?.content ?? [])
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text);
      if (parts.length === 0) continue;
      if (current === undefined) {
        current = { turn: nextTurn++, user: [], assistant: [] };
        turns.push(current);
      }
      current.user.push(parts.join('\n'));
      continue;
    }

    if (type === 'assistant/message') {
      const blocks = event.data?.message?.content ?? [];
      const texts = blocks
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text);
      if (texts.length === 0) continue;
      const turn = event.data?.turn;
      // 助手消息自带 turn；若与当前轮不一致就按它对齐，避免串轮。
      if (current === undefined || (typeof turn === 'number' && current.turn !== turn)) {
        const existing = turns.find((t) => t.turn === turn);
        if (existing !== undefined) {
          current = existing;
        } else {
          current = { turn: typeof turn === 'number' ? turn : nextTurn++, user: [], assistant: [] };
          turns.push(current);
        }
      }
      current.assistant.push(texts.join('\n'));
      continue;
    }
  }

  // summary 只留每轮最后一句助手文本；dialog/full 保留全部。
  return turns
    .map((turn) => ({
      turn: turn.turn,
      user: turn.user,
      assistant: mode === 'summary' ? turn.assistant.slice(-1) : turn.assistant,
    }))
    .filter((turn) => turn.user.length > 0 || turn.assistant.length > 0);
}

/**
 * 把抽出的对话渲染成文本，并按字节预算从最新往回截断。
 * @param header 会话头。
 * @param hints 投影信息。
 * @param state 归档/置顶信息。
 * @param turns extractDialog 的结果。
 * @param options 展示选项。
 * @returns 文本。
 */
function renderTranscript(header, hints, state, turns, options) {
  const { mode, turnLimit, fromTurn, toTurn } = options;

  // 先按轮次号切片（分页），再按「最近 N 轮」收窄。
  const range = turns.filter(
    (turn) =>
      (fromTurn === undefined || turn.turn >= fromTurn) &&
      (toTurn === undefined || turn.turn <= toTurn),
  );
  const inRange = range.length === 0 ? turns : range;
  const shown = turnLimit !== undefined && turnLimit > 0 ? inRange.slice(-turnLimit) : inRange;
  const dropped = inRange.length - shown.length;
  const firstTurn = turns[0]?.turn;
  const lastTurn = turns[turns.length - 1]?.turn;
  const rangeNote =
    fromTurn === undefined && toTurn === undefined
      ? ''
      : `（按轮次筛选 ${fromTurn ?? firstTurn}–${toTurn ?? lastTurn}）`;

  const head = [
    `会话：${hints.title ?? '(无标题)'}`,
    `id：${header.id}`,
    `状态：${[state.archived ? '已归档' : '未归档', state.pinned ? '置顶' : ''].filter(Boolean).join('，')}`,
    `对话模式：${mode}（summary=只留每轮最后一句；dialog=保留全部助手文本；full=同上并标注工具调用）`,
    `轮数：共 ${turns.length} 轮（第 ${firstTurn}–${lastTurn} 轮）${rangeNote}${
      dropped > 0 ? `，本区间显示最近 ${shown.length} 轮` : ''
    }`,
    '',
  ];

  const blocks = [];
  for (const turn of shown) {
    const lines = [`── 第 ${turn.turn} 轮 ──`];
    for (const text of turn.user) lines.push(`【用户】${text}`);
    if (turn.assistant.length === 0) lines.push('【助手】（本轮无文本输出）');
    for (const text of turn.assistant) lines.push(`【助手】${text}`);
    blocks.push(lines.join('\n'));
  }

  // 按字节预算从最新往回装，保证最大的会话也不会撑爆上下文。
  const kept = [];
  let bytes = Buffer.byteLength(head.join('\n'), 'utf8');
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const size = Buffer.byteLength(blocks[index] + '\n\n', 'utf8');
    if (bytes + size > TRANSCRIPT_BYTE_BUDGET && kept.length > 0) break;
    bytes += size;
    kept.unshift(blocks[index]);
  }

  const note =
    kept.length < shown.length
      ? `\n（已按 ${Math.round(TRANSCRIPT_BYTE_BUDGET / 1024)} KB 预算截断，仅显示最近 ${kept.length} 轮；要看更早的轮次请调大 turn 或换 summary 模式）`
      : '';
  return head.join('\n') + kept.join('\n\n') + note;
}

/**
 * 读取一个会话的完整对话。
 * @param ctx Host Context。
 * @param record 会话记录。
 * @param args 已校验参数。
 * @returns 文本。
 */
async function readTranscript(ctx, record, args) {
  const mode = MODE_VALUES.includes(args.mode) ? args.mode : 'dialog';
  const query = ctx.get('sessionQuery');
  if (query === undefined || typeof query.readSession !== 'function') {
    return '本部署没有 sessionQuery.readSession，无法读取完整对话。';
  }

  let observed;
  try {
    // readSession 要的是带 `session-` 前缀的完整 id；剥前缀会 SESSION_QUERY_SESSION_NOT_FOUND。
    observed = await query.readSession(publicId(record.header));
  } catch (error) {
    return `读取会话失败：${explainError(error)}`;
  }
  const events = observed?.events ?? [];
  const turns = extractDialog(events, mode);
  if (turns.length === 0) {
    return `会话 ${publicId(record.header)} 里没有可抽取的对话文本（可能是空白会话或纯工具会话）。`;
  }
  const hints = await readHints(ctx, record.header);
  return renderTranscript(
    record.header,
    hints,
    { archived: isArchived(archivedSet(ctx), record.header), pinned: isPinned(pinnedSet(ctx), record.header) },
    turns,
    {
      mode,
      turnLimit: Number.isInteger(args.turn) && args.turn > 0 ? args.turn : undefined,
      fromTurn: Number.isInteger(args.from_turn) && args.from_turn > 0 ? args.from_turn : undefined,
      toTurn: Number.isInteger(args.to_turn) && args.to_turn > 0 ? args.to_turn : undefined,
    },
  );
}

/**
 * 只读主逻辑：无 session_id 列清单，有 session_id 读摘要。
 * @param ctx Host Context。
 * @param args 已校验参数。
 * @param exec 工具执行上下文。
 * @returns 文本结果。
 */
async function executeSession(ctx, args, exec) {
  // 传了 action 就是写操作，进入控制分支；否则是只读浏览。
  if (typeof args.action === 'string' && args.action.length > 0) {
    return executeControl(ctx, args, exec);
  }

  const scope = SCOPE_VALUES.includes(args.scope) ? args.scope : 'active';
  const origin = ORIGIN_VALUES.includes(args.origin) ? args.origin : 'any';
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
  const maxTurns = Number.isInteger(args.max_turns) && args.max_turns > 0 ? args.max_turns : 20;
  const cwd = args.cwd ?? exec.agent?.session?.header?.cwd;

  const archived = archivedSet(ctx);
  const pinned = pinnedSet(ctx);
  const records = await ctx.sessionQuery.listSessions(exec.signal);
  const inWorkspace =
    cwd === undefined ? records : records.filter((record) => record.header.cwd === cwd);

  // ── 指定 session_id：读该会话的完整对话或逐轮摘要 ──────────
  if (typeof args.session_id === 'string' && args.session_id.length > 0) {
    const hit = findRecord(records, args.session_id);
    if (hit === undefined) {
      return `找不到会话 ${args.session_id}。请先不带参数调用本工具列出清单，确认真实的会话 id。`;
    }
    // 传了 mode 或 turn 就是要完整对话；否则保持原来的轻盈摘要。
    if (args.mode !== undefined || args.turn !== undefined || args.from_turn !== undefined || args.to_turn !== undefined) {
      return readTranscript(ctx, hit, args);
    }
    const hints = await readHints(ctx, hit.header);
    return renderDigest(hit.header, hints, {
      archived: isArchived(archived, hit.header),
      pinned: isPinned(pinned, hit.header),
      maxTurns,
    });
  }

  // ── 未指定 session_id：列清单 ────────────────────────────
  const scoped = filterRecords(inWorkspace, { origin, scope, archived });
  const rows = [];
  for (const record of scoped) {
    const header = record.header;
    const hints = await readHints(ctx, header);
    rows.push({
      sessionId: publicId(header),
      createdAt: header.createdAt,
      live: record.live,
      archived: isArchived(archived, header),
      pinned: isPinned(pinned, header),
      origin: header.origin,
      title: hints.title,
      turns: hints.turns,
      time: formatTime(header.createdAt),
    });
  }
  rows.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));

  return renderList(rows, {
    scope,
    limit,
    cwdTotal: inWorkspace.length,
    workspaceTotal: records.length,
  });
}

// ───────────────────────── 写操作（action 分支） ─────────────────────────

/**
 * 读取目标会话最近一条用户消息的来源，用于环路防护。
 *
 * 冷会话不在内存里，只能走 `sessionQuery` 读持久化日志；
 * 会话服务缺失或读取失败时返回 undefined（宁可漏防也不误报）。
 *
 * @param ctx Host Context。
 * @param sessionId 目标会话 id（裸 uuid）。
 * @returns 最近一条用户消息的 source，或 undefined。
 */
async function lastUserMessageSource(ctx, sessionId) {
  const query = ctx.get('sessionQuery');
  if (query === undefined) return undefined;
  try {
    const read = query.readSession ?? query.observeSession ?? query.openSession;
    if (typeof read !== 'function') return undefined;
    const observed = await read.call(query, sessionId);
    if (observed === undefined || observed === null) return undefined;
    const events = observed.events ?? observed.records ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'user/message') continue;
      const source = event.data?.source ?? event.source;
      if (source !== undefined) return source;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * 补发一条 `api-session/added` 事件，让已连上的客户端重读该会话的列表行。
 *
 * 为什么需要：客户端侧栏的标题与状态只通过 `api-session/added` 的
 * `summary.projections` 更新（见 api-session-controller `handleSessionAdded`
 * → `applyListBlock`）。工具在 Host 侧直接调用 `sessionTitle.rename`，
 * 不会走任何前端 RPC，因此不补发就永远看不到新标题，必须刷新页面。
 *
 * @param ctx Host Context。
 * @param header 目标会话头。
 */
function notifySessionAdded(ctx, header) {
  try {
    const controller = ctx.get('sessionController');
    const listState = controller?.listState;
    if (listState === undefined || typeof listState.summaryFor !== 'function') return;
    const session = findSession(ctx, header);
    if (session === undefined) return;
    ctx.emit('api-session/added', listState.summaryFor(session));
  } catch {
    // 通知失败不影响业务结果。
  }
}

/**
 * 把 RemoteError 或任意错误折叠成中文可读文本。
 * @param error 捕获到的错误。
 * @returns 文本。
 */
function explainError(error) {
  const code = error?.code;
  const reason = error?.details?.reason;
  switch (code) {
    case 'session/not-found':
      return '目标会话不存在，或已不在当前数据目录中。请先用本工具不带参数确认真实 id。';
    case 'session/agent-busy':
      return '目标会话由子智能体路由持有，不能用本工具发送；请改用子智能体专用投递。';
    case 'session/model-unavailable':
      return '目标会话当前没有可用模型，先让它选好模型再发。';
    case 'session/writer-held':
      return '目标会话正被另一个写入方持有，稍后重试。';
    case 'session/conflict':
      return '目标会话的工作目录与请求不一致。';
    case 'session/title-invalid':
      return '标题不合法：必须包含可见字符。';
    case 'session/migration-required':
      return '该会话需要先打开一次以完成格式迁移。';
    default:
      return `${code !== undefined ? `[${code}] ` : ''}${error?.message ?? String(error)}${reason !== undefined ? `（${reason}）` : ''}`;
  }
}

/**
 * 发送一条消息到目标会话。
 * @param ctx Host Context。
 * @param record 目标会话记录。
 * @param senderId 发起方会话 id。
 * @param content 正文。
 * @param archived 归档集合。
 * @returns 结果文本。
 */
// AGNX-PATCH(2026-11-16) send 增加 receipt 选项：回执标记 + 来源前缀，目标会话 turn/end 时自动回传
async function controlSend(ctx, record, senderId, content, archived, exec, receipt) {
  const id = publicId(record.header);

  if (record.header.origin === 'subagent') {
    return (
      `拒绝：${id} 是子智能体会话，由 subagent 路由持有，` +
      '给子会话发消息请用 subagent 的 send_message，不要用本工具。'
    );
  }

  if (isArchived(archived, record.header)) {
    return (
      `目标会话 ${id} 已归档。归档会话收到的消息会被 pre-step 静默拒绝（不会有任何效果）。\n` +
      '请先执行 action=unarchive 取消归档，再发消息。'
    );
  }

  // 环路防护：目标最近一条用户消息若来自本会话，说明它在回发，拒绝。
  const last = await lastUserMessageSource(ctx, publicId(record.header));
  if (last !== undefined && senderId !== undefined) {
    const from = last.sessionId ?? last.senderSessionId ?? last.id;
    if (from !== undefined && normalizeId(from) === normalizeId(senderId)) {
      return (
        `拒绝：目标会话 ${id} 最近一条用户消息就是本会话发的，` +
        '继续发会形成 A→B→A 的无限循环。请由用户先给它下一条指令。'
      );
    }
  }

  const controller = ctx.get('sessionController');
  if (controller === undefined) {
    return '本部署没有会话控制器（sessionController），无法发送消息。';
  }

  // 正文前缀：source 是 {kind:'user'}，不标注目标会误以为是用户本人。
  const title = (await readHints(ctx, record.header)).title ?? id;
  // AGNX-PATCH(2026-11-16) receipt=true 时在待回执表登记（目标 id → 发送方 id），正文不带任何机器标记
  if (receipt === true && senderId !== undefined) pendingReceipts.set(normalizeId(id), normalizeId(senderId));
  // AGNX-PATCH(2026-11-16) 标注：正文首行是发送方的 session 引用（渲染为会话标签），标题取发送方
  const senderTitle = senderId === undefined ? undefined : (await readHints(ctx, { id: normalizeId(senderId) })).title;
  const body = `${formatSenderMention(senderId, senderTitle)}\n${content}`;

  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    // 注意：第二个参数 signal 是 Remote 传输层注入的，**不能传 undefined**——
    // 方法体第一行就 signal.throwIfAborted()。这里自备一个不取消的控制器。
    const signal = exec.signal ?? new AbortController().signal;
    await controller.prompt(
      {
        sessionId: id,
        content: [{ type: 'text', text: body }],
        requestId,
        // 运行中插一步读得到上下文；空闲排队并唤醒。
        mode: 'followup',
      },
      signal,
    );
  } catch (error) {
    return `发送失败：${explainError(error)}`;
  }

  return (
    `已投递到会话 ${id}（${title}）。\n` +
    '消息已进入它的下一个回合；它空闲时会自动冷启动并开始处理。'
  );
}

/**
 * 写操作主逻辑（由本工具的 action 参数进入）。
 * @param ctx Host Context。
 * @param args 已校验参数。
 * @param exec 工具执行上下文。
 * @returns 文本结果。
 */
async function executeControl(ctx, args, exec) {
  const action = ACTION_VALUES.includes(args.action) ? args.action : undefined;
  if (action === undefined) {
    return `action 必须是 ${ACTION_VALUES.join(' / ')} 之一。`;
  }

  // create 不需要 session_id；其余动作都需要。
  if (action !== 'create') {
    if (typeof args.session_id !== 'string' || args.session_id.trim().length === 0) {
      return '必须提供 session_id（来自本工具不带参数列出的清单）。';
    }
  }

  // 只有 create 不依赖工作区注册表；其余归档/置顶/改名都依赖。
  if (action !== 'create' && !ctx.get('workspaceRegistry')) {
    return '本部署没有 workspaceRegistry，无法归档或置顶会话。';
  }

  // ── create：先于「查找目标会话」处理，因为目标还不存在 ──────────
  if (action === 'create') {
    const controller = ctx.get('sessionController');
    if (controller === undefined) return '本部署没有会话控制器（sessionController），无法新建会话。';
    const ownCwd = exec.agent?.session?.header?.cwd;
    // 默认落在当前会话的目录；显式传 cwd 才用别的目录。
    const cwd = typeof args.cwd === 'string' && args.cwd.trim().length > 0 ? args.cwd.trim() : ownCwd;
    if (cwd === undefined) return '当前会话没有工作目录，action=create 时必须显式传 cwd。';

    const request = { cwd };
    if (typeof args.agent_preset === 'string' && args.agent_preset.trim().length > 0) {
      request.agentPreset = args.agent_preset.trim();
    }

    // 关键：session.create 只有在传 workspaceId 时才会 attachSession。
    // 只传 cwd 建出来的会话不会进工作区分组，界面上会「消失」。
    // 先按目录解析已有 workspace，有就传 workspaceId，没有再用 cwd。
    const registry = ctx.get('workspaceRegistry');
    let workspace;
    if (registry !== undefined && typeof registry.resolveByPath === 'function') {
      try {
        workspace = await registry.resolveByPath(cwd);
      } catch {
        workspace = undefined;
      }
    }
    const createRequest = workspace !== undefined ? { workspaceId: workspace.id } : { cwd };

    let created;
    try {
      created = await controller.create(createRequest);
    } catch (error) {
      return `新建会话失败：${explainError(error)}`;
    }
    const newId = created?.sessionId;
    if (typeof newId !== 'string' || newId.length === 0) return '新建会话失败：控制器没有返回会话 id。';

    // 兜底：即使走了 cwd 分支，也把会话挂进目录对应的 workspace，保证界面能看到。
    if (workspace === undefined && registry !== undefined && typeof registry.resolveByPath === 'function') {
      try {
        const resolved = await registry.resolveByPath(cwd);
        if (resolved !== undefined && typeof resolved.attachSession === 'function') {
          await resolved.attachSession(newId);
          workspace = resolved;
        }
      } catch {
        // 挂靠失败不阻断建会话，返回里会说明。
      }
    }

    // 同一次调用里顺带命名：create 后会话是 live 的，rename 的前提满足。
    // 用 args.title 或 args.content 都可，content 与 rename 行为保持一致。
    const titleArg =
      typeof args.title === 'string' && args.title.trim().length > 0
        ? args.title.trim()
        : typeof args.content === 'string' && args.content.trim().length > 0
          ? args.content.trim()
          : undefined;
    let titleNote = '';
    let renamedTo;
    if (titleArg !== undefined) {
      try {
        const accepted = await controller.rename({ sessionId: newId, title: titleArg });
        renamedTo = accepted?.title ?? titleArg;
        notifySessionAdded(ctx, { id: newId });
        titleNote = `已命名为「${renamedTo}」。\n`;
      } catch (error) {
        titleNote = `命名失败（会话已建好）：${explainError(error)}\n`;
      }
    }

    const presetNote = created?.agentPreset !== undefined ? `（预设 ${created.agentPreset}）` : '';
    const groupNote =
      workspace !== undefined
        ? `已挂到工作区分组「${workspace.title ?? workspace.path}」。`
        : '注意：该目录还没有工作区分组，会话可能不在侧栏里显示，先在界面打开这个目录一次即可。';
    const blankHint = renamedTo === undefined
      ? '它现在是空白会话，只有被选中时才显示为新会话占位行；发第一条消息（action=send）或点开它之后才会正式进入侧栏。\n'
      : '';
    return (
      `已新建会话 ${newId}${presetNote}，目录 ${cwd}。\n` +
      titleNote +
      blankHint +
      `${groupNote}\n` +
      '它现在是空的，可以用 action=rename 给它起名，用 action=send 让它开始干活。'
    );
  }

  const records = await ctx.sessionQuery.listSessions(exec.signal);
  const record = findRecord(records, args.session_id);
  if (record === undefined) {
    return `找不到会话 ${args.session_id}。请先不带参数调用本工具列出清单，确认真实的会话 id。`;
  }
  const id = publicId(record.header);
  const archived = archivedSet(ctx);
  const pinned = pinnedSet(ctx);
  const senderId = exec.agent?.session?.header?.id;

  // 跨目录发送需要显式 cwd 放行。
  if (action === 'send' && args.cwd === undefined && senderId !== undefined) {
    const ownCwd = exec.agent?.session?.header?.cwd;
    if (ownCwd !== undefined && record.header.cwd !== undefined && record.header.cwd !== ownCwd) {
      return (
        `目标会话在另一个工作目录（${record.header.cwd}），默认不允许跨目录发送。\n` +
        '确实需要的话，显式传 cwd 参数再调一次。'
      );
    }
  }

  switch (action) {
    case 'send': {
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      if (content.length === 0) return 'action=send 时必须提供非空的 content。';
      return controlSend(ctx, record, senderId, content, archived, exec, args.receipt === true);
    }

    case 'rename': {
      const title =
        typeof args.title === 'string' && args.title.trim().length > 0
          ? args.title.trim()
          : typeof args.content === 'string'
            ? args.content.trim()
            : '';
      if (title.length === 0) return 'action=rename 时必须提供非空的 title 或 content 作为新标题。';
      const controller = ctx.get('sessionController');
      if (controller === undefined) return '本部署没有会话控制器（sessionController），无法改名。';
      try {
        const accepted = await controller.rename({ sessionId: id, title });
        // 关键：侧栏标题只靠 api-session/added 事件刷新，rename 本身不触发它。
        // 不补这一下，界面标题要刷新页面才变。
        notifySessionAdded(ctx, record.header);
        return `已把会话 ${id} 重命名为「${accepted?.title ?? title}」。`;
      } catch (error) {
        if (error?.code === 'gateway/internal' && String(error?.message).includes('no session-title service')) {
          return '本部署没有挂载 session-title 服务，无法给会话改名。';
        }
        return `重命名失败：${explainError(error)}`;
      }
    }

    case 'interrupt': {
      const agent = findAgent(ctx, record.header);
      if (agent === undefined) return `会话 ${id} 当前不在线，没有可中断的任务。`;
      if (agent.status !== 'running') return `会话 ${id} 当前空闲，没有可中断的任务。`;
      try {
        agent.cancel({ kind: 'user' }, { keepInbox: true });
      } catch (error) {
        return `中断失败：${explainError(error)}`;
      }
      return `已中断会话 ${id} 当前这一轮；它排队中的消息保留不动。`;
    }

    case 'archive': {
      if (isArchived(archived, record.header)) return `会话 ${id} 已经是归档状态，无需重复归档。`;
      if (args.confirm !== true) {
        const agent = findAgent(ctx, record.header);
        if (agent?.status === 'running') {
          return (
            `会话 ${id} 正在运行。归档会打断它当前的任务（队列中未开始的消息会被丢弃）。\n` +
            '确认要中断并归档的话，带上 confirm=true 重新调用。'
          );
        }
      }
      try {
        await ctx.get('workspaceRegistry').archiveSession(id, { stopActivity: true });
      } catch (error) {
        if (error?.name === 'WorkspaceActiveSessionError') {
          return `无法归档会话 ${id}：它仍有活动（${(error.activity ?? []).map((e) => e.kind).join('、') || '未知'}）。`;
        }
        if (error?.name === 'WorkspaceUnknownSessionError') {
          return `无法归档会话 ${id}：工作区注册表不认识这个会话。`;
        }
        return `归档失败：${explainError(error)}`;
      }
      notifySessionAdded(ctx, record.header);
      return `已归档会话 ${id}。它会从页面可见列表里消失，可用 action=unarchive 恢复。`;
    }

    case 'unarchive': {
      if (!isArchived(archived, record.header)) return `会话 ${id} 本来就没有归档，无需取消归档。`;
      try {
        await ctx.get('workspaceRegistry').unarchiveSession(id);
      } catch (error) {
        return `取消归档失败：${explainError(error)}`;
      }
      notifySessionAdded(ctx, record.header);
      return `已取消归档会话 ${id}，它回到了原来的位置。`;
    }

    case 'pin': {
      if (isArchived(archived, record.header)) return `会话 ${id} 已归档，归档与置顶互斥，先 unarchive 再置顶。`;
      if (isPinned(pinned, record.header)) return `会话 ${id} 已经置顶了。`;
      try {
        await ctx.get('workspaceRegistry').pinSession(id);
      } catch (error) {
        if (error?.name === 'WorkspaceArchivedSessionPinError') {
          return `无法置顶会话 ${id}：它处于归档状态。`;
        }
        return `置顶失败：${explainError(error)}`;
      }
      return `已置顶会话 ${id}，它会排在未置顶会话之前。`;
    }

    case 'unpin': {
      if (!isPinned(pinned, record.header)) return `会话 ${id} 本来就没有置顶，无需取消置顶。`;
      try {
        await ctx.get('workspaceRegistry').unpinSession(id);
      } catch (error) {
        return `取消置顶失败：${explainError(error)}`;
      }
      return `已取消置顶会话 ${id}。`;
    }

    default:
      return `未知 action：${action}。`;
  }
}


// ───────────────────────── 协作专家回执（自动回复） ─────────────────────────

// AGNX-PATCH(2026-11-16) 自动回执模块：目标会话 turn/end 时把该轮最终回复发回发送方
/**
 * 识别方式：send 带 receipt=true 时在待回执表登记（目标 id → 发送方 id），目标 turn/end 完成时取出。
 * 循环防护：同一对会话（无序）只自动回一次（`pairs` 账本），
 * 同一轮只回一次（`delivered` 账本），普通消息不带标记则完全不触发。
 */
// AGNX-PATCH(2026-11-16) 待回执表：目标会话 id -> 发送方会话 id（send receipt=true 时登记，目标 turn/end 完成时取出）
const pendingReceipts = new Map();

/**
 * 一段事件里最后一条助手文本（目标会话该轮的最终回复）。
 * @param events 会话事件。
 * @returns 文本或 undefined。
 */
function lastAssistantText(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'assistant/message') continue;
    const blocks = event?.data?.message?.content ?? [];
    const texts = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0)
      .map((block) => block.text);
    if (texts.length > 0) return texts.join('\n');
  }
  return undefined;
}

/**
 * 监听目标会话 turn/end，自动把最终回复发回发送方。
 * @param ctx Host Context。
 */
// AGNX-PATCH(2026-11-16) 自动回执监听（循环防护：同一对会话只回一次）
function installReceiptRelay(ctx) {
  const delivered = new Set(); // 同一轮只回一次
  const pairs = new Set(); // 同一对会话只自动回一次

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    if (event?.data?.reason?.kind !== 'completed') return; // 只有正常结束才回执

    const header = session?.header;
    if (header === undefined) return;
    const targetId = publicId(header);
    const turn = event?.data?.turn;
    const ticket = `${targetId}#${turn}`;
    if (delivered.has(ticket)) return;
    delivered.add(ticket);

    const events = session.snapshotEvents();
    const key = normalizeId(header.id);
    const senderId = pendingReceipts.get(key);
    if (senderId === undefined) return; // 不是回执请求
    pendingReceipts.delete(key); // 取出即删，同一请求只回一次
    if (normalizeId(senderId) === normalizeId(header.id)) return; // 不能回给自己

    // 循环防护：同一对（无序）只自动回一次。
    const pairKey = [normalizeId(senderId), normalizeId(header.id)].sort().join('<->');
    if (pairs.has(pairKey)) return;
    pairs.add(pairKey);

    const reply = lastAssistantText(events);
    if (reply === undefined) return;

    // AGNX-PATCH(2026-11-16) 归因修正：回执的「来自」应是回复方（本会话），不是原始发送方
    void deliverReceipt(ctx, senderId, targetId, turn, reply).catch((reason) => {
      ctx.logger?.warn?.(`session-hub: receipt relay failed: ${reason?.message ?? reason}`);
    });
  }, 'session-hub: receipt relay');
}

/**
 * 把回执正文投递到发送方会话。
 * @param ctx Host Context。
 * @param senderId 发送方会话 id。
 * @param reply 目标会话该轮的最终回复。
 */
// AGNX-PATCH(2026-11-16) 回执投递：经 agents 句柄按发送方状态注入（idle→followup，running→steer，closing→inject），与子智能体 notifySettlement 同一机制
// AGNX-PATCH(2026-11-16) 归因修正 + id 唯一化：收件人是原始发送方，来源归因是回复方
async function deliverReceipt(ctx, recipientId, replierId, turn, reply) {
  const agents = ctx.get('agents');
  if (agents === undefined) return;
  const agent = agents.get(`session-${normalizeId(recipientId)}`);
  if (agent === undefined || agent === null) return;

  const replier = publicId({ id: normalizeId(replierId) });
  // 正文 + source 同子智能体 createAgentMessage 形态：
  // content 是模型可见 block 数组，source.kind='agent-message' 让目标模型知道不是用户在说话
  const body =
    `【来自另一个会话 · ${replier} · 协作专家回执】\n` +
    reply;
  const content = [
    { type: 'text', text: `Session ${replier} replied (receipt): ` },
    { type: 'text', text: body },
  ];
  const source = { kind: 'agent-message', form: 'relay', senderSessionId: replier };
  // 每次回执唯一 id：回复方 + 轮次，避免同一对会话第二次回执撞 id
  const messageId = `receipt-${replier}-t${turn ?? 'x'}-${Date.now()}`;

  if (agent.status === 'idle') agent.followup({ role: 'user', content, source, id: messageId });
  else if (agent.status === 'running') agent.steer({ role: 'user', content, source, id: messageId });
  else agent.inject({ role: 'user', content, source, id: messageId }); // closing / 其他过渡态：排队不唤醒
}

function findSession(ctx, header) {
  const sessions = ctx.get('sessions');
  if (sessions === undefined || typeof sessions.get !== 'function') return undefined;
  const raw = String(header.id).trim();
  return sessions.get(raw) ?? sessions.get(normalizeId(raw)) ?? sessions.get(`session-${normalizeId(raw)}`);
}

function findAgent(ctx, header) {
  const agents = ctx.get('agents');
  if (agents === undefined || typeof agents.get !== 'function') return undefined;
  const raw = String(header.id).trim();
  return agents.get(raw) ?? agents.get(normalizeId(raw)) ?? agents.get(`session-${normalizeId(raw)}`);
}

function encodeSessionReferenceUri(sessionId) {
  return `dsh-session:${Buffer.from(JSON.stringify(String(sessionId)), 'utf8').toString('base64url')}`;
}

function formatSenderMention(senderId, senderTitle) {
  if (typeof senderId !== 'string' || senderId.length === 0) return '来自另一个会话：';
  // DSH 的 session-reference URI 要求带 `session-` 前缀的完整 id（uri.ts:26-40 规范化校验）。
  const fullId = publicId({ id: normalizeId(senderId) });
  const label = (senderTitle ?? fullId).replace(/[\\\]]/gu, (match) => `\\${match}`);
  return `来自 @[${label}](${encodeSessionReferenceUri(fullId)})：`;
}

// ───────────────────────── 协作专家计数投影 ─────────────────────────

// AGNX-PATCH(2026-11-16) 投影键：双向协作专家（按会话 id 去重，带最近往来时间）
/** 投影键：本会话有过的协作会话（双向，按最近往来时间倒序）。 */
const COLLABORATOR_KEY = 'sessionHubCollaborators';

/**
 * 从一次 `tool/call` 事件里取出 `send` 的目标会话 id。
 *
 * 只认本插件自己的 `session` 工具、且 `action === 'send'`；
 * 其他工具、其他 action、参数解析失败一律返回 undefined（不计入）。
 *
 * @param event 一条会话事件。
 * @returns 目标会话 id，或 undefined。
 */
// AGNX-PATCH(2026-11-16) 双向投影（我发给别人）：从 tool/call 事件取出 send 的目标会话 id
function sendTargetOf(event) {
  if (event?.type !== 'tool/call') return undefined;
  const data = event.data ?? {};
  if (data.name !== 'session') return undefined;
  let args;
  try {
    args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments;
  } catch {
    return undefined;
  }
  if (args?.action !== 'send') return undefined;
  if (typeof args.session_id !== 'string' || args.session_id.length === 0) return undefined;
  return normalizeId(args.session_id);
}

/**
 * 从一条用户消息事件里取出「这次是哪个会话发来的」。
 *
 * 双向记录的另一半：别人 send 给本会话时，正文里带
 * `【来自另一个会话 · <发送方 id> · ...】`，从这一行折出对方 id。
 *
 * @param event 一条会话事件。
 * @returns 发送方会话 id（裸 uuid），或 undefined。
 */
// AGNX-PATCH(2026-11-16) 双向投影（别人发给我）：回执形态，从正文前缀直接取发送方会话 id
// AGNX-PATCH(2026-11-16) 入站识别修复：普通 send 的正文被 DSH 规范化成
// `来自 @<标题>：`（会话引用 URI 在落库前就被剥掉，dsh-session-reference 的
// parseSessionReferenceText 会把 `@[label](uri)` 归一成 `@label`），
// 所以发送方 id 只能从紧随其后的 session-reference 召回消息里取。
function senderOf(event) {
  if (event?.type !== 'user/message') return undefined;
  // 只认真正的工具转发；用户手工输入不算协作往来。
  const source = event?.data?.source ?? {};
  if (source.kind !== 'user') return undefined;
  const blocks = event?.data?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    // 形态一（回执）：【来自另一个会话 · <id> · 标题】。
    const legacy = /【来自另一个会话 · ([^·\s】]+)/.exec(block.text);
    if (legacy === null) continue;
    const raw = legacy[1].trim();
    if (raw.length === 0 || raw === '未知') continue;
    return normalizeId(raw);
  }
  return undefined;
}

/**
 * 判断一条用户消息是否是「别的会话发来的转发」。
 *
 * 普通 send 的正文首行是 `来自 @<发送方标题>：`（URI 已被 DSH 剥掉），
 * 用这个前缀把「插件转发过来的」与「用户自己写的」区分开。
 *
 * @param event 一条会话事件。
 * @returns true 表示疑似入站转发。
 */
function isInboundPrefixed(event) {
  if (event?.type !== 'user/message') return false;
  if ((event?.data?.source ?? {}).kind !== 'user') return false;
  const blocks = event?.data?.content ?? [];
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    if (/^来自 @[^\n]*：/u.test(block.text)) return true;
  }
  return false;
}

/**
 * 读取 session-reference 召回消息里带出的被引用会话 id。
 *
 * @param event 一条会话事件。
 * @returns 会话 id 数组（裸 uuid），没有则空数组。
 */
function referencedSessionIds(event) {
  if (event?.type !== 'user/message') return [];
  const source = event?.data?.source ?? {};
  if (source.kind !== 'session-reference') return [];
  const references = Array.isArray(source.references) ? source.references : [];
  return references
    .map((reference) => reference?.sessionId)
    .filter((id) => typeof id === 'string' && id.length > 0)
    .map((id) => normalizeId(id));
}

/**
 * 一条协作往来记录：对端会话 id + 最近一次往来时间 + 方向。
 * @typedef {{ id: string, at: number, dir: 'out' | 'in' }} CollaboratorEntry
 */

/**
 * 把一条往来并入列表：同 id 只保留一条，时间取最新，按时间倒序。
 *
 * @param state 当前列表。
 * @param id 对端会话 id（裸 uuid）。
 * @param at 事件时间（epoch ms）。
 * @returns 新列表；无变化时返回原引用（投影要求）。
 */
// AGNX-PATCH(2026-11-16) 双向投影：同 id 去重，保留最近往来时间与方向，按时间倒序
function absorbCollaborator(entries, id, at, dir) {
  if (id === undefined) return entries;
  const index = entries.findIndex((entry) => entry.id === id);
  if (index !== -1 && entries[index].at >= at) return entries;
  const entry = { id, at, dir };
  const next = index === -1 ? [...entries, entry] : entries.map((item, i) => (i === index ? entry : item));
  next.sort((left, right) => right.at - left.at);
  return next;
}

/**
 * 注册「协作专家」投影：本会话与哪些会话有过往来（双向）。
 *
 * 放在 Host 侧而不是工具内存里，是因为工具调用是瞬时对象，
 * 只有事件流是持久的——重启后也能从日志重新折算出同样的列表。
 *
 * 记录规则（用户确认的最终规格）：
 *   ① 我发给别人的（tool/call 的 send）记一笔；
 *   ② 别人发给我的（user/message 正文里的来源标注）也记一笔；
 *   ③ 同一会话只留一条，按最近往来时间倒序。
 * 归档与否不在这里判断——归档的会话仍保留在列表里，
 * 由客户端按归档集合打标记，属于展示层的事。
 *
 * @param ctx Host Context。
 */
// AGNX-PATCH(2026-11-16) 注册协作专家投影（stateVersion 2：双向 + 时间戳）
async function registerCollaboratorProjection(ctx) {
  const projections = ctx.get('sessionProjections');
  if (projections === undefined || typeof projections.register !== 'function') return;

  await projections.register({
    key: COLLABORATOR_KEY,
    // AGNX-PATCH(2026-11-16) stateVersion 3：条目新增 dir 字段（'out' | 'in'），
    // 状态容器从数组改成 { entries, pending }（pending 用来跨事件记住
    // 「刚收到一条转发」，等紧随其后的 session-reference 召回消息带来发送方 id）。
    stateVersion: 3,
    // 无 zod 依赖：用最小结构校验器满足 stateSchema 契约。
    stateSchema: {
      parse: (value) => {
        // 兼容两种落库形状：{ entries, pending }（当前）与裸数组（早期 v3 草稿）。
        const raw = Array.isArray(value) ? value : Array.isArray(value?.entries) ? value.entries : [];
        const entries = raw.filter(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            typeof entry.id === 'string' &&
            typeof entry.at === 'number',
        );
        return { entries, pending: value?.pending === true };
      },
    },
    init: () => ({ entries: [], pending: false }),
    apply: (state, event) => {
      const at = typeof event?.time === 'number' ? event.time : Date.now();
      // 出站：本会话调用 session 工具发给别人。
      const target = sendTargetOf(event);
      if (target !== undefined) return { ...state, entries: absorbCollaborator(state.entries, target, at, 'out') };
      // 入站（回执形态）：正文里直接带发送方 id。
      const sender = senderOf(event);
      if (sender !== undefined) return { ...state, entries: absorbCollaborator(state.entries, sender, at, 'in') };
      // 入站（普通 send 形态）：正文被规范化为 `来自 @标题：`，id 要等下一条
      // session-reference 召回消息。
      if (isInboundPrefixed(event)) {
        if (state.pending === true) return state;
        return { ...state, pending: true };
      }
      if (state.pending === true) {
        const referenced = referencedSessionIds(event);
        if (referenced.length > 0) {
          let entries = state.entries;
          for (const id of referenced) entries = absorbCollaborator(entries, id, at, 'in');
          return { entries, pending: false };
        }
        return { ...state, pending: false };
      }
      return state;
    },
    wire: {
      viewSchema: {
        parse: (value) => (Array.isArray(value) ? value : []),
      },
      view: (state) => state.entries,
    },
  });
}

/**
 * 插件入口。
 * @param ctx Host Context。
 */
export function apply(ctx) {
  ctx.effect(async () => {
    await registerCollaboratorProjection(ctx);
  }, 'session-hub: collaborator projection');

  // AGNX-PATCH(2026-11-16) 自动回执监听
  ctx.effect(() => {
    installReceiptRelay(ctx);
    return () => {};
  }, 'session-hub: receipt relay');

  ctx.effect(() =>
    ctx.tools.register({
      name: 'session',
      description:
        'DSH 会话中心：读取会话内容，并按 id 操控其他会话。\n' +
        '【只读】不传 action 时：① 不带 session_id 列出会话清单（标题、轮数、来源、归档/置顶状态、id）；② 传 session_id 返回逐轮摘要；③ 再传 mode 返回该会话的完整对话文本。默认范围是当前工作目录。按关键词搜正文请用 session_search。\n' +
        '【写操作】传 action 时：create（新建会话）、rename（改名，content 为新标题）、send（发消息）、interrupt（中断当前轮）、archive（归档）、unarchive（取消归档）、pin（置顶）、unpin（取消置顶）。\n' +
        '安全约束：不能给子智能体会话发消息；归档会话必须先取消归档才能发；发消息默认只允许同工作目录，跨目录要显式传 cwd；归档正在运行的会话需要 confirm=true；检测到 A→B→A 回环会拒绝。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ACTION_VALUES,
            description:
              '省略 = 只读浏览。传值时执行写操作：create（新建会话，可选 title 一次命名）、rename（改名，content 或 title 作为新标题）、send（发一条消息）、interrupt（中断当前轮，保留队列）、archive（归档）、unarchive（取消归档）、pin（置顶）、unpin（取消置顶）。',
          },
          content: {
            type: 'string',
            description:
              'action=send 时必填：要发给目标会话的正文，会在开头自动标注来源会话；action=rename 时必填：新标题（与 title 等价）。',
          },
          confirm: {
            type: 'boolean',
            description: 'action=archive 且目标正在运行时必须传 true，表示同意打断它的任务。',
          },
          agent_preset: {
            type: 'string',
            description: 'action=create 时可选：新会话使用的 agent 预设，省略则用部署默认预设。',
          },
          title: {
            type: 'string',
            description:
              'action=create 时可选：新会话的标题。填了就在同一次调用里完成「新建 + 命名」，不需要再调一次 rename；与 content 等价，优先用 title。',
          },
          session_id: {
            type: 'string',
            description: '目标会话 id（来自本工具列出的清单）。只读时传它读摘要；写操作时除 create 外必填。',
          },
          scope: {
            type: 'string',
            enum: SCOPE_VALUES,
            description: '范围：active（默认，未归档/页面可见）、archived（已归档）、all（全部）。',
          },
          origin: {
            type: 'string',
            enum: ORIGIN_VALUES,
            description: '来源：any（默认）、user（用户开启的会话）、subagent（子智能体会话）。',
          },
          limit: {
            type: 'integer',
            description: '列清单时最多返回条数。默认 50。',
          },
          max_turns: {
            type: 'integer',
            description: '读摘要（不传 mode）时最多展开多少轮。默认 20。',
          },
          mode: {
            type: 'string',
            enum: MODE_VALUES,
            description:
              '读完整对话的模式，传了它就改读完整对话（而不是两行摘要）：summary=每轮只留用户输入与最后一句助手文本；dialog（推荐）=保留用户输入与全部助手文本；full=同 dialog。工具调用参数、工具结果与协议事件一律丢弃，因此体积通常只剩原文的 1/10 以内。',
          },
          turn: {
            type: 'integer',
            description: '读完整对话时只取最近多少轮。省略则按 100 KB 字节预算自动从最新往回截断。',
          },
          from_turn: {
            type: 'integer',
            description:
              '读完整对话时从第几轮开始（含）。与 to_turn 配合可读取任意中间片段，解决「大会话只能看头或尾」的问题。',
          },
          to_turn: {
            type: 'integer',
            description: '读完整对话时读到第几轮结束（含）。',
          },
          cwd: {
            type: 'string',
            description:
              '限定工作目录；省略时用当前会话的 cwd。发送时跨目录需要显式传才放行；新建时指定新会话的工作目录。',
          },
          // AGNX-PATCH(2026-11-16) 回执选项
          receipt: {
            type: 'boolean',
            description:
              'action=send 时可选：传 true 表示要求对方回执——目标会话这一轮自然结束时，它的最终回复会自动发回本会话。同一对会话只自动回一次（防循环）。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: value }];
        },
      },
      isConcurrencySafe: () => false,
      execute: (args, exec) => executeSession(ctx, args ?? {}, exec),
    }),
  );

}
