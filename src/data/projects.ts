import * as vscode from 'vscode';
import { PROJECTS_MD_BANNER, parseProjectsMarkdown, serializeProjectsMarkdown } from './projectsMarkdown';
import { ProjectsFile } from './types';

const PROJECTS_FILE_NAME = 'projects.md';

export function resolveDataDir(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('ワークスペースが開かれていません。フォルダを開いてから実行してください。');
  }
  const dataDir = vscode.workspace.getConfiguration('workPortal').get<string>('dataDir', '.work-portal');
  return vscode.Uri.joinPath(folder.uri, dataDir);
}

export function resolveProjectsUri(): vscode.Uri {
  return vscode.Uri.joinPath(resolveDataDir(), PROJECTS_FILE_NAME);
}

export async function readProjects(): Promise<ProjectsFile> {
  const uri = resolveProjectsUri();
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const { file, idsGenerated } = parseProjectsMarkdown(text);
    if (idsGenerated) {
      // 新規に採番したidをファイルへ書き戻し、以後の参照（hours.csv等）で安定させる
      await writeProjects(file);
    }
    return file;
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return { projects: [] };
    }
    throw err;
  }
}

export async function writeProjects(data: ProjectsFile): Promise<void> {
  const dataDir = resolveDataDir();
  await vscode.workspace.fs.createDirectory(dataDir);
  const uri = resolveProjectsUri();
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeProjectsMarkdown(data), 'utf8'));
}

export async function ensureProjectsFileExists(): Promise<void> {
  const uri = resolveProjectsUri();
  try {
    await vscode.workspace.fs.stat(uri);
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      const dataDir = resolveDataDir();
      await vscode.workspace.fs.createDirectory(dataDir);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(PROJECTS_MD_BANNER, 'utf8'));
      return;
    }
    throw err;
  }
}
