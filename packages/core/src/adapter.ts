import type { HeraldDoc, HeraldNode, Range } from "./types"

/** An active trigger: the user typed `@` or `/` and is typing a query after it. */
export interface TriggerState {
  trigger: string
  query: string
  /** Text to replace when an item is picked, trigger included. */
  range: Range
  /** Viewport position of the trigger character, for placing a menu. */
  rect: { left: number; top: number; bottom: number }
}

export interface SelectionState {
  empty: boolean
  /** Viewport box around the selection, for placing a toolbar. */
  rect: { left: number; right: number; top: number; bottom: number }
  /** Marks active at the selection start. */
  marks: string[]
}

export interface BlockView {
  update(node: HeraldNode): void
  destroy(): void
}

/** What the editor-agnostic UI layer gives an adapter when mounting it. */
export interface AdapterHooks {
  /** Trigger strings to watch for, e.g. ["@", "/"]. */
  triggers: string[]
  onChange(doc: HeraldDoc): void
  onTrigger(state: TriggerState | null): void
  onSelection(state: SelectionState): void
  /** Called before the editor handles a key. Return true to swallow it (menus use this for arrows and Enter). */
  onKeyDown(event: KeyboardEvent): boolean
  /** Draws an inline atom (a mention chip) into `el`. Returns a cleanup function. */
  renderInline(node: HeraldNode, el: HTMLElement): () => void
  /** Draws a block atom (inputs, output shape) into `el`. Call `update` to write new attrs back. */
  renderBlock(node: HeraldNode, el: HTMLElement, update: (node: HeraldNode) => void): BlockView
}

/** One editor engine. CodeMirror ships first; a ProseMirror adapter implements the same interface. */
export interface EditorAdapter {
  mount(el: HTMLElement, doc: HeraldDoc, hooks: AdapterHooks): void
  destroy(): void
  getDoc(): HeraldDoc
  setDoc(doc: HeraldDoc): void
  /** Inserts a node, replacing `range` (e.g. the typed `@query`) or the selection. */
  insert(node: HeraldNode, range?: Range): void
  toggleMark(mark: string): void
  focus(): void
}
