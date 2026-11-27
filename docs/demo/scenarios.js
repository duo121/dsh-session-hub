export const engineers = [
  {
    id: 'frontend', name: '前端负责人', duration: 3900,
    request: '请检查新版发布页的加载、空数据和失败重试，完成后告诉我结果。',
    progress: '我检查了慢速网络、空数据和失败重试。',
    result: '加载、空数据和失败重试均已验证，移动端布局正常。',
  },
  {
    id: 'backend', name: '后端负责人', duration: 4600,
    request: '请核对发布状态接口的成功响应和错误码，完成后告诉我联调结果。',
    progress: '我核对了成功、找不到版本和服务暂时不可用三种响应。',
    result: '发布状态接口已联调，成功响应以及 404、503 错误码均符合约定。',
  },
];

const toolId = (id) => `session-${id}`;

function command(label, prompt, args, result, effect) {
  return { kind: 'send', label, prompt, args, result, effect };
}

export function releaseSteps() {
  return [
    { kind: 'new', label: '新建空白会话' },
    command('让 AI 重命名会话', '请把这个空白会话改名为「项目负责人」。',
      { action: 'rename', session_id: 'session-lead', content: '项目负责人' }, '已把当前会话重命名为「项目负责人」。', { rename: '项目负责人' }),
    ...engineers.map(({ id, name }) => command(`创建${name}`, `请新建一个叫「${name}」的会话。`,
      { action: 'create', title: name }, `已创建会话「${name}」。`, { create: id })),
    command('置顶当前会话', '请把这个会话置顶，方便回来看发布进展。',
      { action: 'pin', session_id: toolId('lead') }, '已置顶当前会话。', { pin: true }),
    ...engineers.flatMap((person) => [
      ...(person.id === 'backend' ? [
        { kind: 'send', label: '派发接口检查', prompt: '请先核对旧版发布状态接口的响应。', dispatch: person.id, superseded: true },
        command('中断旧版检查', '刚确认这次发布只验新版接口。请中断后端负责人当前正在跑的旧版检查。',
          { action: 'interrupt', session_id: toolId(person.id) }, '已中断旧版接口检查，这一轮不会发回自动回执。', { interrupt: person.id }),
      ] : []),
      { kind: 'send', label: `派发给${person.name}`, prompt: person.request, dispatch: person.id, pick: person.id === 'frontend' },
      { kind: 'visit', label: `查看${person.name}的任务`, session: person.id },
      { kind: 'return', label: '返回查看回执', session: 'lead', waitFor: person.id },
    ]),
    command('归档已完成的前端会话', '前端检查已完成，先把前端负责人归档。',
      { action: 'archive', session_id: toolId('frontend') }, '已归档「前端负责人」，对话记录已保留。', { archive: 'frontend' }),
    command('恢复前端会话以复核', '汇总前还要核对前端的检查记录，请恢复前端负责人会话。',
      { action: 'unarchive', session_id: toolId('frontend') }, '已恢复「前端负责人」，现在可以读取会话记录。', { unarchive: 'frontend' }),
    command('查看会话清单', '请列出当前工作区的会话，确认两位负责人均已完成任务。',
      { action: 'read' }, '前端负责人、后端负责人均已完成任务。'),
    ...engineers.map((person, index) => command(`读取${person.name}的记录`,
      `请读取「${person.name}」的${index ? '完整对话' : '逐轮摘要'}。`,
      { action: 'read', session_id: toolId(person.id), ...(index ? { mode: 'dialog' } : {}) },
      index ? `用户：${person.request}\n助手：${person.progress}\n助手：${person.result}` : `任务：${person.request}\n结果：${person.result}`)),
    command('汇总发布检查', '请汇总两位负责人的检查结果。', null,
      `V1.8 发布检查已完成。${engineers.map(({ result }) => result).join('')}`),
    { kind: 'view', view: 'trace', label: '查看工具调用轨迹' },
    { kind: 'view', view: 'chat', label: '返回对话收尾' },
    command('取消置顶', '检查已汇总，请取消置顶当前会话。',
      { action: 'unpin', session_id: toolId('lead') }, '已取消置顶，发布记录仍保留在工作区。', { pin: false }),
    ...engineers.map(({ id, name }) => command(`归档${name}`, `检查已完成，请归档「${name}」的会话。`,
      { action: 'archive', session_id: toolId(id) }, `已归档「${name}」，对话记录已保留。`, { archive: id })),
    { kind: 'done', label: '再演示一次' },
  ];
}
