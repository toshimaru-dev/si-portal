import * as vscode from 'vscode';
import { WorkPortalPanel } from './panel';
import { WorkPortalSidebarProvider } from './sidebar';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('workPortal.open', () => {
      WorkPortalPanel.createOrShow(context.extensionUri);
    }),
    vscode.window.registerWebviewViewProvider(
      WorkPortalSidebarProvider.viewId,
      new WorkPortalSidebarProvider(context.extensionUri),
    ),
  );
}

export function deactivate(): void {}
