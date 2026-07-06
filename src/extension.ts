import * as vscode from 'vscode';
import { WorkPortalPanel } from './panel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('workPortal.open', () => {
      WorkPortalPanel.createOrShow(context.extensionUri);
    }),
  );
}

export function deactivate(): void {}
