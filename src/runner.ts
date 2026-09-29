import * as vscode from 'vscode';
import * as path from 'path';

const DEFAULT_RUNNERS = new Set([
  'cpp', 'c', 'python', 'javascript', 'typescript', 'java', 'go', 'rust',
  'ruby', 'php', 'swift', 'kotlin', 'lua', 'perl', 'r', 'shellscript', 'powershell'
]);

export function canRunLanguage(languageId: string): boolean {
  const custom = vscode.workspace.getConfiguration('codenote').get<Record<string, string>>('runCommands', {});
  return Boolean(custom[languageId]) || DEFAULT_RUNNERS.has(languageId);
}

export async function runDocument(document: vscode.TextDocument): Promise<void> {
  if (document.isUntitled) {
    vscode.window.showErrorMessage('Save the file before running it.');
    return;
  }

  await document.save();
  const command = buildRunCommand(document);
  if (!command) {
    const action = await vscode.window.showInformationMessage(
      `CodeNote has no built-in runner for ${document.languageId}. Add codenote.runCommands.${document.languageId} in Settings if you want one.`,
      'Open Settings'
    );
    if (action === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'codenote.runCommands');
    }
    return;
  }

  const source = document.uri.fsPath;
  const dir = path.dirname(source);
  const execution = process.platform === 'win32'
    ? new vscode.ShellExecution('cmd.exe', ['/d', '/c', command], { cwd: dir })
    : new vscode.ShellExecution('/bin/bash', ['-lc', command], { cwd: dir });

  const taskScope = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.TaskScope.Global;
  const task = new vscode.Task(
    { type: 'codenote', language: document.languageId },
    taskScope,
    `Run ${path.basename(source)}`,
    'CodeNote',
    execution,
    []
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    focus: true
  };

  try {
    await vscode.tasks.executeTask(task);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not start runner: ${String(error)}`);
  }
}

function buildRunCommand(document: vscode.TextDocument): string | undefined {
  const source = document.uri.fsPath;
  const dir = path.dirname(source);
  const ext = path.extname(source);
  const base = path.basename(source, ext);
  const binary = path.join(dir, process.platform === 'win32' ? `${base}.exe` : base);
  const q = shellQuote;

  const custom = vscode.workspace.getConfiguration('codenote').get<Record<string, string>>('runCommands', {});
  if (custom[document.languageId]) {
    return custom[document.languageId]
      .replaceAll('${file}', q(source))
      .replaceAll('${dir}', q(dir))
      .replaceAll('${base}', q(base))
      .replaceAll('${ext}', ext)
      .replaceAll('${exe}', process.platform === 'win32' ? '.exe' : '')
      .replaceAll('${binary}', q(binary));
  }

  switch (document.languageId) {
    case 'cpp': {
      const standard = vscode.workspace.getConfiguration('codenote').get<string>('cppStandard', 'c++20');
      return `g++ ${q(source)} -std=${standard} -o ${q(binary)} && ${q(binary)}`;
    }
    case 'c': return `gcc ${q(source)} -o ${q(binary)} && ${q(binary)}`;
    case 'python': return `${process.platform === 'win32' ? 'python' : 'python3'} ${q(source)}`;
    case 'javascript': return `node ${q(source)}`;
    case 'typescript': return `npx tsx ${q(source)}`;
    case 'java': return `javac ${q(source)} && java -cp ${q(dir)} ${shellWord(base)}`;
    case 'go': return `go run ${q(source)}`;
    case 'rust': return `rustc ${q(source)} -o ${q(binary)} && ${q(binary)}`;
    case 'ruby': return `ruby ${q(source)}`;
    case 'php': return `php ${q(source)}`;
    case 'swift': return `swift ${q(source)}`;
    case 'kotlin': {
      const jar = path.join(dir, `${base}.jar`);
      return `kotlinc ${q(source)} -include-runtime -d ${q(jar)} && java -jar ${q(jar)}`;
    }
    case 'lua': return `lua ${q(source)}`;
    case 'perl': return `perl ${q(source)}`;
    case 'r': return `Rscript ${q(source)}`;
    case 'shellscript': return `bash ${q(source)}`;
    case 'powershell': return `pwsh -NoProfile -File ${q(source)}`;
    default: return undefined;
  }
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellWord(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : shellQuote(value);
}
