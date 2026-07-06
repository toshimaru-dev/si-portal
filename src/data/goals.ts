import * as vscode from 'vscode';
import { resolveDataDir } from './projects';
import { GoalsFile } from './types';
import { GOALS_MD_BANNER, parseGoalsMarkdown, serializeGoalsMarkdown } from './goalsMarkdown';

const GOALS_FILE_NAME = 'goals.md';

export function resolveGoalsUri(): vscode.Uri {
  return vscode.Uri.joinPath(resolveDataDir(), GOALS_FILE_NAME);
}

export async function readGoals(): Promise<GoalsFile> {
  const uri = resolveGoalsUri();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const { file, idsGenerated } = parseGoalsMarkdown(text);
    if (idsGenerated) {
      // 新規に採番したidをファイルへ書き戻し、以後の参照で安定させる
      await writeGoals(file);
    }
    return file;
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return { goals: [] };
    }
    throw err;
  }
}

export async function writeGoals(data: GoalsFile): Promise<void> {
  const dataDir = resolveDataDir();
  await vscode.workspace.fs.createDirectory(dataDir);
  const uri = resolveGoalsUri();
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeGoalsMarkdown(data), 'utf8'));
}

export async function ensureGoalsFileExists(): Promise<void> {
  const uri = resolveGoalsUri();
  try {
    await vscode.workspace.fs.stat(uri);
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      const dataDir = resolveDataDir();
      await vscode.workspace.fs.createDirectory(dataDir);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(GOALS_MD_BANNER, 'utf8'));
      return;
    }
    throw err;
  }
}
