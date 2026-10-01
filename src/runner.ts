import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as crypto from 'crypto';
import { exec } from 'child_process';

export interface RunOutput {
  ok: boolean;
  output: string;
  code?: number | null;
}

const DEFAULT_RUNNERS = new Set([
  'cpp', 'c', 'python', 'javascript', 'typescript', 'java', 'go', 'rust',
  'ruby', 'php', 'swift', 'kotlin', 'lua', 'perl', 'r', 'shellscript', 'powershell'
]);

export function canRunLanguage(languageId: string): boolean {
  const custom = vscode.workspace.getConfiguration('codenote').get<Record<string, string>>('runCommands', {});
  return Boolean(custom[languageId]) || DEFAULT_RUNNERS.has(languageId);
}

export async function runDocument(document: vscode.TextDocument): Promise<void> {
  if (!requireTrustedWorkspace()) return;
  if (document.isUntitled) {
    vscode.window.showErrorMessage('Save the file before running it.');
    return;
  }

  await document.save();
  await runPath(document, document.uri.fsPath, path.dirname(document.uri.fsPath), `Run ${path.basename(document.uri.fsPath)}`);
}

export async function runCodeCell(document: vscode.TextDocument, code: string, label: string): Promise<void> {
  if (!requireTrustedWorkspace()) return;
  if (document.isUntitled) {
    vscode.window.showErrorMessage('Save the file before running cells.');
    return;
  }
  const temp = await writeTempCell(document, code);
  await runPath(document, temp, path.dirname(document.uri.fsPath), `Run ${label}`, temp);
}

export async function runCodeCellOutput(document: vscode.TextDocument, code: string): Promise<RunOutput> {
  if (!requireTrustedWorkspace()) return { ok: false, output: 'Code running is disabled until this workspace is trusted.' };
  if (document.isUntitled) return { ok: false, output: 'Save the file before running cells.' };
  const temp = await writeTempCell(document, code);
  const command = buildRunCommand(document.languageId, temp);
  try {
    if (!command) return { ok: false, output: `No runner for ${document.languageId}. Add codenote.runCommands.${document.languageId} in Settings.` };
    return await executeCaptured(command, path.dirname(document.uri.fsPath));
  } finally {
    void fs.unlink(temp).catch(() => undefined);
  }
}

async function writeTempCell(document: vscode.TextDocument, code: string): Promise<string> {
  const source = document.uri.fsPath;
  const ext = path.extname(source) || extensionForLanguage(document.languageId);
  const safeBase = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9_.-]/g, '-');
  const dir = path.join(os.tmpdir(), 'codenote-cells');
  const temp = path.join(dir, `${safeBase}-${Date.now()}${ext}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(temp, code.replace(/\s+$/, '') + '\n', 'utf8');
  return temp;
}

async function runPath(document: vscode.TextDocument, source: string, cwd: string, name: string, cleanupPath?: string): Promise<void> {
  const command = buildRunCommand(document.languageId, source);
  if (!command) {
    const action = await vscode.window.showInformationMessage(
      `CodeNote has no built-in runner for ${document.languageId}. Add codenote.runCommands.${document.languageId} in Settings if you want one.`,
      'Open Settings'
    );
    if (action === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'codenote.runCommands');
    return;
  }

  const execution = process.platform === 'win32'
    ? new vscode.ShellExecution('cmd.exe', ['/d', '/c', command], { cwd })
    : new vscode.ShellExecution('/bin/bash', ['-lc', command], { cwd });

  const taskScope = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.TaskScope.Global;
  const task = new vscode.Task({ type: 'codenote', language: document.languageId }, taskScope, name, 'CodeNote', execution, []);
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true, focus: true };

  try {
    const execution = await vscode.tasks.executeTask(task);
    if (cleanupPath) {
      const disposable = vscode.tasks.onDidEndTaskProcess(event => {
        if (event.execution !== execution) return;
        disposable.dispose();
        void fs.unlink(cleanupPath).catch(() => undefined);
      });
    }
  } catch (error) {
    if (cleanupPath) void fs.unlink(cleanupPath).catch(() => undefined);
    vscode.window.showErrorMessage(`Could not start runner: ${String(error)}`);
  }
}

function buildRunCommand(languageId: string, source: string): string | undefined {
  const dir = path.dirname(source);
  const ext = path.extname(source);
  const base = path.basename(source, ext);
  const outDir = runOutputDir(source);
  const binary = path.join(outDir, process.platform === 'win32' ? `${base}.exe` : base);
  const q = shellQuote;

  const custom = vscode.workspace.getConfiguration('codenote').get<Record<string, string>>('runCommands', {});
  if (custom[languageId]) {
    return custom[languageId]
      .replaceAll('${file}', q(source))
      .replaceAll('${dir}', q(dir))
      .replaceAll('${base}', q(base))
      .replaceAll('${ext}', ext)
      .replaceAll('${exe}', process.platform === 'win32' ? '.exe' : '')
      .replaceAll('${binary}', q(binary));
  }

  switch (languageId) {
    case 'cpp': {
      const standard = vscode.workspace.getConfiguration('codenote').get<string>('cppStandard', 'c++20');
      return `g++ ${q(source)} -std=${standard} -o ${q(binary)} && ${q(binary)}`;
    }
    case 'c': return `gcc ${q(source)} -o ${q(binary)} && ${q(binary)}`;
    case 'python': return `${process.platform === 'win32' ? 'python' : 'python3'} ${q(source)}`;
    case 'javascript': return `node ${q(source)}`;
    case 'typescript': return `npx tsx ${q(source)}`;
    case 'java': return `javac -d ${q(outDir)} ${q(source)} && java -cp ${q(outDir)} ${shellWord(base)}`;
    case 'go': return `go run ${q(source)}`;
    case 'rust': return `rustc ${q(source)} -o ${q(binary)} && ${q(binary)}`;
    case 'ruby': return `ruby ${q(source)}`;
    case 'php': return `php ${q(source)}`;
    case 'swift': return `swift ${q(source)}`;
    case 'kotlin': {
      const jar = path.join(outDir, `${base}.jar`);
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

function requireTrustedWorkspace(): boolean {
  if (vscode.workspace.isTrusted) return true;
  vscode.window.showWarningMessage('CodeNote will not run code until this workspace is trusted.');
  return false;
}

function runOutputDir(source: string): string {
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 10);
  const safeBase = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9_.-]/g, '-');
  const dir = path.join(os.tmpdir(), 'codenote-runs', `${safeBase}-${hash}`);
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

function executeCaptured(command: string, cwd: string): Promise<RunOutput> {
  return new Promise(resolve => {
    exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number' ? (error as { code: number }).code : null;
      resolve({ ok: !error, code, output: `${stdout || ''}${stderr || ''}`.trimEnd() || (error ? `Exited with code ${code ?? 1}` : 'Done.') });
    });
  });
}

function extensionForLanguage(languageId: string): string {
  return ({ javascript: '.js', typescript: '.ts', python: '.py', shellscript: '.sh', powershell: '.ps1' } as Record<string, string>)[languageId] ?? `.${languageId}`;
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellWord(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : shellQuote(value);
}
