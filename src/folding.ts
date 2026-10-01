import * as vscode from 'vscode';
import { effectiveEndLine, parseNoteBlocks } from './parser';

export class CodeNoteFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.ProviderResult<vscode.FoldingRange[]> {
    return parseNoteBlocks(document)
      .filter(block => effectiveEndLine(block) > block.range.start.line)
      .map(block => new vscode.FoldingRange(
        block.range.start.line,
        effectiveEndLine(block),
        vscode.FoldingRangeKind.Comment
      ));
  }
}
