import * as vscode from 'vscode';
import { WorkPortalPanel } from './panel';

export class WorkPortalSidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'workPortal.sidebar';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: { type: string }) => {
      if (message.type === 'open') {
        WorkPortalPanel.createOrShow(this.extensionUri);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        WorkPortalPanel.createOrShow(this.extensionUri);
      }
    });

    if (webviewView.visible) {
      WorkPortalPanel.createOrShow(this.extensionUri);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { padding: 12px; font-family: var(--vscode-font-family); }
  button {
    width: 100%;
    padding: 8px;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    font-size: 13px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<button id="openBtn">仕事ポータルを開く</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('openBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'open' });
  });
</script>
</body>
</html>`;
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
