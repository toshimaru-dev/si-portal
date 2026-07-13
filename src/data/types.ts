export type TaskStatus = 'todo' | 'doing' | 'done';
export type ProjectStatus = 'active' | 'onhold' | 'closed';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  due: string;
  note: string;
}

export interface Phase {
  id: string;
  name: string;
  status: TaskStatus;
  tasks: Task[];
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  client: string;
  status: ProjectStatus;
  overview: string;
  links: ProjectLink[];
  phases: Phase[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsFile {
  projects: Project[];
}

export type HoursSource = 'outlook' | 'manual';

export interface HoursRow {
  yearMonth: string;
  projectId: string;
  projectName: string;
  hours: number;
  source: HoursSource;
  note: string;
}

export interface HoursFile {
  rows: HoursRow[];
}

export interface DailyHoursRow {
  date: string;
  projectId: string;
  projectName: string;
  hours: number;
  subject: string;
}

export interface HoursDailyFile {
  rows: DailyHoursRow[];
}

export interface MappingRule {
  keyword: string;
  projectId: string;
}

export interface HoursMapping {
  rules: MappingRule[];
  matchMode: 'contains';
  caseSensitive: boolean;
}

export type GoalPeriodType = 'half' | 'full';
export type Half = 'H1' | 'H2';

export interface GoalPeriod {
  type: GoalPeriodType;
  fiscalYear: string;
  half?: Half;
}

export interface Milestone {
  title: string;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  category: string;
  period: GoalPeriod;
  progress: number;
  milestones: Milestone[];
  note: string;
  updatedAt: string;
}

export interface GoalsFile {
  goals: Goal[];
}
