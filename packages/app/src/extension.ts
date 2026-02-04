import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('proof-flow.hello', () => {
    void vscode.window.showInformationMessage('ProofFlow activated')
  })

  context.subscriptions.push(disposable)
}

export function deactivate() {}
