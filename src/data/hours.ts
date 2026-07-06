import * as vscode from 'vscode';
import { parseCsv, stringifyCsv } from './csv';
import { resolveDataDir } from './projects';
import { HoursFile, HoursMapping, HoursRow, MappingRule } from './types';

const HOURS_FILE_NAME = 'hours.csv';
const MAPPING_FILE_NAME = 'hours-mapping.json';
const CSV_HEADER = ['年月', 'projectId', '案件名', '工数h', 'source', '備考'];

export function resolveHoursUri(): vscode.Uri {
  return vscode.Uri.joinPath(resolveDataDir(), HOURS_FILE_NAME);
}

export function resolveMappingUri(): vscode.Uri {
  return vscode.Uri.joinPath(resolveDataDir(), MAPPING_FILE_NAME);
}

function rowFromCsv(cells: string[]): HoursRow | undefined {
  const [yearMonth, projectId, projectName, hoursText, source, note] = cells;
  if (!yearMonth || !projectId) return undefined;
  const hours = Number(hoursText);
  if (!Number.isFinite(hours)) return undefined;
  return {
    yearMonth,
    projectId,
    projectName: projectName ?? '',
    hours,
    source: source === 'manual' ? 'manual' : 'outlook',
    note: note ?? '',
  };
}

export async function readHours(): Promise<HoursFile> {
  const uri = resolveHoursUri();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const table = parseCsv(text);
    const rows = table
      .slice(1)
      .map(rowFromCsv)
      .filter((r): r is HoursRow => r !== undefined);
    return { rows };
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return { rows: [] };
    }
    throw err;
  }
}

export async function writeHours(data: HoursFile): Promise<void> {
  const dataDir = resolveDataDir();
  await vscode.workspace.fs.createDirectory(dataDir);
  const uri = resolveHoursUri();
  const table = [
    CSV_HEADER,
    ...data.rows.map((r) => [r.yearMonth, r.projectId, r.projectName, String(r.hours), r.source, r.note]),
  ];
  await vscode.workspace.fs.writeFile(uri, Buffer.from(stringifyCsv(table), 'utf8'));
}

export async function readMapping(): Promise<HoursMapping> {
  const uri = resolveMappingUri();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<HoursMapping>;
    return {
      rules: parsed.rules ?? [],
      matchMode: 'contains',
      caseSensitive: parsed.caseSensitive ?? false,
    };
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return { rules: [], matchMode: 'contains', caseSensitive: false };
    }
    throw err;
  }
}

export async function writeMapping(data: HoursMapping): Promise<void> {
  const dataDir = resolveDataDir();
  await vscode.workspace.fs.createDirectory(dataDir);
  const uri = resolveMappingUri();
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'));
}

export async function appendMappingRule(rule: MappingRule): Promise<void> {
  const mapping = await readMapping();
  const exists = mapping.rules.some((r) => r.keyword === rule.keyword && r.projectId === rule.projectId);
  if (exists) return;
  mapping.rules.push(rule);
  await writeMapping(mapping);
}
