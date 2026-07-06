import { genId } from './id';
import { Goal, GoalPeriodType, GoalsFile, Half } from './types';

export const GOALS_MD_BANNER =
  '<!-- 仕事ポータル: 目標データ（Markdown形式）。書式は docs/spec.md §2.4 を参照。\n' +
  '     この形式（見出し・箇条書き・{#id}）に沿わない記述は保存時に失われます。 -->\n\n';

interface ParseOutcome {
  file: GoalsFile;
  idsGenerated: boolean;
}

const PERIOD_TYPES: GoalPeriodType[] = ['half', 'full'];
const HALVES: Half[] = ['H1', 'H2'];

function stripTrailingId(line: string): { rest: string; id: string | undefined } {
  const match = line.match(/^(.*?)\s*\{#([\w-]+)\}\s*$/);
  if (match) {
    return { rest: match[1], id: match[2] };
  }
  return { rest: line, id: undefined };
}

export function parseGoalsMarkdown(text: string): ParseOutcome {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const goals: Goal[] = [];
  let idsGenerated = false;

  let current: Goal | undefined;
  let noteLines: string[] = [];

  const pushCurrent = () => {
    if (current) {
      current.note = noteLines.join('\n').trim();
      goals.push(current);
    }
    current = undefined;
    noteLines = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#\s+(.+)$/);
    if (heading) {
      pushCurrent();
      const { rest, id } = stripTrailingId(heading[1].trim());
      let goalId = id;
      if (!goalId) {
        goalId = genId('g-');
        idsGenerated = true;
      }
      current = {
        id: goalId,
        title: rest.trim(),
        category: '',
        period: { type: 'half', fiscalYear: '' },
        progress: 0,
        milestones: [],
        note: '',
        updatedAt: '',
      };
      continue;
    }

    if (!current) continue;

    const metaLine = line.match(/^-\s*(\w+):\s*(.*)$/);
    if (metaLine) {
      const key = metaLine[1];
      const value = metaLine[2].trim();
      if (key === 'category') {
        current.category = value;
      } else if (key === 'type' && PERIOD_TYPES.includes(value as GoalPeriodType)) {
        current.period.type = value as GoalPeriodType;
      } else if (key === 'fiscalYear') {
        current.period.fiscalYear = value;
      } else if (key === 'half' && HALVES.includes(value as Half)) {
        current.period.half = value as Half;
      } else if (key === 'progress') {
        const n = Number(value);
        if (Number.isFinite(n)) current.progress = Math.max(0, Math.min(100, Math.round(n)));
      } else if (key === 'updatedAt') {
        current.updatedAt = value;
      }
      continue;
    }

    const milestoneLine = line.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (milestoneLine) {
      current.milestones.push({ title: milestoneLine[2].trim(), done: milestoneLine[1].toLowerCase() === 'x' });
      continue;
    }

    if (line.trim() === '') continue;
    noteLines.push(line);
  }
  pushCurrent();

  if (goals.some((g) => g.period.type === 'half' && !g.period.half)) {
    // half指定なしのhalf期は既定でH1を補う
    for (const g of goals) {
      if (g.period.type === 'half' && !g.period.half) g.period.half = 'H1';
    }
  }

  return { file: { goals }, idsGenerated };
}

export function serializeGoalsMarkdown(data: GoalsFile): string {
  const parts: string[] = [GOALS_MD_BANNER];

  for (const goal of data.goals) {
    parts.push(`# ${goal.title} {#${goal.id}}`);
    parts.push(`- category: ${goal.category}`);
    parts.push(`- type: ${goal.period.type}`);
    parts.push(`- fiscalYear: ${goal.period.fiscalYear}`);
    if (goal.period.type === 'half' && goal.period.half) {
      parts.push(`- half: ${goal.period.half}`);
    }
    parts.push(`- progress: ${goal.progress}`);
    parts.push(`- updatedAt: ${goal.updatedAt}`);
    parts.push('');

    for (const ms of goal.milestones) {
      parts.push(`- [${ms.done ? 'x' : ' '}] ${ms.title}`);
    }
    parts.push('');

    if (goal.note) {
      parts.push(goal.note);
      parts.push('');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
