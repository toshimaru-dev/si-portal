import { genId } from './id';
import { Phase, Project, ProjectsFile, ProjectStatus, Task, TaskStatus } from './types';

export const PROJECTS_MD_BANNER =
  '<!-- 仕事ポータル: 案件データ（Markdown形式）。書式は docs/spec.md §2.1 を参照。\n' +
  '     この形式（見出し・箇条書き・{#id}）に沿わない記述は保存時に失われます。 -->\n\n';

interface ParseOutcome {
  file: ProjectsFile;
  idsGenerated: boolean;
}

const PROJECT_STATUSES: ProjectStatus[] = ['active', 'onhold', 'closed'];
const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

function stripTrailingId(line: string): { rest: string; id: string | undefined } {
  const match = line.match(/^(.*?)\s*\{#([\w-]+)\}\s*$/);
  if (match) {
    return { rest: match[1], id: match[2] };
  }
  return { rest: line, id: undefined };
}

function stripTrailingParen(line: string): { rest: string; inner: string | undefined } {
  const match = line.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (match) {
    return { rest: match[1], inner: match[2] };
  }
  return { rest: line, inner: undefined };
}

export function parseProjectsMarkdown(text: string): ParseOutcome {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const projects: Project[] = [];
  let idsGenerated = false;

  let currentProject: Project | undefined;
  let currentPhase: Phase | undefined;
  let overviewLines: string[] = [];

  const pushPhase = () => {
    if (currentProject && currentPhase) {
      currentProject.phases.push(currentPhase);
    }
    currentPhase = undefined;
  };
  const pushProject = () => {
    pushPhase();
    if (currentProject) {
      currentProject.overview = overviewLines.join('\n');
      projects.push(currentProject);
    }
    currentProject = undefined;
    overviewLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const projectHeading = line.match(/^#\s+(.+)$/);
    if (projectHeading) {
      pushProject();
      const { rest, id } = stripTrailingId(projectHeading[1].trim());
      let projectId = id;
      if (!projectId) {
        projectId = genId('prj-');
        idsGenerated = true;
      }
      currentProject = {
        id: projectId,
        code: '',
        name: rest.trim(),
        client: '',
        status: 'active',
        overview: '',
        links: [],
        phases: [],
        createdAt: '',
        updatedAt: '',
      };
      continue;
    }

    const phaseHeading = line.match(/^##\s+(.+)$/);
    if (phaseHeading && currentProject) {
      pushPhase();
      const { rest: withoutId, id } = stripTrailingId(phaseHeading[1].trim());
      const { rest: name, inner: statusToken } = stripTrailingParen(withoutId);
      let phaseId = id;
      if (!phaseId) {
        phaseId = genId('ph-');
        idsGenerated = true;
      }
      const status: TaskStatus = TASK_STATUSES.includes(statusToken as TaskStatus)
        ? (statusToken as TaskStatus)
        : 'todo';
      currentPhase = { id: phaseId, name: name.trim(), status, tasks: [] };
      continue;
    }

    const taskLine = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (taskLine && currentProject && currentPhase) {
      const done = taskLine[1].toLowerCase() === 'x';
      const { rest: withoutId, id } = stripTrailingId(taskLine[2].trim());
      const { rest: title, inner: metaToken } = stripTrailingParen(withoutId);
      let taskId = id;
      if (!taskId) {
        taskId = genId('t-');
        idsGenerated = true;
      }
      let due = '';
      let doingFlag = false;
      if (metaToken) {
        for (const token of metaToken.split(',').map((t) => t.trim())) {
          const dueMatch = token.match(/^due:\s*(.+)$/i);
          if (dueMatch) {
            due = dueMatch[1].trim();
          } else if (/^doing$/i.test(token)) {
            doingFlag = true;
          }
        }
      }
      let note = '';
      const next = lines[i + 1];
      const noteMatch = next?.match(/^\s+note:\s*(.*)$/);
      if (noteMatch) {
        note = noteMatch[1].trim();
        i++;
      }
      const task: Task = {
        id: taskId,
        title: title.trim(),
        status: done ? 'done' : doingFlag ? 'doing' : 'todo',
        due,
        note,
      };
      currentPhase.tasks.push(task);
      continue;
    }

    const metaLine = line.match(/^-\s*(\w+):\s*(.*)$/);
    if (metaLine && currentProject) {
      const key = metaLine[1];
      const value = metaLine[2].trim();
      if (key === 'code') currentProject.code = value;
      else if (key === 'client') currentProject.client = value;
      else if (key === 'status' && PROJECT_STATUSES.includes(value as ProjectStatus)) {
        currentProject.status = value as ProjectStatus;
      } else if (key === 'createdAt') currentProject.createdAt = value;
      else if (key === 'updatedAt') currentProject.updatedAt = value;
      else if (key === 'link') {
        const [label, url] = value.split('|').map((s) => s.trim());
        if (label && url) currentProject.links.push({ label, url });
      }
      continue;
    }

    if (currentProject && !currentPhase && currentProject.phases.length === 0 && line.trim() !== '') {
      overviewLines.push(line.trim());
    }
  }
  pushProject();

  return { file: { projects }, idsGenerated };
}

export function serializeProjectsMarkdown(data: ProjectsFile): string {
  const parts: string[] = [PROJECTS_MD_BANNER];

  for (const project of data.projects) {
    parts.push(`# ${project.name} {#${project.id}}`);
    parts.push(`- code: ${project.code}`);
    parts.push(`- client: ${project.client}`);
    parts.push(`- status: ${project.status}`);
    parts.push(`- createdAt: ${project.createdAt}`);
    parts.push(`- updatedAt: ${project.updatedAt}`);
    for (const link of project.links) {
      parts.push(`- link: ${link.label}|${link.url}`);
    }
    parts.push('');
    if (project.overview) {
      parts.push(project.overview);
      parts.push('');
    }

    for (const phase of project.phases) {
      parts.push(`## ${phase.name} (${phase.status}) {#${phase.id}}`);
      for (const task of phase.tasks) {
        const checkbox = task.status === 'done' ? 'x' : ' ';
        const metaTokens: string[] = [];
        if (task.due) metaTokens.push(`due: ${task.due}`);
        if (task.status === 'doing') metaTokens.push('doing');
        const metaSuffix = metaTokens.length > 0 ? ` (${metaTokens.join(', ')})` : '';
        parts.push(`- [${checkbox}] ${task.title}${metaSuffix} {#${task.id}}`);
        if (task.note) {
          parts.push(`    note: ${task.note}`);
        }
      }
      parts.push('');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
