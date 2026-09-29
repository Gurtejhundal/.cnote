import * as vscode from 'vscode';
import { parseNoteBlocks } from './parser';

export class CodeNoteFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.ProviderResult<vscode.FoldingRange[]> {
    return parseNoteBlocks(document)
      .filter(block => block.range.end.line > block.range.start.line)
      .map(block => new vscode.FoldingRange(
        block.range.start.line,
        block.range.end.line,
        vscode.FoldingRangeKind.Comment
      ));
  }
}
