// @req-001-3 @req-001-4 @req-001-5
import { describe, expect, it } from 'vitest';
import { HISTORY_DEPTH, History, SetMaterial, SetTransform, type Command } from '../../src/app/commands';
import type { EditorEvents, EditorPort, GizmoMode } from '../../src/app/ports';
import { IDENTITY, type MaterialParams, type Transform } from '../../src/domain/model';

function counter(log: string[], label: string): Command {
  return { label, apply: () => log.push(`+${label}`), undo: () => log.push(`-${label}`) };
}

describe('History', () => {
  it('applies on push, undoes in reverse, redoes forward', () => {
    const log: string[] = [];
    const h = new History();
    h.push(counter(log, 'a'));
    h.push(counter(log, 'b'));
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(log).toEqual(['+a', '+b', '-b', '-a', '+a']);
    expect(h).toMatchObject({ canUndo: true, canRedo: true });
  });

  it('forgets the redo branch when a new command is pushed', () => {
    const log: string[] = [];
    const h = new History();
    h.push(counter(log, 'a'));
    h.undo();
    h.push(counter(log, 'b'));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it(`keeps the last ${HISTORY_DEPTH} commands`, () => {
    const log: string[] = [];
    const h = new History();
    for (let i = 0; i < HISTORY_DEPTH + 10; i++) h.push(counter(log, String(i)));
    let undone = 0;
    while (h.undo()) undone++;
    expect(undone).toBe(HISTORY_DEPTH);
    expect(log.at(-1)).toBe('-10'); // the oldest that survived
  });

  it('clear forgets both directions', () => {
    const h = new History();
    h.push(counter([], 'a'));
    h.undo();
    h.clear();
    expect(h).toMatchObject({ canUndo: false, canRedo: false });
  });
});

class RecordingEditor implements EditorPort {
  transform: Transform = IDENTITY;
  materials = new Map<string, MaterialParams>([['m1', { color: '#111111', metalness: 0, roughness: 1 }]]);
  getTransform() {
    return this.transform;
  }
  setTransform(t: Transform) {
    this.transform = t;
  }
  getMaterial(id: string) {
    return this.materials.get(id) ?? null;
  }
  setMaterial(id: string, m: MaterialParams) {
    this.materials.set(id, m);
  }
  stats() {
    return null;
  }
  select(_id: string | null) {}
  setGizmoMode(_mode: GizmoMode) {}
  bind(_events: EditorEvents) {}
}

describe('SetTransform and SetMaterial', () => {
  it('move between before and after, whichever state the editor is in', () => {
    const editor = new RecordingEditor();
    const after: Transform = { ...IDENTITY, position: { x: 1, y: 2, z: 3 } };
    const cmd = new SetTransform(editor, IDENTITY, after);
    cmd.apply();
    expect(editor.transform).toEqual(after);
    editor.transform = { ...IDENTITY, scale: { x: 9, y: 9, z: 9 } }; // drifted meanwhile
    cmd.undo();
    expect(editor.transform).toEqual(IDENTITY);
  });

  it('edit one material by id', () => {
    const editor = new RecordingEditor();
    const red: MaterialParams = { color: '#ff0000', metalness: 0.5, roughness: 0.5 };
    const cmd = new SetMaterial(editor, 'm1', editor.getMaterial('m1') ?? red, red);
    cmd.apply();
    expect(editor.getMaterial('m1')).toEqual(red);
    cmd.undo();
    expect(editor.getMaterial('m1')).toEqual({ color: '#111111', metalness: 0, roughness: 1 });
  });
});
