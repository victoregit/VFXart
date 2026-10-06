import type { HistoryCommand } from './types';

export class History {
  private undoStack: HistoryCommand[] = []; private redoStack: HistoryCommand[] = []; private used = 0;
  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}
  push(command: HistoryCommand) { this.undoStack.push(command); this.redoStack = []; this.used += command.bytes; while (this.used > this.maxBytes && this.undoStack.length) this.used -= this.undoStack.shift()!.bytes; }
  undo() { const command = this.undoStack.pop(); if (!command) return false; command.undo(); this.redoStack.push(command); return true; }
  redo() { const command = this.redoStack.pop(); if (!command) return false; command.redo(); this.undoStack.push(command); return true; }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; } get bytes() { return this.used; }
}
