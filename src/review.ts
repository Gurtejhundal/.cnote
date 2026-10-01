import * as vscode from 'vscode';
import { NoteBlock } from './parser';

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';
export interface ReviewState {
  repetitions: number;
  intervalDays: number;
  ease: number;
  due: number;
  lastReviewed?: number;
}

export class ReviewStore {
  constructor(private readonly state: vscode.Memento) {}

  key(uri: vscode.Uri, block: NoteBlock): string {
    const identity = block.metadata.id || `${block.kind}:${fingerprint(`${block.title}\n${block.content}`)}`;
    return `${uri.toString()}::${identity}`;
  }

  get(uri: vscode.Uri, block: NoteBlock): ReviewState {
    return this.state.get<ReviewState>(`review:${this.key(uri, block)}`, {
      repetitions: 0,
      intervalDays: 0,
      ease: 2.5,
      due: 0
    });
  }

  isDue(uri: vscode.Uri, block: NoteBlock, now = Date.now()): boolean {
    return (block.kind === 'quiz' || block.kind === 'checkpoint') && this.get(uri, block).due <= now;
  }

  async rate(uri: vscode.Uri, block: NoteBlock, grade: ReviewGrade): Promise<ReviewState> {
    const current = this.get(uri, block);
    const next = { ...current, lastReviewed: Date.now() };

    if (grade === 'again') {
      next.repetitions = 0;
      next.intervalDays = 0;
      next.ease = Math.max(1.3, current.ease - 0.2);
      next.due = Date.now() + 10 * 60 * 1000;
    } else if (grade === 'hard') {
      next.repetitions += 1;
      next.intervalDays = Math.max(1, Math.round(Math.max(1, current.intervalDays) * 1.2));
      next.ease = Math.max(1.3, current.ease - 0.15);
      next.due = Date.now() + next.intervalDays * 86400000;
    } else if (grade === 'good') {
      next.repetitions += 1;
      next.intervalDays = current.repetitions === 0
        ? 1
        : current.repetitions === 1
          ? 3
          : Math.max(1, Math.round(current.intervalDays * current.ease));
      next.due = Date.now() + next.intervalDays * 86400000;
    } else {
      next.repetitions += 1;
      next.ease = Math.min(3.2, current.ease + 0.15);
      next.intervalDays = current.repetitions === 0
        ? 4
        : Math.max(2, Math.round(Math.max(1, current.intervalDays) * next.ease * 1.25));
      next.due = Date.now() + next.intervalDays * 86400000;
    }

    await this.state.update(`review:${this.key(uri, block)}`, next);
    return next;
  }

  async reset(uri: vscode.Uri, block: NoteBlock): Promise<void> {
    await this.state.update(`review:${this.key(uri, block)}`, undefined);
  }

  isCheckpointDone(uri: vscode.Uri, block: NoteBlock, index: number): boolean {
    return this.state.get<boolean>(`checkpoint:${this.key(uri, block)}:${index}`, false);
  }

  async setCheckpointDone(uri: vscode.Uri, block: NoteBlock, index: number, done: boolean): Promise<void> {
    await this.state.update(`checkpoint:${this.key(uri, block)}:${index}`, done || undefined);
  }
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

