import { commands, Position, Selection, Uri, window, workspace } from 'vscode';

export function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function acceptSuggestion() {
  await commands.executeCommand('editor.action.triggerSuggest');
  await wait(1000);
  await commands.executeCommand('acceptAlternativeSelectedSuggestion');
  await wait(1000);
}

export async function setSelections(
  ...selections: Array<Selection | Position>
) {
  window.activeTextEditor!.selections = selections.map(s =>
    s instanceof Position ? new Selection(s, s) : s
  );
  await wait(1000);
}

export function workspaceUri(fsPath: string) {
  const workspaceFolder = workspace.workspaceFolders![0];
  return Uri.joinPath(workspaceFolder.uri, fsPath);
}

export async function openWorkspacePath(fsPath: string) {
  await wait(500);
  await window.showTextDocument(workspaceUri(fsPath));
  await wait(500);
}

export function getTextAtPosition(position: Position, pattern?: RegExp) {
  const doc = window.activeTextEditor!.document;
  return doc.getText(doc.getWordRangeAtPosition(position, pattern));
}

export async function revealDefinition() {
  await commands.executeCommand('editor.action.revealDefinition');
  await wait(1000);
}
