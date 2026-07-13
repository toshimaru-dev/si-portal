import { HostToWebviewMessage, WebviewToHostMessage } from '../protocol';
import {
  DailyHoursRow,
  Goal,
  GoalsFile,
  HoursDailyFile,
  HoursFile,
  HoursRow,
  Phase,
  Project,
  ProjectsFile,
  ProjectStatus,
  Task,
  TaskStatus,
} from '../data/types';
import { ImportPreviewEvent, ImportResult } from '../data/outlookImport';
import { genId } from '../data/id';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type TabId = 'dashboard' | 'projects' | 'monthly' | 'goals';
type ProjectFilter = 'all' | 'active' | 'onhold' | 'closed';
type GoalFilter = 'all' | 'half' | 'full';

interface UiState {
  tab: TabId;
  projectFilter: ProjectFilter;
  selectedProjectId: string | undefined;
  hoursMonth: string;
  goalFilter: GoalFilter;
  goalCategoryFilter: string;
}

type PendingDelete =
  | { kind: 'project'; projectId: string }
  | { kind: 'phase'; projectId: string; phaseId: string }
  | { kind: 'task'; projectId: string; phaseId: string; taskId: string };

interface State extends UiState {
  projects: ProjectsFile | undefined;
  hours: HoursFile | undefined;
  hoursDaily: HoursDailyFile | undefined;
  goals: GoalsFile | undefined;
  errorMessage: string | undefined;
  showManualForm: boolean;
  importStep: 0 | 1 | 2 | 3;
  importPreview: ImportResult | undefined;
  learnFlags: Record<string, boolean>;
  clientDraft: Record<string, string>;
  showAddProjectForm: boolean;
  showAddPhaseForm: boolean;
  addTaskFormPhaseId: string | undefined;
  editingTaskId: string | undefined;
  pendingDelete: PendingDelete | undefined;
  selectedCalendarDate: string | undefined;
  manualFormClient: string;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [yearText, monthText] = yearMonth.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const persisted = (vscode.getState() as Partial<UiState> | undefined) ?? {};

const state: State = {
  tab: persisted.tab ?? 'dashboard',
  projectFilter: persisted.projectFilter ?? 'all',
  selectedProjectId: persisted.selectedProjectId,
  hoursMonth: persisted.hoursMonth ?? currentMonth(),
  goalFilter: persisted.goalFilter ?? 'all',
  goalCategoryFilter: persisted.goalCategoryFilter ?? 'all',
  projects: undefined,
  hours: undefined,
  hoursDaily: undefined,
  goals: undefined,
  errorMessage: undefined,
  showManualForm: false,
  importStep: 0,
  importPreview: undefined,
  learnFlags: {},
  clientDraft: {},
  showAddProjectForm: false,
  showAddPhaseForm: false,
  addTaskFormPhaseId: undefined,
  editingTaskId: undefined,
  pendingDelete: undefined,
  selectedCalendarDate: undefined,
  manualFormClient: '',
};

function persistUiState(): void {
  const uiState: UiState = {
    tab: state.tab,
    projectFilter: state.projectFilter,
    selectedProjectId: state.selectedProjectId,
    hoursMonth: state.hoursMonth,
    goalFilter: state.goalFilter,
    goalCategoryFilter: state.goalCategoryFilter,
  };
  vscode.setState(uiState);
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'projects', label: '案件' },
  { id: 'monthly', label: '月次' },
  { id: 'goals', label: '目標' },
];

const PROJECT_FILTERS: { id: ProjectFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'active', label: '進行中' },
  { id: 'onhold', label: '保留' },
  { id: 'closed', label: '終了' },
];

const GOAL_FILTERS: { id: GoalFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'half', label: '半期' },
  { id: 'full', label: '通期' },
];

const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'done'];
const BAR_COLORS = [
  'var(--vscode-charts-blue, #4a9eff)',
  'var(--vscode-charts-green, #5ec48a)',
  'var(--vscode-charts-purple, #a98ede)',
  'var(--vscode-charts-orange, #c9915e)',
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(renderTabBar());

  const content = el('div', 'content');
  if (state.errorMessage) {
    content.appendChild(renderPlaceholder('エラー', state.errorMessage));
  } else if (state.tab === 'dashboard') {
    content.appendChild(renderDashboard());
  } else if (state.tab === 'projects') {
    content.appendChild(renderProjectsScreen());
  } else if (state.tab === 'monthly') {
    content.appendChild(renderMonthlyScreen());
  } else {
    content.appendChild(renderGoalsScreen());
  }
  root.appendChild(content);
}

function renderTabBar(): HTMLElement {
  const bar = el('div', 'tabbar');
  bar.appendChild(el('div', 'tabbar-title', '仕事ポータル'));
  for (const tab of TABS) {
    const button = el('button', 'tab-button' + (state.tab === tab.id ? ' active' : ''), tab.label);
    button.addEventListener('click', () => {
      state.tab = tab.id;
      persistUiState();
      render();
    });
    bar.appendChild(button);
  }
  return bar;
}

function renderPlaceholder(title: string, message: string): HTMLElement {
  const box = el('div', 'placeholder');
  box.appendChild(el('div', 'placeholder-title', title));
  box.appendChild(el('div', undefined, message));
  return box;
}

function goToTab(tab: TabId): void {
  state.tab = tab;
  persistUiState();
  render();
}

function renderBreakdownList(
  items: { name: string; client: string; hours: number }[],
  options: { showClient?: boolean } = {},
): HTMLElement {
  const wrap = el('div');
  const maxHours = Math.max(...items.map((i) => i.hours), 0.0001);
  items.forEach((item, index) => {
    const row = el('div', 'breakdown-row');
    const labelRow = el('div', 'breakdown-label-row');
    const nameCell = el('span', 'breakdown-name');
    nameCell.appendChild(document.createTextNode(item.name));
    if (options.showClient && item.client) {
      nameCell.appendChild(el('span', 'breakdown-client', ` ・ ${item.client}`));
    }
    labelRow.appendChild(nameCell);
    labelRow.appendChild(el('span', 'breakdown-hours mono', `${item.hours.toFixed(1)}h`));
    row.appendChild(labelRow);

    const track = el('div', 'breakdown-track');
    const fill = el('div', 'breakdown-fill');
    fill.style.width = `${((item.hours / maxHours) * 100).toFixed(0)}%`;
    fill.style.background = BAR_COLORS[index % BAR_COLORS.length];
    track.appendChild(fill);
    row.appendChild(track);
    wrap.appendChild(row);
  });
  return wrap;
}

// ===================== ダッシュボード =====================

function renderDashboard(): HTMLElement {
  const wrap = el('div');
  const header = el('div', 'page-header');
  const headerLeft = el('div');
  headerLeft.appendChild(el('div', 'page-title', 'ダッシュボード'));
  headerLeft.appendChild(el('div', 'page-subtitle', '3機能の横断サマリ'));
  header.appendChild(headerLeft);
  wrap.appendChild(header);

  wrap.appendChild(renderTodayCard());

  const grid = el('div', 'dashboard-grid');
  grid.appendChild(renderProjectsCard());
  const sideCol = el('div', 'dashboard-side-col');
  sideCol.appendChild(renderMonthlyCard());
  sideCol.appendChild(renderGoalsCard());
  grid.appendChild(sideCol);
  wrap.appendChild(grid);
  return wrap;
}

function renderTodayCard(): HTMLElement {
  const projects = state.projects?.projects ?? [];
  const today = todayString();
  const allUrgent = collectUrgentTasks(projects);
  const overdueTasks = allUrgent.filter((i) => i.overdue);
  const todayTasks = allUrgent.filter((i) => !i.overdue && i.task.due === today);

  const card = el('div', 'card card-today');
  const header = el('div', 'card-header');
  header.appendChild(el('div', 'card-label', '期限切れ・本日対応タスク'));
  header.appendChild(el('span', 'today-date mono', today));
  card.appendChild(header);

  if (state.projects === undefined) {
    card.appendChild(el('div', 'empty-state', '読み込み中...'));
  } else if (overdueTasks.length === 0 && todayTasks.length === 0) {
    card.appendChild(el('div', 'empty-state', '対応が必要なタスクはありません。'));
  } else {
    card.appendChild(renderDueTaskGroup('期限切れ', overdueTasks));
    card.appendChild(renderDueTaskGroup('本日期日', todayTasks));
  }
  return card;
}

function renderDueTaskGroup(label: string, items: UrgentTaskItem[]): HTMLElement {
  const group = el('div', 'due-task-group');
  const groupHeader = el('div', 'due-task-group-header');
  groupHeader.appendChild(el('span', undefined, label));
  groupHeader.appendChild(el('span', 'mono', String(items.length)));
  group.appendChild(groupHeader);

  if (items.length === 0) {
    group.appendChild(el('div', 'empty-state', 'なし'));
  } else {
    for (const item of items) {
      group.appendChild(renderUrgentTaskRow(item));
    }
  }
  return group;
}

function renderProjectsCard(): HTMLElement {
  const projects = state.projects?.projects ?? [];
  const activeCount = projects.filter((p) => p.status === 'active').length;
  const today = todayString();
  const upcoming = collectUrgentTasks(projects)
    .filter((i) => !i.overdue && i.task.due !== today)
    .slice(0, 8);

  const card = el('div', 'card card-emphasis');
  const header = el('div', 'card-header');
  header.appendChild(el('div', 'card-label', '案件'));
  const link = el('button', 'card-link', '案件へ →');
  link.addEventListener('click', () => goToTab('projects'));
  header.appendChild(link);
  card.appendChild(header);

  const kpi = el('div', 'kpi-row');
  kpi.appendChild(el('span', 'kpi-number mono', String(activeCount)));
  kpi.appendChild(el('span', 'kpi-unit', '進行中案件'));
  card.appendChild(kpi);

  card.appendChild(el('div', 'section-label section-label-divider', '今後のタスク'));
  if (state.projects === undefined) {
    card.appendChild(el('div', 'empty-state', '読み込み中...'));
  } else if (upcoming.length === 0) {
    card.appendChild(el('div', 'empty-state', '今後のタスクはありません。'));
  } else {
    const list = el('div');
    for (const item of upcoming) {
      list.appendChild(renderUrgentTaskRow(item));
    }
    card.appendChild(list);
  }
  return card;
}

function goToProjectDetail(projectId: string): void {
  state.tab = 'projects';
  state.selectedProjectId = projectId;
  state.showAddPhaseForm = false;
  state.addTaskFormPhaseId = undefined;
  state.pendingDelete = undefined;
  persistUiState();
  render();
}

function renderMonthlyCard(): HTMLElement {
  const card = el('div', 'card');
  const header = el('div', 'card-header');
  header.appendChild(el('div', 'card-label', '月次'));
  const link = el('button', 'card-link', '月次へ →');
  link.addEventListener('click', () => goToTab('monthly'));
  header.appendChild(link);
  card.appendChild(header);

  const month = currentMonth();
  const rows = (state.hours?.rows ?? []).filter((r) => r.yearMonth === month);
  const total = rows.reduce((sum, r) => sum + r.hours, 0);

  const kpi = el('div', 'kpi-row');
  kpi.appendChild(el('span', 'kpi-number mono', total.toFixed(1)));
  kpi.appendChild(el('span', 'kpi-unit', 'h / 今月'));
  card.appendChild(kpi);

  card.appendChild(el('div', 'section-label', '案件別内訳'));
  if (state.hours === undefined) {
    card.appendChild(el('div', 'empty-state', '読み込み中...'));
  } else if (rows.length === 0) {
    card.appendChild(el('div', 'empty-state', '今月の工数データはまだありません。'));
  } else {
    card.appendChild(renderBreakdownList(aggregateByProject(rows)));
  }
  return card;
}

function renderGoalsCard(): HTMLElement {
  const card = el('div', 'card');
  const header = el('div', 'card-header');
  header.appendChild(el('div', 'card-label', '目標'));
  const link = el('button', 'card-link', '目標へ →');
  link.addEventListener('click', () => goToTab('goals'));
  header.appendChild(link);
  card.appendChild(header);

  const goals = state.goals?.goals ?? [];
  const avg = goals.length > 0 ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length) : 0;

  const kpi = el('div', 'kpi-row');
  kpi.appendChild(el('span', 'kpi-number mono', String(avg)));
  kpi.appendChild(el('span', 'kpi-unit', '% 平均進捗'));
  card.appendChild(kpi);

  if (state.goals === undefined) {
    card.appendChild(el('div', 'empty-state', '読み込み中...'));
  } else if (goals.length === 0) {
    card.appendChild(el('div', 'empty-state', '目標が登録されていません。'));
  } else {
    const list = el('div');
    for (const goal of goals.slice(0, 3)) {
      const row = el('div', 'breakdown-row');
      const labelRow = el('div', 'breakdown-label-row');
      labelRow.appendChild(el('span', 'breakdown-name', goal.title));
      labelRow.appendChild(el('span', 'breakdown-hours mono', `${goal.progress}%`));
      row.appendChild(labelRow);
      const track = el('div', 'breakdown-track');
      const fill = el('div', 'breakdown-fill');
      fill.style.width = `${goal.progress}%`;
      fill.style.background = 'var(--vscode-charts-blue, #4a9eff)';
      track.appendChild(fill);
      row.appendChild(track);
      list.appendChild(row);
    }
    card.appendChild(list);
  }
  return card;
}

interface UrgentTaskItem {
  task: Task;
  projectId: string;
  projectName: string;
  overdue: boolean;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function collectUrgentTasks(projects: Project[]): UrgentTaskItem[] {
  const today = todayString();
  const items: UrgentTaskItem[] = [];
  for (const project of projects) {
    for (const phase of project.phases) {
      for (const task of phase.tasks) {
        if (task.status === 'done') continue;
        items.push({
          task,
          projectId: project.id,
          projectName: project.name,
          overdue: !!task.due && task.due < today,
        });
      }
    }
  }
  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.task.due.localeCompare(b.task.due);
  });
  return items;
}

function renderUrgentTaskRow(item: UrgentTaskItem): HTMLElement {
  const row = el('div', 'task-row task-row-clickable' + (item.overdue ? ' task-row-overdue' : ''));
  row.appendChild(el('span', `badge badge-${item.task.status}`, item.task.status));

  const main = el('div', 'task-main');
  main.appendChild(el('div', 'task-title', item.task.title));
  main.appendChild(el('div', 'task-proj', item.projectName));
  row.appendChild(main);

  row.appendChild(el('span', 'task-due mono' + (item.overdue ? ' overdue' : ''), item.task.due));
  row.addEventListener('click', () => goToProjectDetail(item.projectId));
  return row;
}

// ===================== 案件管理 =====================

const PROJECT_DOT_CLASS: Record<ProjectStatus, string> = {
  active: 'project-dot-active',
  onhold: 'project-dot-onhold',
  closed: 'project-dot-closed',
};

const DEFAULT_PHASE_NAMES = ['要件定義', '設計', '実装', 'テスト'];

function renderProjectsScreen(): HTMLElement {
  const wrap = el('div');
  const header = el('div', 'page-header');
  const headerLeft = el('div');
  headerLeft.appendChild(el('div', 'page-title', '案件管理'));
  headerLeft.appendChild(
    el('div', 'page-subtitle', 'フェーズ × タスクのカンバン。カードをクリックで状態を更新。'),
  );
  header.appendChild(headerLeft);
  const editButton = el('button', 'edit-button', 'Markdownを編集 ↗');
  editButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFile', domain: 'projects' });
  });
  header.appendChild(editButton);
  wrap.appendChild(header);

  const allProjects = state.projects?.projects ?? [];
  const filtered = allProjects.filter((p) => state.projectFilter === 'all' || p.status === state.projectFilter);

  const layout = el('div', 'projects-layout');
  layout.appendChild(renderProjectList(filtered));

  if (allProjects.length === 0) {
    layout.appendChild(
      renderPlaceholder('案件がありません', '左の「+ 新規案件」から追加するか、「Markdownを編集」でも作成できます。'),
    );
    wrap.appendChild(layout);
    return wrap;
  }

  if (!state.selectedProjectId || !filtered.some((p) => p.id === state.selectedProjectId)) {
    state.selectedProjectId = filtered[0]?.id;
    persistUiState();
  }

  const selected = filtered.find((p) => p.id === state.selectedProjectId);
  if (selected) {
    layout.appendChild(renderKanban(selected));
    layout.appendChild(renderProjectInfoCard(selected));
  } else {
    layout.appendChild(renderPlaceholder('該当する案件がありません', 'フィルタ条件を変更してください。'));
  }
  wrap.appendChild(layout);
  return wrap;
}

function selectProject(projectId: string): void {
  state.selectedProjectId = projectId;
  state.showAddPhaseForm = false;
  state.addTaskFormPhaseId = undefined;
  state.pendingDelete = undefined;
  persistUiState();
  render();
}

function renderConfirmBar(message: string, onConfirm: () => void, onCancel: () => void): HTMLElement {
  const bar = el('div', 'confirm-bar');
  bar.appendChild(el('span', 'confirm-bar-message', message));
  const actions = el('div', 'confirm-bar-actions');
  const confirmBtn = el('button', 'confirm-bar-confirm', '削除する');
  confirmBtn.addEventListener('click', onConfirm);
  const cancelBtn = el('button', 'confirm-bar-cancel', 'キャンセル');
  cancelBtn.addEventListener('click', onCancel);
  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  bar.appendChild(actions);
  return bar;
}

function renderProjectList(projects: Project[]): HTMLElement {
  const panel = el('div', 'project-panel');

  const pills = el('div', 'filter-pills');
  for (const filter of PROJECT_FILTERS) {
    const pill = el(
      'button',
      'filter-pill' + (state.projectFilter === filter.id ? ' active' : ''),
      filter.label,
    );
    pill.addEventListener('click', () => {
      state.projectFilter = filter.id;
      persistUiState();
      render();
    });
    pills.appendChild(pill);
  }
  panel.appendChild(pills);

  const list = el('div', 'project-list');
  for (const project of projects) {
    const pending = state.pendingDelete;
    if (pending?.kind === 'project' && pending.projectId === project.id) {
      const phaseCount = project.phases.length;
      const taskCount = project.phases.reduce((s, ph) => s + ph.tasks.length, 0);
      list.appendChild(
        renderConfirmBar(
          `「${project.name}」を削除（フェーズ${phaseCount}件・タスク${taskCount}件も削除）`,
          () => deleteProject(project.id),
          () => {
            state.pendingDelete = undefined;
            render();
          },
        ),
      );
      continue;
    }

    const count = project.phases.reduce((sum, ph) => sum + ph.tasks.length, 0);
    const row = el('div', 'project-row' + (project.id === state.selectedProjectId ? ' selected' : ''));
    row.appendChild(el('span', `project-dot ${PROJECT_DOT_CLASS[project.status]}`));

    const main = el('div', 'project-row-main');
    main.appendChild(el('div', 'project-row-name', project.name));
    main.appendChild(el('div', 'project-row-meta mono', `${project.id} · ${count}件`));
    row.appendChild(main);

    const deleteIcon = el('button', 'delete-icon', '×');
    deleteIcon.title = '案件を削除';
    deleteIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDelete = { kind: 'project', projectId: project.id };
      render();
    });
    row.appendChild(deleteIcon);

    row.addEventListener('click', () => selectProject(project.id));
    list.appendChild(row);
  }
  panel.appendChild(list);

  if (state.showAddProjectForm) {
    panel.appendChild(renderAddProjectForm());
  } else {
    const addButton = el('button', 'add-button', '+ 新規案件');
    addButton.addEventListener('click', () => {
      state.showAddProjectForm = true;
      render();
    });
    panel.appendChild(addButton);
  }

  return panel;
}

function renderAddProjectForm(): HTMLElement {
  const form = document.createElement('form');
  form.className = 'inline-form';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = '案件名';
  nameInput.required = true;

  const clientInput = document.createElement('input');
  clientInput.type = 'text';
  clientInput.placeholder = 'クライアント';

  const statusSelect = document.createElement('select');
  const statusLabels: Record<ProjectStatus, string> = { active: '進行中', onhold: '保留', closed: '終了' };
  (['active', 'onhold', 'closed'] as ProjectStatus[]).forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = statusLabels[s];
    statusSelect.appendChild(opt);
  });

  form.appendChild(nameInput);
  form.appendChild(clientInput);
  form.appendChild(statusSelect);

  const actions = el('div', 'inline-form-actions');
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button-primary';
  submitButton.textContent = '追加';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'button-secondary';
  cancelButton.textContent = 'キャンセル';
  cancelButton.addEventListener('click', () => {
    state.showAddProjectForm = false;
    render();
  });
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    addProject(name, clientInput.value.trim(), statusSelect.value as ProjectStatus);
  });

  return form;
}

function renderProjectInfoCard(project: Project): HTMLElement {
  const card = el('div', 'card project-info-card');

  const nameField = el('div', 'info-field');
  nameField.appendChild(el('label', 'info-label', '案件名'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'info-input';
  nameInput.value = project.name;
  nameInput.addEventListener('change', () => {
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.value = project.name;
      return;
    }
    updateProjectField(project.id, { name: value });
  });
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  const clientField = el('div', 'info-field');
  clientField.appendChild(el('label', 'info-label', 'クライアント'));
  const clientInput = document.createElement('input');
  clientInput.type = 'text';
  clientInput.className = 'info-input';
  clientInput.value = project.client;
  clientInput.addEventListener('change', () => {
    updateProjectField(project.id, { client: clientInput.value.trim() });
  });
  clientField.appendChild(clientInput);
  card.appendChild(clientField);

  const codeField = el('div', 'info-field');
  codeField.appendChild(el('label', 'info-label', 'プロジェクトコード'));
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.className = 'info-input mono';
  codeInput.value = project.code;
  codeInput.title = '社内管理用の表示コード（システム内部の管理IDとは別に自由編集できます）';
  codeInput.addEventListener('change', () => {
    updateProjectField(project.id, { code: codeInput.value.trim() });
  });
  codeField.appendChild(codeInput);
  card.appendChild(codeField);

  const overviewField = el('div', 'info-field');
  overviewField.appendChild(el('label', 'info-label', '概要'));
  const overviewTextarea = document.createElement('textarea');
  overviewTextarea.className = 'info-textarea';
  overviewTextarea.rows = 3;
  overviewTextarea.placeholder = '案件の概要・背景など';
  overviewTextarea.value = project.overview;
  overviewTextarea.addEventListener('change', () => {
    updateProjectField(project.id, { overview: overviewTextarea.value.trim() });
  });
  overviewField.appendChild(overviewTextarea);
  card.appendChild(overviewField);

  const linksField = el('div', 'info-field');
  linksField.appendChild(el('label', 'info-label', '関連リンク'));
  const linkList = el('div', 'link-list');
  project.links.forEach((link, index) => {
    const row = el('div', 'link-row');
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.label;
    anchor.className = 'link-anchor';
    row.appendChild(anchor);
    const deleteIcon = el('button', 'delete-icon', '×');
    deleteIcon.title = 'このリンクを削除';
    deleteIcon.addEventListener('click', () => removeProjectLink(project.id, index));
    row.appendChild(deleteIcon);
    linkList.appendChild(row);
  });
  linksField.appendChild(linkList);

  const linkForm = document.createElement('form');
  linkForm.className = 'inline-form';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'ラベル';
  labelInput.required = true;
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://...';
  urlInput.required = true;
  const addLinkButton = document.createElement('button');
  addLinkButton.type = 'submit';
  addLinkButton.className = 'button-secondary';
  addLinkButton.textContent = '+ 追加';
  linkForm.appendChild(labelInput);
  linkForm.appendChild(urlInput);
  linkForm.appendChild(addLinkButton);
  linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = labelInput.value.trim();
    const url = urlInput.value.trim();
    if (!label || !url) return;
    addProjectLink(project.id, label, url);
  });
  linksField.appendChild(linkForm);
  card.appendChild(linksField);

  return card;
}

function renderKanban(project: Project): HTMLElement {
  const panel = el('div', 'kanban-panel');
  const header = el('div', 'kanban-header');
  header.appendChild(el('span', 'kanban-project-name', project.name));
  panel.appendChild(header);

  const grid = el('div', 'kanban-grid');
  for (const phase of project.phases) {
    grid.appendChild(renderPhaseColumn(project, phase));
  }
  grid.appendChild(renderAddPhaseTile(project));
  panel.appendChild(grid);
  return panel;
}

function renderAddPhaseTile(project: Project): HTMLElement {
  if (!state.showAddPhaseForm) {
    const tile = el('div', 'add-phase-tile');
    const button = el('button', 'add-button', '+ フェーズ追加');
    button.addEventListener('click', () => {
      state.showAddPhaseForm = true;
      render();
    });
    tile.appendChild(button);
    return tile;
  }

  const tile = el('div', 'add-phase-tile');
  const form = document.createElement('form');
  form.className = 'inline-form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'フェーズ名';
  nameInput.required = true;
  form.appendChild(nameInput);

  const actions = el('div', 'inline-form-actions');
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button-primary';
  submitButton.textContent = '追加';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'button-secondary';
  cancelButton.textContent = 'キャンセル';
  cancelButton.addEventListener('click', () => {
    state.showAddPhaseForm = false;
    render();
  });
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    addPhase(project.id, name);
  });

  tile.appendChild(form);
  return tile;
}

function renderPhaseColumn(project: Project, phase: Phase): HTMLElement {
  const column = el('div', 'kanban-column');
  const pending = state.pendingDelete;

  if (pending?.kind === 'phase' && pending.projectId === project.id && pending.phaseId === phase.id) {
    column.appendChild(
      renderConfirmBar(
        `「${phase.name}」を削除（タスク${phase.tasks.length}件も削除）`,
        () => deletePhase(project.id, phase.id),
        () => {
          state.pendingDelete = undefined;
          render();
        },
      ),
    );
    return column;
  }

  const header = el('div', 'kanban-column-header');
  header.appendChild(el('span', 'kanban-column-name', phase.name));
  const doneCount = phase.tasks.filter((t) => t.status === 'done').length;
  header.appendChild(el('span', 'kanban-column-count mono', `${doneCount}/${phase.tasks.length}`));
  const deleteIcon = el('button', 'delete-icon', '×');
  deleteIcon.title = 'フェーズを削除';
  deleteIcon.addEventListener('click', () => {
    state.pendingDelete = { kind: 'phase', projectId: project.id, phaseId: phase.id };
    render();
  });
  header.appendChild(deleteIcon);
  column.appendChild(header);

  if (phase.tasks.length > 0) {
    const track = el('div', 'phase-progress-track');
    const fill = el('div', 'phase-progress-fill');
    fill.style.width = `${Math.round((doneCount / phase.tasks.length) * 100)}%`;
    track.appendChild(fill);
    column.appendChild(track);
  }

  if (phase.tasks.length === 0) {
    column.appendChild(el('div', 'empty-column', 'タスクなし'));
  } else {
    for (const task of phase.tasks) {
      column.appendChild(renderTaskCard(project, phase, task));
    }
  }

  if (state.addTaskFormPhaseId === phase.id) {
    column.appendChild(renderAddTaskForm(project, phase));
  } else {
    const addButton = el('button', 'add-task-button', '+ タスク追加');
    addButton.addEventListener('click', () => {
      state.addTaskFormPhaseId = phase.id;
      render();
    });
    column.appendChild(addButton);
  }

  return column;
}

function renderAddTaskForm(project: Project, phase: Phase): HTMLElement {
  const form = document.createElement('form');
  form.className = 'inline-form inline-form-vertical';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'タスク名';
  titleInput.required = true;

  const dueInput = document.createElement('input');
  dueInput.type = 'date';

  form.appendChild(titleInput);
  form.appendChild(dueInput);

  const actions = el('div', 'inline-form-actions');
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button-primary';
  submitButton.textContent = '追加';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'button-secondary';
  cancelButton.textContent = 'キャンセル';
  cancelButton.addEventListener('click', () => {
    state.addTaskFormPhaseId = undefined;
    render();
  });
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    addTask(project.id, phase.id, title, dueInput.value);
  });

  return form;
}

function renderTaskCard(project: Project, phase: Phase, task: Task): HTMLElement {
  const pending = state.pendingDelete;
  if (pending?.kind === 'task' && pending.projectId === project.id && pending.taskId === task.id) {
    return renderConfirmBar(
      `「${task.title}」を削除しますか？`,
      () => deleteTask(project.id, phase.id, task.id),
      () => {
        state.pendingDelete = undefined;
        render();
      },
    );
  }

  if (state.editingTaskId === task.id) {
    return renderEditTaskForm(project, phase, task);
  }

  const overdue = task.status !== 'done' && !!task.due && task.due < todayString();
  const card = el('div', 'task-card' + (overdue ? ' overdue' : ''));

  card.appendChild(el('span', 'task-card-title', task.title));
  card.appendChild(el('span', `badge badge-${task.status}`, task.status));
  card.appendChild(el('span', 'task-due mono' + (overdue ? ' overdue' : ''), task.due));

  const editIcon = el('span', 'edit-icon', '✎');
  editIcon.title = 'タスクを編集';
  editIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    state.editingTaskId = task.id;
    render();
  });
  card.appendChild(editIcon);

  const deleteIcon = el('span', 'delete-icon', '×');
  deleteIcon.title = 'タスクを削除';
  deleteIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    state.pendingDelete = { kind: 'task', projectId: project.id, phaseId: phase.id, taskId: task.id };
    render();
  });
  card.appendChild(deleteIcon);

  card.addEventListener('click', () => cycleTaskStatus(project.id, task.id));
  return card;
}

function renderEditTaskForm(project: Project, phase: Phase, task: Task): HTMLElement {
  const form = document.createElement('form');
  form.className = 'inline-form inline-form-vertical';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'タスク名';
  titleInput.required = true;
  titleInput.value = task.title;

  const dueInput = document.createElement('input');
  dueInput.type = 'date';
  dueInput.value = task.due;

  const noteTextarea = document.createElement('textarea');
  noteTextarea.placeholder = '備考';
  noteTextarea.rows = 2;
  noteTextarea.value = task.note;

  form.appendChild(titleInput);
  form.appendChild(dueInput);
  form.appendChild(noteTextarea);

  const actions = el('div', 'inline-form-actions');
  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button-primary';
  submitButton.textContent = '保存';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'button-secondary';
  cancelButton.textContent = 'キャンセル';
  cancelButton.addEventListener('click', () => {
    state.editingTaskId = undefined;
    render();
  });
  actions.appendChild(submitButton);
  actions.appendChild(cancelButton);
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    updateTask(project.id, phase.id, task.id, { title, due: dueInput.value, note: noteTextarea.value.trim() });
  });

  return form;
}

function cycleTaskStatus(projectId: string, taskId: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  let changed = false;
  const nextProjects = state.projects.projects.map((project) => {
    if (project.id !== projectId) return project;
    const nextPhases = project.phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        if (task.id !== taskId) return task;
        changed = true;
        const nextStatus = TASK_STATUS_ORDER[(TASK_STATUS_ORDER.indexOf(task.status) + 1) % 3];
        return { ...task, status: nextStatus };
      }),
    }));
    return { ...project, phases: nextPhases, updatedAt: now };
  });

  if (!changed) return;
  state.projects = { projects: nextProjects };
  render();
  vscode.postMessage({ type: 'save', domain: 'projects', payload: state.projects });
}

function saveProjects(next: ProjectsFile): void {
  state.projects = next;
  vscode.postMessage({ type: 'save', domain: 'projects', payload: next });
  render();
}

function updateProjectField(
  projectId: string,
  patch: Partial<Pick<Project, 'name' | 'client' | 'code' | 'overview'>>,
): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const nextProjects = state.projects.projects.map((p) =>
    p.id === projectId ? { ...p, ...patch, updatedAt: now } : p,
  );
  saveProjects({ projects: nextProjects });
}

function addProjectLink(projectId: string, label: string, url: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const nextProjects = state.projects.projects.map((p) =>
    p.id === projectId ? { ...p, links: [...p.links, { label, url }], updatedAt: now } : p,
  );
  saveProjects({ projects: nextProjects });
}

function removeProjectLink(projectId: string, index: number): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const nextProjects = state.projects.projects.map((p) =>
    p.id === projectId ? { ...p, links: p.links.filter((_, i) => i !== index), updatedAt: now } : p,
  );
  saveProjects({ projects: nextProjects });
}

function addProject(name: string, client: string, status: ProjectStatus): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const newProject: Project = {
    id: genId('prj-'),
    code: '',
    name,
    client,
    status,
    overview: '',
    links: [],
    phases: DEFAULT_PHASE_NAMES.map((n) => ({ id: genId('ph-'), name: n, status: 'todo', tasks: [] })),
    createdAt: now,
    updatedAt: now,
  };
  state.selectedProjectId = newProject.id;
  state.projectFilter = 'all';
  state.showAddProjectForm = false;
  persistUiState();
  saveProjects({ projects: [...state.projects.projects, newProject] });
}

function addPhase(projectId: string, name: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const newPhase: Phase = { id: genId('ph-'), name, status: 'todo', tasks: [] };
  state.showAddPhaseForm = false;
  saveProjects({
    projects: state.projects.projects.map((p) =>
      p.id === projectId ? { ...p, phases: [...p.phases, newPhase], updatedAt: now } : p,
    ),
  });
}

function addTask(projectId: string, phaseId: string, title: string, due: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  const newTask: Task = { id: genId('t-'), title, status: 'todo', due, note: '' };
  state.addTaskFormPhaseId = undefined;
  saveProjects({
    projects: state.projects.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        phases: p.phases.map((ph) => (ph.id === phaseId ? { ...ph, tasks: [...ph.tasks, newTask] } : ph)),
        updatedAt: now,
      };
    }),
  });
}

function updateTask(
  projectId: string,
  phaseId: string,
  taskId: string,
  patch: Partial<Pick<Task, 'title' | 'due' | 'note'>>,
): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  state.editingTaskId = undefined;
  saveProjects({
    projects: state.projects.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        phases: p.phases.map((ph) =>
          ph.id === phaseId
            ? { ...ph, tasks: ph.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
            : ph,
        ),
        updatedAt: now,
      };
    }),
  });
}

function deleteProject(projectId: string): void {
  if (!state.projects) return;
  const remaining = state.projects.projects.filter((p) => p.id !== projectId);
  if (state.selectedProjectId === projectId) {
    state.selectedProjectId = remaining[0]?.id;
  }
  state.pendingDelete = undefined;
  persistUiState();
  saveProjects({ projects: remaining });
}

function deletePhase(projectId: string, phaseId: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  state.pendingDelete = undefined;
  saveProjects({
    projects: state.projects.projects.map((p) =>
      p.id === projectId ? { ...p, phases: p.phases.filter((ph) => ph.id !== phaseId), updatedAt: now } : p,
    ),
  });
}

function deleteTask(projectId: string, phaseId: string, taskId: string): void {
  if (!state.projects) return;
  const now = new Date().toISOString();
  state.pendingDelete = undefined;
  saveProjects({
    projects: state.projects.projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        phases: p.phases.map((ph) =>
          ph.id === phaseId ? { ...ph, tasks: ph.tasks.filter((t) => t.id !== taskId) } : ph,
        ),
        updatedAt: now,
      };
    }),
  });
}

// ===================== 月次処理 =====================

function aggregateByProject(rows: HoursRow[]): { name: string; client: string; hours: number }[] {
  const byProject = new Map<string, { name: string; client: string; hours: number }>();
  for (const row of rows) {
    const existing = byProject.get(row.projectId);
    if (existing) {
      existing.hours += row.hours;
    } else {
      const client = (state.projects?.projects ?? []).find((p) => p.id === row.projectId)?.client ?? '';
      byProject.set(row.projectId, { name: row.projectName, client, hours: row.hours });
    }
  }
  return [...byProject.values()].sort((a, b) => b.hours - a.hours);
}

function projectOptions(): Project[] {
  return (state.projects?.projects ?? []).filter((p) => p.status !== 'closed');
}

function distinctClients(): string[] {
  const set = new Set<string>();
  for (const p of projectOptions()) {
    const client = p.client.trim();
    if (client) set.add(client);
  }
  return [...set];
}

function bracketClientGuess(subject: string): string | null {
  const match = subject.match(/\[([^\]]+)\]/);
  if (!match) return null;
  const bracketText = match[1].trim();
  if (!bracketText) return null;
  return distinctClients().includes(bracketText) ? bracketText : null;
}

function renderMonthlyScreen(): HTMLElement {
  const wrap = el('div');
  const header = el('div', 'page-header');
  const headerLeft = el('div');
  headerLeft.appendChild(el('div', 'page-title', '月次処理'));
  headerLeft.appendChild(el('div', 'page-subtitle', 'Outlook CSV 取り込み ＋ 手入力で工数を集計。'));
  header.appendChild(headerLeft);

  const toolbar = el('div', 'monthly-toolbar');
  const monthPicker = el('div', 'month-picker');
  monthPicker.appendChild(el('span', 'month-picker-label', '対象月'));

  const goToMonth = (yearMonth: string): void => {
    state.hoursMonth = yearMonth;
    state.selectedCalendarDate = undefined;
    persistUiState();
    render();
  };

  const prevButton = el('button', 'month-nav-button', '◀');
  prevButton.title = '前月';
  prevButton.addEventListener('click', () => goToMonth(shiftMonth(state.hoursMonth, -1)));
  monthPicker.appendChild(prevButton);

  const monthInput = document.createElement('input');
  monthInput.type = 'month';
  monthInput.className = 'month-input';
  monthInput.value = state.hoursMonth;
  monthInput.addEventListener('change', () => {
    if (monthInput.value) {
      goToMonth(monthInput.value);
    }
  });
  monthPicker.appendChild(monthInput);

  const nextButton = el('button', 'month-nav-button', '▶');
  nextButton.title = '翌月';
  nextButton.addEventListener('click', () => goToMonth(shiftMonth(state.hoursMonth, 1)));
  monthPicker.appendChild(nextButton);

  toolbar.appendChild(monthPicker);

  if (state.importStep === 0) {
    const importButton = el('button', 'button-primary', 'Outlook CSV 取り込み');
    importButton.addEventListener('click', () => {
      state.importStep = 1;
      render();
    });
    toolbar.appendChild(importButton);

    const manualButton = el('button', 'button-secondary', '手入力');
    manualButton.addEventListener('click', () => {
      state.showManualForm = !state.showManualForm;
      state.manualFormClient = '';
      render();
    });
    toolbar.appendChild(manualButton);
  }
  header.appendChild(toolbar);
  wrap.appendChild(header);

  if (state.importStep > 0) {
    wrap.appendChild(renderImportFlow());
    return wrap;
  }

  wrap.appendChild(renderMonthlyNormalView());
  if (state.showManualForm) {
    wrap.appendChild(renderManualForm());
  }
  return wrap;
}

function renderMonthlyNormalView(): HTMLElement {
  const layout = el('div', 'monthly-layout');
  const mainCol = el('div', 'monthly-main-col');
  const sideCol = el('div', 'monthly-side-col');
  const rows = (state.hours?.rows ?? []).filter((r) => r.yearMonth === state.hoursMonth);
  const total = rows.reduce((sum, r) => sum + r.hours, 0);

  const summary = el('div', 'card');
  summary.appendChild(el('div', 'section-label', '今月の総工数'));
  const kpi = el('div', 'kpi-row');
  kpi.appendChild(el('span', 'kpi-number mono', total.toFixed(1)));
  kpi.appendChild(el('span', 'kpi-unit', 'h'));
  summary.appendChild(kpi);
  summary.appendChild(el('div', 'section-label', '案件別内訳'));
  if (rows.length === 0) {
    summary.appendChild(el('div', 'empty-state', 'データがありません。'));
  } else {
    summary.appendChild(renderBreakdownList(aggregateByProject(rows), { showClient: true }));
  }
  mainCol.appendChild(summary);
  mainCol.appendChild(renderHoursDetailTable(mergeHoursRowsByProject(rows), total));

  appendCalendarSection(sideCol);

  layout.appendChild(mainCol);
  layout.appendChild(sideCol);
  return layout;
}

interface MergedHoursRow {
  projectId: string;
  projectName: string;
  hours: number;
  outlookHours: number;
  manualHours: number;
}

function mergeHoursRowsByProject(rows: HoursRow[]): MergedHoursRow[] {
  const byProject = new Map<string, MergedHoursRow>();
  for (const row of rows) {
    const existing = byProject.get(row.projectId);
    const merged = existing ?? { projectId: row.projectId, projectName: row.projectName, hours: 0, outlookHours: 0, manualHours: 0 };
    merged.hours += row.hours;
    if (row.source === 'outlook') {
      merged.outlookHours += row.hours;
    } else {
      merged.manualHours += row.hours;
    }
    byProject.set(row.projectId, merged);
  }
  return [...byProject.values()].sort((a, b) => b.hours - a.hours);
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function dailyRowsByDate(): Map<string, DailyHoursRow[]> {
  const map = new Map<string, DailyHoursRow[]>();
  const rows = (state.hoursDaily?.rows ?? []).filter((r) => r.date.startsWith(state.hoursMonth));
  for (const row of rows) {
    const list = map.get(row.date);
    if (list) {
      list.push(row);
    } else {
      map.set(row.date, [row]);
    }
  }
  return map;
}

function appendCalendarSection(layout: HTMLElement): void {
  const byDate = dailyRowsByDate();

  const [yearText, monthText] = state.hoursMonth.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = firstDay.getDay();

  const calendarCard = el('div', 'card');
  calendarCard.appendChild(el('div', 'section-label', `${state.hoursMonth} のスケジュール`));

  const grid = el('div', 'calendar-grid');
  for (const label of WEEKDAY_LABELS) {
    grid.appendChild(el('div', 'calendar-weekday', label));
  }
  for (let i = 0; i < startWeekday; i++) {
    grid.appendChild(el('div', 'calendar-cell calendar-cell-empty'));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${state.hoursMonth}-${String(day).padStart(2, '0')}`;
    const dayRows = byDate.get(dateKey) ?? [];
    const dayTotal = dayRows.reduce((sum, r) => sum + r.hours, 0);

    const cell = el('div', 'calendar-cell');
    if (dayRows.length > 0) cell.classList.add('calendar-cell-has-data');
    if (state.selectedCalendarDate === dateKey) cell.classList.add('calendar-cell-selected');
    cell.appendChild(el('div', 'calendar-cell-date', String(day)));
    if (dayRows.length > 0) {
      cell.appendChild(el('div', 'calendar-cell-hours mono', `${dayTotal.toFixed(1)}h`));
    }
    cell.addEventListener('click', () => {
      state.selectedCalendarDate = state.selectedCalendarDate === dateKey ? undefined : dateKey;
      render();
    });
    grid.appendChild(cell);
  }
  calendarCard.appendChild(grid);
  if (byDate.size === 0) {
    calendarCard.appendChild(el('div', 'empty-state', 'この月のOutlook取り込みデータはありません。'));
  }
  layout.appendChild(calendarCard);

  if (state.selectedCalendarDate) {
    layout.appendChild(renderCalendarDayDetail(state.selectedCalendarDate, byDate.get(state.selectedCalendarDate) ?? []));
  }
}

function renderCalendarDayDetail(dateKey: string, rows: DailyHoursRow[]): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(el('div', 'section-label', `${dateKey} の予定`));
  if (rows.length === 0) {
    card.appendChild(el('div', 'empty-state', 'この日のデータはありません。'));
    return card;
  }
  const table = el('div', 'hours-table');
  const headerRow = el('div', 'calendar-detail-row hours-table-header');
  headerRow.appendChild(el('span', undefined, '件名'));
  headerRow.appendChild(el('span', undefined, '案件名'));
  headerRow.appendChild(el('span', 'cell-right', '工数'));
  table.appendChild(headerRow);
  for (const row of rows) {
    const rowEl = el('div', 'calendar-detail-row');
    rowEl.appendChild(el('span', undefined, row.subject));
    rowEl.appendChild(el('span', undefined, row.projectName));
    rowEl.appendChild(el('span', 'mono cell-right', `${row.hours.toFixed(2)}h`));
    table.appendChild(rowEl);
  }
  card.appendChild(table);
  return card;
}

function renderHoursDetailTable(rows: MergedHoursRow[], total: number): HTMLElement {
  const table = el('div', 'hours-table');
  const headerRow = el('div', 'hours-table-row hours-table-header');
  headerRow.appendChild(el('span', undefined, '案件名'));
  headerRow.appendChild(el('span', undefined, '案件コード'));
  headerRow.appendChild(el('span', 'cell-right', '工数'));
  headerRow.appendChild(el('span'));
  table.appendChild(headerRow);

  if (rows.length === 0) {
    const empty = el('div', 'empty-state');
    empty.style.padding = '16px';
    empty.textContent = 'この月の工数データはまだありません。';
    table.appendChild(empty);
  } else {
    for (const row of rows) {
      table.appendChild(renderHoursDetailRow(row));
    }
    const totalRow = el('div', 'hours-table-row hours-table-total');
    totalRow.appendChild(el('span', undefined, '合計'));
    totalRow.appendChild(el('span'));
    const totalValue = el('span', 'mono cell-right', `${total.toFixed(1)}h`);
    totalValue.style.color = 'var(--vscode-charts-blue, #4a9eff)';
    totalValue.style.fontWeight = '600';
    totalRow.appendChild(totalValue);
    totalRow.appendChild(el('span'));
    table.appendChild(totalRow);
  }
  return table;
}

function renderHoursDetailRow(row: MergedHoursRow): HTMLElement {
  const rowEl = el('div', 'hours-table-row');
  rowEl.appendChild(el('span', undefined, row.projectName));
  rowEl.appendChild(el('span', 'mono', row.projectId));

  const hoursInput = document.createElement('input');
  hoursInput.type = 'number';
  hoursInput.step = '0.25';
  hoursInput.min = '0';
  hoursInput.value = String(row.hours);
  hoursInput.className = 'hours-table-input mono';
  hoursInput.addEventListener('change', () => {
    const value = Number(hoursInput.value);
    if (!Number.isFinite(value) || value < 0) {
      hoursInput.value = String(row.hours);
      return;
    }
    setProjectHours(row, value);
  });
  rowEl.appendChild(hoursInput);

  const deleteIcon = el('button', 'delete-icon', '×');
  deleteIcon.title = 'この案件の今月の工数を削除';
  deleteIcon.addEventListener('click', () => deleteProjectHours(row.projectId));
  rowEl.appendChild(deleteIcon);

  return rowEl;
}

function setProjectHours(row: MergedHoursRow, newTotal: number): void {
  const manualHours = Number((Math.max(0, newTotal - row.outlookHours)).toFixed(2));
  const others = (state.hours?.rows ?? []).filter(
    (r) => !(r.yearMonth === state.hoursMonth && r.projectId === row.projectId && r.source === 'manual'),
  );
  const manualRow: HoursRow = {
    yearMonth: state.hoursMonth,
    projectId: row.projectId,
    projectName: row.projectName,
    hours: manualHours,
    source: 'manual',
    note: '',
  };
  state.hours = { rows: manualHours > 0 ? [...others, manualRow] : others };
  vscode.postMessage({ type: 'save', domain: 'hours', payload: state.hours });
  render();
}

function deleteProjectHours(projectId: string): void {
  if (!state.hours) return;
  state.hours = {
    rows: state.hours.rows.filter((r) => !(r.yearMonth === state.hoursMonth && r.projectId === projectId)),
  };
  vscode.postMessage({ type: 'save', domain: 'hours', payload: state.hours });
  render();
}

function renderManualForm(): HTMLElement {
  const wrap = el('div', 'manual-form');
  wrap.appendChild(el('div', 'manual-form-title', `手入力（${state.hoursMonth}）`));

  const projects = projectOptions();
  if (projects.length === 0) {
    wrap.appendChild(el('div', 'empty-state', '案件がありません。先に案件管理から案件を作成してください。'));
    return wrap;
  }

  const form = document.createElement('form');
  form.className = 'manual-form-row';

  const clientSelect = document.createElement('select');
  const clientPlaceholder = document.createElement('option');
  clientPlaceholder.value = '';
  clientPlaceholder.textContent = 'クライアント';
  clientSelect.appendChild(clientPlaceholder);
  for (const client of distinctClients()) {
    const option = document.createElement('option');
    option.value = client;
    option.textContent = client;
    clientSelect.appendChild(option);
  }
  clientSelect.value = state.manualFormClient;
  clientSelect.addEventListener('change', () => {
    state.manualFormClient = clientSelect.value;
    render();
  });

  const projectSelect = document.createElement('select');
  const clientProjects = projects.filter((p) => p.client.trim() === state.manualFormClient);
  const projectPlaceholder = document.createElement('option');
  projectPlaceholder.value = '';
  projectPlaceholder.textContent = '選択してください';
  projectSelect.appendChild(projectPlaceholder);
  for (const p of clientProjects) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  }
  projectSelect.disabled = !state.manualFormClient;

  const hoursInput = document.createElement('input');
  hoursInput.type = 'number';
  hoursInput.step = '0.25';
  hoursInput.min = '0';
  hoursInput.placeholder = '工数h';
  hoursInput.required = true;
  hoursInput.style.width = '90px';

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.placeholder = '備考';
  noteInput.style.flex = '1';

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'button-primary';
  submitButton.textContent = '追加';

  form.appendChild(clientSelect);
  form.appendChild(projectSelect);
  form.appendChild(hoursInput);
  form.appendChild(noteInput);
  form.appendChild(submitButton);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!projectSelect.value) return;
    const hours = Number(hoursInput.value);
    if (!Number.isFinite(hours) || hours <= 0) return;
    upsertManualRow(projectSelect.value, hours, noteInput.value.trim());
    state.manualFormClient = '';
  });

  wrap.appendChild(form);
  return wrap;
}

function upsertManualRow(projectId: string, hours: number, note: string): void {
  const project = (state.projects?.projects ?? []).find((p) => p.id === projectId);
  if (!project) return;
  const existingRows = state.hours?.rows ?? [];
  const others = existingRows.filter(
    (r) => !(r.yearMonth === state.hoursMonth && r.projectId === projectId && r.source === 'manual'),
  );
  const newRow: HoursRow = {
    yearMonth: state.hoursMonth,
    projectId,
    projectName: project.name,
    hours,
    source: 'manual',
    note,
  };
  state.hours = { rows: [...others, newRow] };
  vscode.postMessage({ type: 'save', domain: 'hours', payload: state.hours });
  render();
}

// ---------- Outlook 取り込みフロー ----------

const IMPORT_STEPS = ['CSV選択', 'プレビュー', '確定'];

function closeImport(): void {
  state.importStep = 0;
  state.importPreview = undefined;
  state.learnFlags = {};
  state.clientDraft = {};
  state.showManualForm = false;
  render();
}

function renderImportFlow(): HTMLElement {
  const panel = el('div', 'import-panel');

  const stepper = el('div', 'stepper');
  IMPORT_STEPS.forEach((label, i) => {
    const stepNum = i + 1;
    const active = stepNum <= state.importStep;
    const item = el('div', 'step-item');
    item.appendChild(el('span', 'step-num' + (active ? ' active' : ''), String(stepNum)));
    item.appendChild(el('span', 'step-label' + (active ? ' active' : ''), label));
    if (i < IMPORT_STEPS.length - 1) {
      item.appendChild(el('span', 'step-sep'));
    }
    stepper.appendChild(item);
  });
  const closeButton = el('button', 'step-close', '✕ 閉じる');
  closeButton.addEventListener('click', closeImport);
  stepper.appendChild(closeButton);
  panel.appendChild(stepper);

  if (state.importStep === 1) {
    panel.appendChild(renderDropzone());
  } else if (state.importStep === 2 && state.importPreview) {
    panel.appendChild(renderImportPreview(state.importPreview));
  } else if (state.importStep === 3 && state.importPreview) {
    panel.appendChild(renderImportConfirm(state.importPreview));
  }
  return panel;
}

function renderDropzone(): HTMLElement {
  const zone = el('div', 'dropzone');
  zone.appendChild(el('div', 'dropzone-icon', '⬇'));
  zone.appendChild(el('div', 'dropzone-title', 'CSV ファイルをドロップ'));
  zone.appendChild(el('div', 'dropzone-subtitle', 'またはクリックして選択（Outlook 予定表エクスポート）'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadCsvFile(file);
  });
  zone.appendChild(fileInput);

  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadCsvFile(file);
  });

  return zone;
}

function loadCsvFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const csvText = String(reader.result ?? '');
    vscode.postMessage({ type: 'importOutlook', payload: { csvText } });
  };
  reader.readAsText(file);
}

function renderImportPreview(preview: ImportResult): HTMLElement {
  const wrap = el('div');
  const headerRow = el('div', 'preview-header');
  const unassignedCount = preview.unassigned.filter((e) => !e.excluded).length;
  const badgeClass = unassignedCount > 0 ? 'unassigned-badge-warn' : 'unassigned-badge-ok';
  headerRow.appendChild(el('span', `unassigned-badge mono ${badgeClass}`, `未割当 ${unassignedCount}件`));
  headerRow.appendChild(el('span', undefined, '未割当の行はクライアント→案件の順にプルダウンで割り当ててください。集計しない予定は「対象外」にチェックしてください。'));
  wrap.appendChild(headerRow);

  const table = el('div', 'preview-table');
  const tableHeader = el('div', 'preview-table-header');
  tableHeader.appendChild(el('span', undefined, '件名'));
  tableHeader.appendChild(el('span', undefined, '日時'));
  tableHeader.appendChild(el('span', 'cell-right', '工数'));
  tableHeader.appendChild(el('span', undefined, 'クライアント'));
  tableHeader.appendChild(el('span', undefined, '案件'));
  tableHeader.appendChild(el('span', undefined, '今後'));
  tableHeader.appendChild(el('span', undefined, '対象外'));
  table.appendChild(tableHeader);

  const allEvents = [...preview.assigned, ...preview.unassigned];
  for (const event of allEvents) {
    table.appendChild(renderPreviewRow(event));
  }
  wrap.appendChild(table);

  const footer = el('div', 'import-footer');
  const backButton = el('button', 'button-secondary', '← 戻る');
  backButton.addEventListener('click', () => {
    state.importStep = 1;
    state.importPreview = undefined;
    render();
  });
  footer.appendChild(backButton);

  const nextButton = el(
    'button',
    unassignedCount === 0 ? 'button-primary' : 'button-disabled',
    '確定へ進む →',
  );
  if (unassignedCount === 0) {
    nextButton.addEventListener('click', () => {
      state.importStep = 3;
      render();
    });
  }
  footer.appendChild(nextButton);
  wrap.appendChild(footer);

  return wrap;
}

function renderPreviewRow(event: ImportPreviewEvent): HTMLElement {
  const isUnassigned = event.projectId === null;
  const isExcluded = event.excluded;
  const row = el(
    'div',
    'preview-row' + (isUnassigned && !isExcluded ? ' unassigned' : '') + (isExcluded ? ' excluded' : ''),
  );
  row.appendChild(el('span', 'preview-subject', event.subject));
  row.appendChild(el('span', 'mono', event.datetimeLabel));
  row.appendChild(el('span', 'mono cell-right', `${event.hours.toFixed(1)}h`));

  const currentProject = event.projectId ? projectOptions().find((p) => p.id === event.projectId) : undefined;
  const selectedClient =
    state.clientDraft[event.key] ?? currentProject?.client ?? bracketClientGuess(event.subject) ?? '';

  const clientSelect = document.createElement('select');
  clientSelect.className = 'preview-select';
  const clientPlaceholder = document.createElement('option');
  clientPlaceholder.value = '';
  clientPlaceholder.textContent = '選択してください';
  clientSelect.appendChild(clientPlaceholder);
  for (const client of distinctClients()) {
    const option = document.createElement('option');
    option.value = client;
    option.textContent = client;
    clientSelect.appendChild(option);
  }
  clientSelect.value = selectedClient;
  clientSelect.disabled = isExcluded;
  clientSelect.addEventListener('change', () => {
    state.clientDraft[event.key] = clientSelect.value;
    if (event.projectId && currentProject && currentProject.client !== clientSelect.value) {
      unassignPreviewEvent(event.key);
    } else {
      render();
    }
  });
  row.appendChild(clientSelect);

  const assignCell = el('div', 'assign-options');
  const projectSelect = document.createElement('select');
  projectSelect.className = 'preview-select';
  const projectPlaceholder = document.createElement('option');
  projectPlaceholder.value = '';
  projectPlaceholder.textContent = '選択してください';
  projectSelect.appendChild(projectPlaceholder);
  const clientProjects = projectOptions().filter((p) => p.client.trim() === selectedClient);
  for (const p of clientProjects) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    projectSelect.appendChild(option);
  }
  projectSelect.value = event.projectId && clientProjects.some((p) => p.id === event.projectId) ? event.projectId : '';
  projectSelect.disabled = isExcluded || !selectedClient;
  projectSelect.addEventListener('change', () => {
    if (projectSelect.value) {
      assignPreviewEvent(event.key, projectSelect.value);
    } else {
      unassignPreviewEvent(event.key);
    }
  });
  assignCell.appendChild(projectSelect);

  row.appendChild(assignCell);

  const learnCell = el('div', 'learn-cell');
  const learnCheckbox = document.createElement('input');
  learnCheckbox.type = 'checkbox';
  learnCheckbox.title = '今後この件名をこの案件へ割り当てる';
  learnCheckbox.checked = !!state.learnFlags[event.key];
  learnCheckbox.disabled = isExcluded;
  learnCheckbox.addEventListener('change', () => {
    state.learnFlags[event.key] = learnCheckbox.checked;
  });
  learnCell.appendChild(learnCheckbox);
  row.appendChild(learnCell);

  const excludeCell = el('div', 'learn-cell');
  const excludeCheckbox = document.createElement('input');
  excludeCheckbox.type = 'checkbox';
  excludeCheckbox.title = 'この予定は集計対象外にする';
  excludeCheckbox.checked = isExcluded;
  excludeCheckbox.addEventListener('change', () => toggleExcludePreviewEvent(event.key));
  excludeCell.appendChild(excludeCheckbox);
  row.appendChild(excludeCell);

  return row;
}

function toggleExcludePreviewEvent(eventKey: string): void {
  if (!state.importPreview) return;
  const found = findPreviewEvent(eventKey);
  if (!found) return;
  const list = state.importPreview[found.list];
  list[found.index] = { ...list[found.index], excluded: !list[found.index].excluded };
  render();
}

function findPreviewEvent(eventKey: string): { list: 'assigned' | 'unassigned'; index: number } | undefined {
  if (!state.importPreview) return undefined;
  const assignedIdx = state.importPreview.assigned.findIndex((e) => e.key === eventKey);
  if (assignedIdx !== -1) return { list: 'assigned', index: assignedIdx };
  const unassignedIdx = state.importPreview.unassigned.findIndex((e) => e.key === eventKey);
  if (unassignedIdx !== -1) return { list: 'unassigned', index: unassignedIdx };
  return undefined;
}

function assignPreviewEvent(eventKey: string, projectId: string): void {
  if (!state.importPreview) return;
  const found = findPreviewEvent(eventKey);
  if (!found) return;
  const [event] = state.importPreview[found.list].splice(found.index, 1);
  const updated: ImportPreviewEvent = { ...event, projectId, auto: false };
  state.importPreview.assigned.push(updated);

  const addRule = !!state.learnFlags[eventKey];
  if (addRule) {
    vscode.postMessage({
      type: 'assign',
      payload: { eventKey, subject: event.subject, projectId, addRule: true },
    });
  }
  render();
}

function unassignPreviewEvent(eventKey: string): void {
  if (!state.importPreview) return;
  const found = findPreviewEvent(eventKey);
  if (!found || found.list === 'unassigned') return;
  const [event] = state.importPreview.assigned.splice(found.index, 1);
  const updated: ImportPreviewEvent = { ...event, projectId: null, auto: false };
  state.importPreview.unassigned.push(updated);
  render();
}

function renderImportConfirm(preview: ImportResult): HTMLElement {
  const wrap = el('div', 'confirm-summary');
  const countedEvents = preview.assigned.filter((e) => !e.excluded);
  const eventCount = countedEvents.length;
  const hoursSum = countedEvents.reduce((sum, e) => sum + e.hours, 0);

  wrap.appendChild(el('div', 'placeholder-title', '取り込み内容の確認'));
  wrap.appendChild(
    el('div', 'page-subtitle', `${eventCount} 件のイベント / 合計 ${hoursSum.toFixed(1)}h を今月の集計へ反映します。`),
  );

  const stats = el('div', 'confirm-stats');
  const addStat = (label: string, value: string) => {
    const stat = el('div');
    stat.appendChild(el('div', 'confirm-stat-label', label));
    stat.appendChild(el('div', 'confirm-stat-value mono', value));
    stats.appendChild(stat);
  };
  addStat('イベント', String(eventCount));
  addStat('工数', `${hoursSum.toFixed(1)}h`);
  addStat('未割当', '0');
  wrap.appendChild(stats);

  const actions = el('div', 'confirm-actions');
  const backButton = el('button', 'button-secondary', '← 戻る');
  backButton.addEventListener('click', () => {
    state.importStep = 2;
    render();
  });
  actions.appendChild(backButton);

  const confirmButton = el('button', 'button-success', '取り込む');
  confirmButton.addEventListener('click', () => confirmImport(preview));
  actions.appendChild(confirmButton);
  wrap.appendChild(actions);

  return wrap;
}

function confirmImport(preview: ImportResult): void {
  const byProject = new Map<string, number>();
  for (const event of preview.assigned) {
    if (!event.projectId || event.excluded) continue;
    byProject.set(event.projectId, (byProject.get(event.projectId) ?? 0) + event.hours);
  }

  const newOutlookRows: HoursRow[] = [...byProject.entries()].map(([projectId, hours]) => {
    const project = (state.projects?.projects ?? []).find((p) => p.id === projectId);
    return {
      yearMonth: state.hoursMonth,
      projectId,
      projectName: project?.name ?? projectId,
      hours: Number(hours.toFixed(2)),
      source: 'outlook',
      note: '',
    };
  });

  const keptRows = (state.hours?.rows ?? []).filter(
    (r) => !(r.yearMonth === state.hoursMonth && r.source === 'outlook'),
  );
  state.hours = { rows: [...keptRows, ...newOutlookRows] };
  vscode.postMessage({ type: 'save', domain: 'hours', payload: state.hours });

  const newDailyRows: DailyHoursRow[] = preview.assigned
    .filter((event) => event.projectId && !event.excluded)
    .map((event) => {
      const project = (state.projects?.projects ?? []).find((p) => p.id === event.projectId);
      return {
        date: event.date,
        projectId: event.projectId as string,
        projectName: project?.name ?? (event.projectId as string),
        hours: event.hours,
        subject: event.subject,
      };
    });
  const keptDailyRows = (state.hoursDaily?.rows ?? []).filter((r) => !r.date.startsWith(state.hoursMonth));
  state.hoursDaily = { rows: [...keptDailyRows, ...newDailyRows] };
  vscode.postMessage({ type: 'save', domain: 'hoursDaily', payload: state.hoursDaily });

  closeImport();
}

// ===================== 目標管理 =====================

function renderGoalsScreen(): HTMLElement {
  const wrap = el('div');
  const header = el('div', 'page-header');
  const headerLeft = el('div');
  headerLeft.appendChild(el('div', 'page-title', '目標管理'));
  headerLeft.appendChild(el('div', 'page-subtitle', '半期／通期の人事目標の進捗。'));
  header.appendChild(headerLeft);

  const rightSide = el('div');
  rightSide.style.display = 'flex';
  rightSide.style.alignItems = 'center';
  rightSide.style.gap = '8px';

  const toolbar = el('div', 'goals-toolbar');
  for (const filter of GOAL_FILTERS) {
    const pill = el('button', 'filter-pill' + (state.goalFilter === filter.id ? ' active' : ''), filter.label);
    pill.addEventListener('click', () => {
      state.goalFilter = filter.id;
      persistUiState();
      render();
    });
    toolbar.appendChild(pill);
  }
  rightSide.appendChild(toolbar);

  const editButton = el('button', 'edit-button', 'Markdownを編集 ↗');
  editButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'openFile', domain: 'goals' });
  });
  rightSide.appendChild(editButton);

  header.appendChild(rightSide);
  wrap.appendChild(header);

  const allGoals = state.goals?.goals ?? [];
  if (allGoals.length === 0) {
    wrap.appendChild(renderPlaceholder('目標がありません', '「Markdownを編集」から goals.md に目標を追加してください。'));
    return wrap;
  }

  const categories = [...new Set(allGoals.map((g) => g.category).filter((c) => c))].sort();
  if (categories.length > 0) {
    const catToolbar = el('div', 'goals-toolbar goals-category-toolbar');
    const allPill = el(
      'button',
      'filter-pill' + (state.goalCategoryFilter === 'all' ? ' active' : ''),
      'すべてのカテゴリ',
    );
    allPill.addEventListener('click', () => {
      state.goalCategoryFilter = 'all';
      persistUiState();
      render();
    });
    catToolbar.appendChild(allPill);
    for (const category of categories) {
      const pill = el(
        'button',
        'filter-pill' + (state.goalCategoryFilter === category ? ' active' : ''),
        category,
      );
      pill.addEventListener('click', () => {
        state.goalCategoryFilter = category;
        persistUiState();
        render();
      });
      catToolbar.appendChild(pill);
    }
    wrap.appendChild(catToolbar);
  }

  const filtered = allGoals.filter((g) => {
    if (state.goalFilter !== 'all' && g.period.type !== state.goalFilter) return false;
    if (state.goalCategoryFilter !== 'all' && g.category !== state.goalCategoryFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    wrap.appendChild(renderPlaceholder('該当する目標がありません', 'フィルタ条件を変更してください。'));
    return wrap;
  }

  const grid = el('div', 'goals-grid');
  for (const goal of filtered) {
    grid.appendChild(renderGoalCard(goal));
  }
  wrap.appendChild(grid);
  return wrap;
}

function periodLabel(goal: Goal): string {
  return goal.period.type === 'full' ? '通期' : goal.period.half ?? 'H1';
}

function renderGoalCard(goal: Goal): HTMLElement {
  const card = el('div', 'goal-card');

  const header = el('div', 'goal-card-header');
  header.appendChild(el('span', 'goal-title', goal.title));
  const periodClass = goal.period.type === 'full' ? 'goal-period-full' : 'goal-period-half';
  header.appendChild(el('span', `goal-period-badge mono ${periodClass}`, periodLabel(goal)));
  card.appendChild(header);

  if (goal.category) {
    card.appendChild(el('span', 'goal-category-tag', goal.category));
  }

  const progressRow = el('div', 'goal-progress-row');
  const track = el('div', 'goal-progress-track');
  const fill = el('div', 'goal-progress-fill');
  fill.style.width = `${goal.progress}%`;
  track.appendChild(fill);
  progressRow.appendChild(track);

  const pctInput = document.createElement('input');
  pctInput.type = 'number';
  pctInput.min = '0';
  pctInput.max = '100';
  pctInput.step = '1';
  pctInput.value = String(goal.progress);
  pctInput.className = 'goal-progress-input mono';
  pctInput.addEventListener('input', () => {
    const value = Math.max(0, Math.min(100, Number(pctInput.value) || 0));
    fill.style.width = `${value}%`;
  });
  pctInput.addEventListener('change', () => {
    const value = Math.max(0, Math.min(100, Number(pctInput.value) || 0));
    pctInput.value = String(value);
    updateGoal(goal.id, (g) => ({ ...g, progress: value }));
  });
  progressRow.appendChild(pctInput);
  progressRow.appendChild(el('span', 'goal-progress-unit', '%'));
  card.appendChild(progressRow);

  const milestonesWrap = el('div', 'goal-milestones');
  goal.milestones.forEach((ms, index) => {
    const row = el('div', 'milestone-row');
    row.appendChild(
      el('span', `milestone-box ${ms.done ? 'milestone-box-done' : 'milestone-box-todo'}`, ms.done ? '✓' : ''),
    );
    row.appendChild(el('span', `milestone-text ${ms.done ? 'milestone-text-done' : 'milestone-text-todo'}`, ms.title));
    row.addEventListener('click', () => {
      updateGoal(goal.id, (g) => ({
        ...g,
        milestones: g.milestones.map((m, i) => (i === index ? { ...m, done: !m.done } : m)),
      }));
    });
    milestonesWrap.appendChild(row);
  });
  card.appendChild(milestonesWrap);

  const memo = document.createElement('textarea');
  memo.className = 'goal-memo';
  memo.value = goal.note;
  memo.placeholder = 'メモ';
  memo.addEventListener('blur', () => {
    if (memo.value !== goal.note) {
      updateGoal(goal.id, (g) => ({ ...g, note: memo.value }));
    }
  });
  card.appendChild(memo);

  return card;
}

function updateGoal(goalId: string, updater: (goal: Goal) => Goal): void {
  if (!state.goals) return;
  const now = new Date().toISOString();
  state.goals = {
    goals: state.goals.goals.map((g) => (g.id === goalId ? { ...updater(g), updatedAt: now } : g)),
  };
  vscode.postMessage({ type: 'save', domain: 'goals', payload: state.goals });
  render();
}

// ===================== メッセージ処理 =====================

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'data' && message.domain === 'projects') {
    state.projects = message.payload;
    state.errorMessage = undefined;
    render();
  } else if (message.type === 'data' && message.domain === 'hours') {
    state.hours = message.payload;
    state.errorMessage = undefined;
    render();
  } else if (message.type === 'data' && message.domain === 'hoursDaily') {
    state.hoursDaily = message.payload;
    state.errorMessage = undefined;
    render();
  } else if (message.type === 'data' && message.domain === 'goals') {
    state.goals = message.payload;
    state.errorMessage = undefined;
    render();
  } else if (message.type === 'importResult') {
    state.importPreview = message.payload;
    state.importStep = 2;
    state.learnFlags = {};
    state.clientDraft = {};
    render();
  } else if (message.type === 'fileChanged') {
    requestData(message.domain);
  } else if (message.type === 'error') {
    state.errorMessage = message.message;
    render();
  }
});

function requestData(domain: 'projects' | 'hours' | 'hoursDaily' | 'goals'): void {
  vscode.postMessage({ type: 'requestData', domain });
}

render();
requestData('projects');
requestData('hours');
requestData('hoursDaily');
requestData('goals');
