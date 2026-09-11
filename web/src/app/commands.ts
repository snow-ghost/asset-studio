// Undo is what makes an editor safe to use. Every edit is a Command that knows how to apply itself and how
// to take itself back; History keeps the last fifty of them. The pattern earns its place here and nowhere
// else in the studio (AGENTS.md, section 5): without it there is no undo, and with it a new kind of edit is
// one small class rather than a special case in the session.

import type { MaterialParams, Transform } from '../domain/model';
import type { EditorPort, TextureHandle } from './ports';

export interface Command {
  readonly label: string;
  apply(): void;
  undo(): void;
}

export const HISTORY_DEPTH = 50;

export class History {
  private past: Command[] = [];
  private future: Command[] = [];

  constructor(readonly depth = HISTORY_DEPTH) {}

  /** push applies the command and records it. A new edit after an undo forgets what could be redone. */
  push(cmd: Command): void {
    cmd.apply();
    this.past.push(cmd);
    if (this.past.length > this.depth) this.past.shift();
    this.future = [];
  }

  undo(): boolean {
    const cmd = this.past.pop();
    if (!cmd) return false;
    cmd.undo();
    this.future.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.future.pop();
    if (!cmd) return false;
    cmd.apply();
    this.past.push(cmd);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** clear forgets everything — for a new model; saving is deliberately not a reason to clear. */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/** SetTransform replaces the root transform. A gizmo drag is one command: before is where it started. */
export class SetTransform implements Command {
  readonly label = 'transform';

  constructor(
    private readonly editor: EditorPort,
    private readonly before: Transform,
    private readonly after: Transform,
  ) {}

  apply(): void {
    this.editor.setTransform(this.after);
  }

  undo(): void {
    this.editor.setTransform(this.before);
  }
}

/** SetMaterial edits one material by id; meshes that share it follow, because they hold the same object. */
export class SetMaterial implements Command {
  readonly label = 'material';

  constructor(
    private readonly editor: EditorPort,
    private readonly material: string,
    private readonly before: MaterialParams,
    private readonly after: MaterialParams,
  ) {}

  apply(): void {
    this.editor.setMaterial(this.material, this.after);
  }

  undo(): void {
    this.editor.setMaterial(this.material, this.before);
  }
}

/** SetTexture puts a texture on a material's base colour slot, or takes it off; undo restores whatever was there. */
export class SetTexture implements Command {
  readonly label = 'texture';

  constructor(
    private readonly editor: EditorPort,
    private readonly material: string,
    private readonly before: TextureHandle | null,
    private readonly after: TextureHandle | null,
  ) {}

  apply(): void {
    this.editor.setTexture(this.material, this.after);
  }

  undo(): void {
    this.editor.setTexture(this.material, this.before);
  }
}
