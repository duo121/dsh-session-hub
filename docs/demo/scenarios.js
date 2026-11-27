export const releaseNotes = { id: 'session-release-notes', draftTitle: '发布记录', title: 'V1.8 发布记录' };
const regression = { id: 'session-regression', name: 'V1.8 回归测试' };

export function createReleaseState() {
  return { record: null, pinned: false, archived: false, listed: false, read: new Set(), reported: false, test: 'ready' };
}

function command(id, label, prompt, action, args, result, apply) {
  return { id, label, prompt, args: { action, ...args }, result, apply };
}

export function releaseCommands(chapter, release, engineers, tasks, hasDispatches) {
  const make = command;
  if (chapter === 'prepare') {
    if (!release.record) return [make('create', '新建发布记录', `请新建一个叫「${releaseNotes.draftTitle}」的会话。`,
      'create', { title: releaseNotes.draftTitle }, '已新建「发布记录」，可以在工作区找到它。',
      () => { release.record = releaseNotes.draftTitle; })];
    if (release.record !== releaseNotes.title) return [make('rename', '添加版本号', `把「${release.record}」改名为「${releaseNotes.title}」。`,
      'rename', { session_id: releaseNotes.id, content: releaseNotes.title }, `已改名为「${releaseNotes.title}」。`,
      () => { release.record = releaseNotes.title; })];
    if (!release.pinned) return [make('pin', '置顶发布记录', `请置顶「${release.record}」，发布时方便找到。`,
      'pin', { session_id: releaseNotes.id }, '已置顶发布记录。', () => { release.pinned = true; })];
    return [];
  }

  if (chapter === 'summarize') {
    const available = engineers.filter(({ id }) => id !== 'frontend' || !release.archived);
    if (!release.listed) {
      const names = ['项目负责人', ...available.map(({ name }) => name)];
      if (release.record) names.push(release.record);
      return [make('list', '列出会话', '请列出发布工作区的会话。', 'read', {}, names.join('\n'),
        () => { release.listed = true; })];
    }
    available.sort((a, b) => Number(release.read.has(a.id)) - Number(release.read.has(b.id)));
    const options = available.flatMap(({ id, name, request, progress, result }) => {
      const completed = !hasDispatches || tasks[id] === 'done';
      return [false, true].map((dialog) => {
        const modeName = dialog ? '完整对话' : '逐轮摘要';
        const args = { session_id: `session-${id}`, ...(dialog && { mode: 'dialog' }) };
        let output = `${name}尚未完成检查。回执发回后可重新读取。`;
        if (completed) output = dialog
          ? `用户：${request}\n助手：${progress}\n助手：${result}`
          : `问：${request}\n答：${result}`;
        return make(`${id}-${dialog ? 'dialog' : 'digest'}`, `${name} · ${modeName}`,
          `请读取「${name}」的${modeName}。`, 'read', args, output,
          () => { if (completed) release.read.add(id); });
      });
    });
    if (release.read.size === engineers.length && !release.reported) {
      options.unshift(make('report', '汇总发布检查', '请汇总两位工程师的发布检查结果。', null, {},
        `V1.8 发布检查已完成。${engineers.map(({ result }) => result).join('')}`,
        () => { release.reported = true; }));
    }
    return options;
  }

  if (chapter === 'close') {
    const options = [];
    if (release.archived) {
      options.push(make('restore', '恢复前端会话', '还需要查看检查记录，请恢复前端工程师的会话。',
        'unarchive', { session_id: 'session-frontend' }, '已恢复「前端工程师」会话。', () => { release.archived = false; }));
    } else if (!hasDispatches || tasks.frontend === 'done') {
      options.push(make('archive', '归档前端会话', '检查已完成，请归档前端工程师的会话。',
        'archive', { session_id: 'session-frontend' }, '已归档「前端工程师」。对话记录已保留。', () => { release.archived = true; }));
    }
    if (release.pinned) options.push(make('unpin', '取消置顶', `发布已结束，请取消置顶「${release.record}」。`,
      'unpin', { session_id: releaseNotes.id }, '已取消置顶，发布记录仍保留在工作区。', () => { release.pinned = false; }));
    if (release.test === 'ready') options.push(make('start-test', '启动回归测试', '请再跑一次 V1.8 发布页回归测试，并在结束后回执。',
      'send', { session_id: regression.id, receipt: true, content: '请再跑一次 V1.8 发布页回归测试。' },
      '已投递到「V1.8 回归测试」。该测试正在运行。', () => { release.test = 'running'; }));
    if (release.test === 'running') options.unshift(make('interrupt', '中断测试', '请中断「V1.8 回归测试」当前这一轮。',
      'interrupt', { session_id: regression.id }, '已中断回归测试。这一轮没有完成，因此不会产生自动回执。',
      () => { release.test = 'interrupted'; }));
    return options;
  }
  return [];
}
