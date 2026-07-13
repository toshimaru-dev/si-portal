import * as vscode from 'vscode';
import { parseCsv, stringifyCsv } from './csv';
import { resolveDataDir } from './projects';
import { DailyHoursRow, HoursDailyFile } from './types';

const HOURS_DAILY_FILE_NAME = 'hours-daily.csv';
const CSV_HEADER = ['日付', 'projectId', '案件名', '工数h', '件名'];

export function resolveHoursDailyUri(): vscode.Uri {
  return vscode.Uri.joinPath(resolveDataDir(), HOURS_DAILY_FILE_NAME);
}

function rowFromCsv(cells: string[]): DailyHoursRow | undefined {
  const [date, projectId, projectName, hoursText, subject] = cells;
  if (!date || !projectId) return undefined;
  const hours = Number(hoursText);
  if (!Number.isFinite(hours)) return undefined;
  return {
    date,
    projectId,
    projectName: projectName ?? '',
    hours,
    subject: subject ?? '',
  };
}

export async function readHoursDaily(): Promise<HoursDailyFile> {
  const uri = resolveHoursDailyUri();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const table = parseCsv(text);
    const rows = table
      .slice(1)
      .map(rowFromCsv)
      .filter((r): r is DailyHoursRow => r !== undefined);
    return { rows };
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return { rows: [] };
    }
    throw err;
  }
}

export async function writeHoursDaily(data: HoursDailyFile): Promise<void> {
  const dataDir = resolveDataDir();
  await vscode.workspace.fs.createDirectory(dataDir);
  const uri = resolveHoursDailyUri();
  const table = [
    CSV_HEADER,
    ...data.rows.map((r) => [r.date, r.projectId, r.projectName, String(r.hours), r.subject]),
  ];
  await vscode.workspace.fs.writeFile(uri, Buffer.from(stringifyCsv(table), 'utf8'));
}
