window.__ModuleLoader__.load({
	id: 'dsh-session-hub',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		let react = require('react');
		let react_dom = require('react-dom');
		let react_jsx_runtime = require('react/jsx-runtime');
		// NOTE: 协作专家：复用 DSH primitives 的 IconUsersOutlineRegular 与 StateDot
		let primitives = require('@deepseek-ai/dsh-client-ui-primitives');

		/** 头部插槽名：与 ui-subagent / ui-jobs 注入的是同一个。 */
		const SLOT = 'conversation.session.header.actions';

		/** locale 命名空间。 */
		const NS = 'session-hub';

		/** 投影键：Host 侧 registerCollaboratorProjection 注册的同一字符串。 */
		const KEY = 'sessionHubCollaborators';

		/** 悬停开/收的延时，与 ui-subagent 的 CatalogDropdown 一致。 */
		const HOVER_OPEN_MS = 150;
		const HOVER_CLOSE_MS = 120;
		/** 空的归档集合常量：useSyncExternalStore 要求未变化时返回同一引用。 */
		const EMPTY_IDS = [];

		/** 弹框宽度与视口留白，与 ui-subagent 一致。 */
		const MENU_WIDTH = 336;
		const MENU_VIEWPORT_MARGIN = 16;

		/** 语言词典。 */
		const zh = {
			'collaborators.one': '{count} 个协作专家',
			'collaborators.other': '{count} 个协作专家',
			'tree.aria': '协作专家会话',
			'open.aria': '打开会话：{title}',
			'row.untitled': '(无标题)',
			'activity.running': '正在运行',
			'activity.inactive': '空闲',
			'row.archived': '已归档',
			'row.archivedHint': '该会话已归档，先在侧栏的归档中取消归档再打开。',
			'row.openFailed': '无法打开该会话：它已不存在或不是真实会话 id。',
			// NOTE: UI 增强：最近往来相对时间与方向
			'row.lastExchange': '{value}前',
			'row.lastExchange.now': '刚刚',
			'row.lastExchange.minutes': '{n} 分钟',
			'row.lastExchange.hours': '{n} 小时',
			'row.lastExchange.days': '{n} 天',
			'row.lastExchange.months': '{n} 个月',
			'row.lastExchange.years': '{n} 年',
			'dir.out': '我发出的',
			'dir.in': '我收到的',
		};
		const en = {
			'collaborators.one': '{count} collaborator',
			'collaborators.other': '{count} collaborators',
			'tree.aria': 'Collaborator sessions',
			'open.aria': 'Open session: {title}',
			'row.untitled': '(untitled)',
			'activity.running': 'Running',
			'activity.inactive': 'Idle',
			'row.archived': 'Archived',
			'row.archivedHint': 'This session is archived. Unarchive it from the sidebar first.',
			'row.openFailed': 'Cannot open this session: it no longer exists or is not a real session id.',
			// NOTE: UI 增强：最近往来相对时间与方向
			'row.lastExchange': '{value} ago',
			'row.lastExchange.now': 'just now',
			'row.lastExchange.minutes': '{n} min',
			'row.lastExchange.hours': '{n} h',
			'row.lastExchange.days': '{n} d',
			'row.lastExchange.months': '{n} mo',
			'row.lastExchange.years': '{n} y',
			'dir.out': 'sent',
			'dir.in': 'received',
		};

		const css =
			'.shub_collab{align-items:center;gap:4px;min-height:28px;color:var(--dsw-alias-label-tertiary);display:inline-flex;padding:3px 2px;font-size:12px;line-height:18px}' +
			'.shub_collabIcon{flex:none}' +
			'.shub_root{align-items:center;display:inline-flex;position:relative}' +
			'.shub_trigger{border-radius:var(--dsw-radius-sm);min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}' +
			'.shub_trigger:focus-visible{color:var(--dsw-alias-label-primary)}' +
			'@media (hover:hover){.shub_trigger:hover{color:var(--dsw-alias-label-primary)}}' +
			'.shub_trigger svg{transition:transform .12s}' +
			'.shub_triggerOpen{transform:rotate(180deg)}' +
			'.shub_menu{z-index:100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:336px;max-width:min(400px,100vw - 32px);max-height:min(560px,100vh - 140px);box-shadow:var(--dsw-elevation-prominent);flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}' +
			'.shub_menu:before{content:"";z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);position:absolute;inset:0}' +
			'.shub_menuBody{flex-direction:column;flex:auto;min-height:0;display:flex;overflow:auto}' +
			'.shub_row{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:100%;min-height:44px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;outline:none;align-items:flex-start;gap:6px;padding:6px 7px 6px 9px;font-size:12px;line-height:17px;display:flex;position:relative}' +
			'@media (hover:hover){.shub_row:hover{background:var(--dsw-alias-interactive-bg-hover)}}' +
			'.shub_row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}' +
			'.shub_rowActivity{flex:none;justify-content:center;align-items:center;width:14px;height:17px;display:inline-flex}' +
			'.shub_collabActivity{flex:none;align-items:center;display:inline-flex}' +
			'.shub_rowContent{flex-direction:column;flex:1;min-width:0;display:flex}' +
			'.shub_rowLabel,.shub_rowSecondary{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}' +
			'.shub_rowSecondary{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}' +
			'.shub_notice{color:var(--dsw-alias-label-tertiary);padding:8px 10px;font-size:11px;line-height:16px}';
		const tagId = 'dsh-session-hub/Collaborators.module.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-session-hub';
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/**
		 * 把弹框放在触发器正下方，且不越出视口。
		 * 与 ui-subagent 的 catalogMenuPosition 同一算法。
		 * @param trigger 触发器元素。
		 * @returns 定位样式。
		 */
		// NOTE: 弹框定位：与 ui-subagent catalogMenuPosition 同一算法
		function menuPositionOf(trigger) {
			const rect = trigger.getBoundingClientRect();
			const width = Math.min(MENU_WIDTH, window.innerWidth - MENU_VIEWPORT_MARGIN * 2);
			return {
				top: rect.bottom + 5,
				left: Math.min(
					Math.max(MENU_VIEWPORT_MARGIN, rect.left),
					window.innerWidth - width - MENU_VIEWPORT_MARGIN,
				),
			};
		}

		/**
		 * 协作专家的头部指示：计数 + 悬停列表弹框。
		 *
		 * 交互与 ui-subagent 的 CatalogDropdown 对齐（悬停 150ms 展开、
		 * 离开 120ms 收起、点击固定、Esc 关闭、portal 到 body、窗口
		 * 缩放/滚动时重新定位），列表内容换成 send 过的目标会话。
		 */
		// NOTE: 协作专家头部指示：计数 + 悬停弹框（复刻子智能体 CatalogDropdown 交互）
		function CollaboratorsIndicator(props) {
			const sessionId = props?.sessionId;
			const useSessions = props?.useSessions;
			const t = props?.t;

			const ids = useSessions
				? useSessions((state) => {
						const value = state?.projectionsBySession?.[sessionId]?.values?.[KEY];
						return Array.isArray(value) ? value : undefined;
					})
				: undefined;
			// 归档集合：归档的会话保留在列表里，只打标记，不移除。
			// workspaces.list 暴露 getSnapshot/subscribe，正好是 useSyncExternalStore 的形状。
			const store = props?.workspaces?.list;
			const archivedIds = react.useSyncExternalStore
				? react.useSyncExternalStore(
						store !== undefined && typeof store.subscribe === 'function'
							? (notify) => store.subscribe(notify)
							: () => () => {},
						() =>
							store !== undefined && typeof store.getSnapshot === 'function'
								? (store.getSnapshot().archivedSessionIds ?? [])
								: EMPTY_IDS,
						() => EMPTY_IDS,
					)
				: EMPTY_IDS;

			// 目标会话的标题与运行状态，来自与子智能体同一份会话列表。
			const rows = useSessions
				? useSessions((state) => {
						const list = Array.isArray(ids) ? ids : [];
						return list.map((entry) => {
							const id = typeof entry === 'string' ? entry : entry?.id;
							const summary = state?.byId?.[`session-${id}`] ?? state?.byId?.[id];
							return {
								id,
								title: summary?.title,
								running: summary?.running === true,
								// NOTE: UI 增强：最近往来时间与方向随投影一起取
								at: typeof entry === 'object' && typeof entry?.at === 'number' ? entry.at : undefined,
								dir: typeof entry === 'object' && entry?.dir === 'in' ? 'in' : 'out',
							};
						});
					})
				: undefined;
			// NOTE: 对齐 ui-subagent：任一协作专家运行中时触发器显示转圈
			const runningCount = Array.isArray(rows) ? rows.filter((row) => row.running === true).length : 0;

			const [open, setOpen] = react.useState(false);
			// NOTE: UI 增强：相对时间需要随时间推进重算，用一个低频心跳驱动
			const [now, setNow] = react.useState(() => Date.now());
				// NOTE: 点击已归档行时的提示（DSH 不允许 retain 归档会话，保持既有行为并提示）
		/** 点击已归档行时的提示（DSH 不允许 retain 归档会话）。 */
			const [archivedNotice, setArchivedNotice] = react.useState(false);
			// 打开失败提示：独立于 archivedNotice，因为失败发生在弹框已关闭之后，
			// 不能依赖「重开时被 changeOpen 清掉」的那一套。
			const [openFailedNotice, setOpenFailedNotice] = react.useState(false);
			const [menuPosition, setMenuPosition] = react.useState(undefined);
			const rootRef = react.useRef(null);
			const triggerRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const hoverOpenTimer = react.useRef(undefined);
			const hoverCloseTimer = react.useRef(undefined);
			const pinnedRef = react.useRef(false);

			const cancelHoverClose = () => {
				if (hoverCloseTimer.current === undefined) return;
				clearTimeout(hoverCloseTimer.current);
				hoverCloseTimer.current = undefined;
			};
			const cancelHoverOpen = () => {
				if (hoverOpenTimer.current === undefined) return;
				clearTimeout(hoverOpenTimer.current);
				hoverOpenTimer.current = undefined;
			};
			const changeOpen = (next) => {
				cancelHoverOpen();
				cancelHoverClose();
				if (next) {
					const trigger = triggerRef.current;
					if (trigger === null) return;
					setArchivedNotice(false);
					setOpen(true);
					setMenuPosition(menuPositionOf(trigger));
				} else {
					pinnedRef.current = false;
					setOpen(false);
					setMenuPosition(undefined);
				}
			};
			const scheduleHoverOpen = () => {
				cancelHoverOpen();
				cancelHoverClose();
				if (open) return;
				hoverOpenTimer.current = setTimeout(() => {
					hoverOpenTimer.current = undefined;
					changeOpen(true);
				}, HOVER_OPEN_MS);
			};
			const scheduleHoverClose = () => {
				cancelHoverOpen();
				cancelHoverClose();
				if (pinnedRef.current) return;
				hoverCloseTimer.current = setTimeout(() => {
					hoverCloseTimer.current = undefined;
					changeOpen(false);
				}, HOVER_CLOSE_MS);
			};

			react.useEffect(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (
						event.target instanceof Node &&
						!rootRef.current?.contains(event.target) &&
						!menuRef.current?.contains(event.target)
					) {
						changeOpen(false);
					}
				};
				document.addEventListener('pointerdown', closeOutside);
				return () => document.removeEventListener('pointerdown', closeOutside);
			}, [open]);

			react.useEffect(() => {
				if (!open) return;
				const placeMenu = () => {
					const trigger = triggerRef.current;
					if (trigger === null) return;
					setMenuPosition(menuPositionOf(trigger));
				};
				window.addEventListener('resize', placeMenu);
				document.addEventListener('scroll', placeMenu, true);
				return () => {
					window.removeEventListener('resize', placeMenu);
					document.removeEventListener('scroll', placeMenu, true);
				};
			}, [open]);

			react.useEffect(
				() => () => {
					cancelHoverOpen();
					cancelHoverClose();
				},
				[],
			);

			// NOTE: UI 增强：菜单打开时每 15 秒重算一次相对时间
			react.useEffect(() => {
				if (!open) return;
				const timer = setInterval(() => setNow(Date.now()), 15000);
				return () => clearInterval(timer);
			}, [open]);

			// 打开失败提示：4 秒后自动消失，避免长期占据界面。
			react.useEffect(() => {
				if (!openFailedNotice) return;
				const timer = setTimeout(() => setOpenFailedNotice(false), 4000);
				return () => clearTimeout(timer);
			}, [openFailedNotice]);

			if (!Array.isArray(ids) || ids.length === 0) return null;

			// NOTE: UI 增强：兜底分支补上新 key，缺 t 时也不会显示错文案
			const FALLBACK = {
				'collaborators.one': `${ids.length} 个协作专家`,
				'collaborators.other': `${ids.length} 个协作专家`,
				'tree.aria': '协作专家会话',
				'row.untitled': '(无标题)',
				'activity.running': '正在运行',
				'activity.inactive': '空闲',
				'row.archived': '已归档',
				'row.openFailed': '无法打开该会话：它已不存在或不是真实会话 id。',
				'row.lastExchange': '{value}前',
				'row.lastExchange.now': '刚刚',
				'row.lastExchange.minutes': '{n} 分钟',
				'row.lastExchange.hours': '{n} 小时',
				'row.lastExchange.days': '{n} 天',
				'row.lastExchange.months': '{n} 个月',
				'row.lastExchange.years': '{n} 年',
				'dir.out': '我发出的',
				'dir.in': '我收到的',
			};
			const tr = (key, vars) => {
				if (typeof t === 'function') return t(key, vars);
				const template = FALLBACK[key] ?? key;
				if (vars === undefined) return template;
				return template.replace(/\{(\w+)\}/gu, (whole, name) =>
					vars[name] === undefined ? whole : String(vars[name]),
				);
			};
			const countText = tr(ids.length === 1 ? 'collaborators.one' : 'collaborators.other', {
				count: ids.length,
			});

			// NOTE: UI 增强：最近往来相对时间，复用 primitives.relativeTime 的分桶
			const lastExchangeLabel = (at) => {
				const { unit, n } = primitives.relativeTime(at, now);
				if (unit === 'now') return tr('row.lastExchange.now');
				return tr('row.lastExchange', { value: tr(`row.lastExchange.${unit}`, { n }) });
			};

			// NOTE: 归档会话保留在列表里并标「已归档」；id 前缀归一化后再比
			// 归档集合里的 id 带 `session-` 前缀，而列表行是裸 uuid，统一去前缀再比。
			const archived = new Set(
				(Array.isArray(archivedIds) ? archivedIds : []).map((id) =>
					String(id).startsWith('session-') ? String(id).slice('session-'.length) : String(id),
				),
			);

			const openSession = (id) => {
				// 先关弹框再跳转：openSession 会 retain 会话引用，
				// 若在弹框卸载的同一轮渲染里 retain，引用会被随后的释放踩掉
				// （实测报 "Session reference ... is released"）。
				changeOpen(false);
				queueMicrotask(() => {
					try {
						props?.uiWorkspace?.openSession?.(`session-${id}`);
					} catch {
						// 打开失败不再静默：早先这里空吞异常，点到不存在的会话
						// （例如旧版投影写进来的占位符条目）时「点了没反应」，
						// 用户无法分辨是没点到还是坏了。现在给出可见提示。
						setOpenFailedNotice(true);
					}
				});
			};

			/**
			 * 归档会话的点击：DSH 的 Session 引用对已归档会话不可 retain
			 * （dsh-api-session-controller/lib/client.js:3775 `is released`），
			 * 侧栏本身也不显示归档会话。这里不静默失败，改为提示用户。
			 */
			const activateRow = (row) => {
				if (archived.has(row.id)) {
					setArchivedNotice(true);
					return;
				}
				openSession(row.id);
			};

			return react_jsx_runtime.jsxs('div', {
				className: 'shub_root',
				ref: rootRef,
				onPointerLeave: scheduleHoverClose,
				'data-session-hub-collaborators': ids.length,
				children: [
					react_jsx_runtime.jsxs('button', {
						ref: triggerRef,
						type: 'button',
						className: 'shub_trigger',
						'aria-haspopup': 'tree',
						'aria-expanded': open,
						'aria-label': countText,
						title: countText,
						onPointerEnter: (event) => {
							if (event.pointerType !== 'touch') scheduleHoverOpen();
						},
						onClick: () => {
							cancelHoverOpen();
							cancelHoverClose();
							pinnedRef.current = true;
							if (!open) changeOpen(true);
						},
						onKeyDown: (event) => {
							// NOTE: 对齐 ui-subagent：ArrowDown 打开并聚焦首行
							if (event.key === 'ArrowDown') {
								event.preventDefault();
								cancelHoverOpen();
								cancelHoverClose();
								if (!open) changeOpen(true);
								queueMicrotask(() => {
									const first = menuRef.current?.querySelector('[data-session-hub-row]');
									first?.focus();
								});
								return;
							}
							if (event.key !== 'Escape') return;
							if (!open) return;
							event.preventDefault();
							changeOpen(false);
							queueMicrotask(() => triggerRef.current?.focus());
						},
						children: [
							// NOTE: 对齐 ui-subagent / ui-jobs：头部前置位是「活动指示器」，
							// 运行中显示转圈、空闲显示协作图标，二者互斥不并列。
							runningCount > 0
								? react_jsx_runtime.jsx('span', {
									className: 'shub_collabActivity',
									children: react_jsx_runtime.jsx(primitives.StateDot, { state: 'ongoing' }),
								})
								: react_jsx_runtime.jsx(primitives.IconUsersOutlineRegular, {
									size: 14,
									className: 'shub_collabIcon',
								}),
							react_jsx_runtime.jsx('span', { children: countText }),
							react_jsx_runtime.jsx(primitives.IconChevronDownOutlineRegular, {
								className: open ? 'shub_triggerOpen' : undefined,
							}),
						],
					}),
					open &&
						react_dom.createPortal(
							react_jsx_runtime.jsxs('div', {
								ref: menuRef,
								className: 'shub_menu',
								style: menuPosition,
								'data-session-hub-menu': '',
								onPointerEnter: (event) => {
									if (event.pointerType !== 'touch') cancelHoverClose();
								},
								onPointerLeave: scheduleHoverClose,
								children: [
									react_jsx_runtime.jsx('div', {
										className: 'shub_menuBody',
										role: 'tree',
										'aria-label': tr('tree.aria'),
										children:
											rows.length === 0
												? react_jsx_runtime.jsx('div', {
														className: 'shub_notice',
														children: tr('row.untitled'),
													})
												: rows.map((row) =>
														react_jsx_runtime.jsxs(
															'button',
															{
																type: 'button',
																role: 'treeitem',
																tabIndex: 0,
																className: 'shub_row',
																'data-session-hub-row': row.id,
																'aria-label': tr('open.aria', {
																	title: row.title ?? row.id,
																}),
																onClick: () => activateRow(row),
																children: [
																	react_jsx_runtime.jsx('span', {
																		className: 'shub_rowActivity',
																		// 与子智能体同一个状态点：运行中是 ongoing（转圈）。
																		children: react_jsx_runtime.jsx(primitives.StateDot, {
																			state: row.running ? 'ongoing' : 'idle',
																		}),
																	}),
																	react_jsx_runtime.jsxs('span', {
																		className: 'shub_rowContent',
																		children: [
																			react_jsx_runtime.jsx('span', {
																				className: 'shub_rowLabel',
																				// NOTE: UI 增强：方向字符前缀（→ 我发出的 / ← 我收到的）
																				children: `${row.dir === 'in' ? '\u2190 ' : '\u2192 '}${row.title ?? tr('row.untitled')}`,
																			}),
																			react_jsx_runtime.jsx('span', {
																				className: 'shub_rowSecondary',
																				// NOTE: UI 增强：<相对时间> · <方向> · <状态> ·（已归档时）已归档
																				children: [
																					row.at === undefined ? '' : `${lastExchangeLabel(row.at)} · `,
																					`${tr(row.dir === 'in' ? 'dir.in' : 'dir.out')} · `,
																					row.running ? tr('activity.running') : tr('activity.inactive'),
																					archived.has(row.id) ? ` · ${tr('row.archived')}` : '',
																				].join(''),
																			}),
																		],
																	}),
																],
															},
															row.id,
														),
													),
									}),
									archivedNotice &&
										react_jsx_runtime.jsx('div', {
											className: 'shub_notice',
											'data-session-hub-archived-hint': '',
											children: tr('row.archivedHint'),
										}),
								],
							}),
							document.body,
						),
					// 打开失败提示：弹框此时已关闭，因此挂在根节点上单独成层，
					// 复用同一个触发器定位算法，让提示就地出现在头部指示器下方。
					openFailedNotice &&
						react_dom.createPortal(
							react_jsx_runtime.jsx('div', {
								className: 'shub_menu',
								style: menuPositionOf(triggerRef.current ?? rootRef.current),
								'data-session-hub-open-failed': '',
								children: react_jsx_runtime.jsx('div', {
									className: 'shub_notice',
									children: tr('row.openFailed'),
								}),
							}),
							document.body,
						),
				],
			});
		}

		/**
		 * 注册会话头部插槽。
		 *
		 * 必须走 `slots.inject`：`conversation.session.header.actions` 由
		 * ui-conversation 在自己的插槽声明里以 children 表声明，插件直接
		 * `slots.register` 会在声明尚不存在时抛
		 * 「slot ... is not declared」，整个客户端插件激活失败。
		 *
		 * @param ctx Client Cordis context。
		 */
		// NOTE: 注册协作专家头部插槽与 locale
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-hub: dictionaries');
			ctx.slots.inject(SLOT, () =>
				ctx.slots.register(
					{
						name: SLOT,
						id: 'session-hub-collaborators',
						order: 30,
						locale: NS,
						// uiWorkspace / workspaces 都是可选服务：缺了也不该让整个插件启动失败。
						inject: () => ({
							uiWorkspace: ctx.get('uiWorkspace'),
							workspaces: ctx.get('workspaces'),
						}),
					},
					CollaboratorsIndicator,
				),
			);
		}

		exports.apply = apply;
		// 服务名，不是包名：slots 提供 inject/register，locale 提供 register。
		exports.inject = ['slots', 'locale'];
		return module.exports;
	},
});
