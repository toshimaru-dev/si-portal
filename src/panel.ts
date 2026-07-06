import * as vscode from 'vscode';
import { ensureGoalsFileExists, readGoals, resolveGoalsUri, writeGoals } from './data/goals';
import { appendMappingRule, readHours, readMapping, writeHours } from './data/hours';
import { parseOutlookCsv } from './data/outlookImport';
import { ensureProjectsFileExists, readProjects, resolveDataDir, resolveProjectsUri, writeProjects } from './data/projects';
import { HostToWebviewMessage, WebviewToHostMessage } from './protocol';

export class WorkPortalPanel {
  private static current: WorkPortalPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri): void {
    if (WorkPortalPanel.current) {
      WorkPortalPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'workPortal',
      '仕事ポータル',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );
    WorkPortalPanel.current = new WorkPortalPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => this.handleMessage(message),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    this.setupWatcher();
  }

  private setupWatcher(): void {
    try {
      const dataDir = resolveDataDir();
      this.watchFile(dataDir, 'projects.md', 'projects');
      this.watchFile(dataDir, 'hours.csv', 'hours');
      this.watchFile(dataDir, 'goals.md', 'goals');
    } catch {
      // ワークスペース未オープン時は監視をスキップ（requestData時にエラー通知する）
    }
  }

  private watchFile(dataDir: vscode.Uri, fileName: string, domain: 'projects' | 'hours' | 'goals'): void {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dataDir, fileName));
    const notify = () => this.post({ type: 'fileChanged', domain });
    watcher.onDidChange(notify, undefined, this.disposables);
    watcher.onDidCreate(notify, undefined, this.disposables);
    watcher.onDidDelete(notify, undefined, this.disposables);
    this.disposables.push(watcher);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    try {
      if (message.type === 'requestData') {
        await this.sendData(message.domain);
      } else if (message.type === 'save' && message.domain === 'projects') {
        await writeProjects(message.payload);
        this.post({ type: 'saved', domain: 'projects' });
      } else if (message.type === 'save' && message.domain === 'hours') {
        await writeHours(message.payload);
        this.post({ type: 'saved', domain: 'hours' });
      } else if (message.type === 'save' && message.domain === 'goals') {
        await writeGoals(message.payload);
        this.post({ type: 'saved', domain: 'goals' });
      } else if (message.type === 'openFile' && message.domain === 'projects') {
        await ensureProjectsFileExists();
        await this.openBeside(resolveProjectsUri());
      } else if (message.type === 'openFile' && message.domain === 'goals') {
        await ensureGoalsFileExists();
        await this.openBeside(resolveGoalsUri());
      } else if (message.type === 'importOutlook') {
        const mapping = await readMapping();
        const result = parseOutlookCsv(message.payload.csvText, mapping);
        this.post({ type: 'importResult', payload: result });
      } else if (message.type === 'assign') {
        if (message.payload.addRule) {
          await appendMappingRule({ keyword: message.payload.subject, projectId: message.payload.projectId });
        }
      }
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async sendData(domain: 'projects' | 'hours' | 'goals'): Promise<void> {
    if (domain === 'projects') {
      this.post({ type: 'data', domain: 'projects', payload: await readProjects() });
    } else if (domain === 'hours') {
      this.post({ type: 'data', domain: 'hours', payload: await readHours() });
    } else {
      this.post({ type: 'data', domain: 'goals', payload: await readGoals() });
    }
  }

  private async openBeside(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
  }

  private post(message: HostToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'));
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>仕事ポータル</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    WorkPortalPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
