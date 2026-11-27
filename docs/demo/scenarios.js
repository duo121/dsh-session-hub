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
    {
      kind: 'send', label: '读取并汇总发布检查',
      prompt: '请查看工作区会话，读取前端负责人的逐轮摘要和后端负责人的完整对话，然后汇总本次发布检查。',
      calls: [
        {
          args: { action: 'read' },
          output: engineers.map(({ id, name }) => `${name} · ${toolId(id)} · 已完成检查`).join('\n'),
        },
        ...engineers.map((person, index) => ({
          args: { action: 'read', session_id: toolId(person.id), ...(index ? { mode: 'dialog' } : {}) },
          output: index ? `用户：${person.request}\n助手：${person.progress}\n助手：${person.result}` : `任务：${person.request}\n结果：${person.result}`,
        })),
      ],
      result: `V1.8 发布检查已完成。\n${engineers.map(({ name, result }) => `${name}：${result}`).join('\n')}`,
    },
    command('取消置顶', '检查已汇总，请取消置顶当前会话。',
      { action: 'unpin', session_id: toolId('lead') }, '已取消置顶，发布记录仍保留在工作区。', { pin: false }),
    ...engineers.map(({ id, name }) => command(`归档${name}`, `检查已完成，请归档「${name}」的会话。`,
      { action: 'archive', session_id: toolId(id) }, `已归档「${name}」，对话记录已保留。`, { archive: id })),
    { kind: 'done', label: '再演示一次' },
  ];
}
