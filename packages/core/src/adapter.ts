import type { Schema } from "./schema"
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

/** A UI-drawn atom (a chip, a block) inside the editor. */
export interface AtomView {
  /** New attrs, or the editor flipped between editable and read-only. */
  update(node: HeraldNode, editable: boolean): void
  destroy(): void
}

/** Finds a trigger the cursor is in, given the textblock's text before the cursor. */
export function findTrigger(before: string, triggers: string[]): { trigger: string; at: number; query: string } | null {
  for (const t of [...triggers].sort((a, b) => b.length - a.length)) {
    const at = before.lastIndexOf(t)
    if (at < 0 || (at > 0 && !/[\s(]/.test(before[at - 1]!))) {
      continue
    }
    const query = before.slice(at + t.length)
    if (/^[\p{L}\p{N}_.-]*$/u.test(query)) {
      return { trigger: t, at, query }
    }
  }
  return null
}

/**
 * The parts of the editor a UI layer can style. An adapter puts `classes[part]` on each part, or `herald-<part>`
 * when the UI layer gives none.
 */
export const EditorPart = {
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h4",
  H5: "h5",
  H6: "h6",
  Bold: "bold",
  Italic: "italic",
  Strike: "strike",
  Code: "code",
  Link: "link",
  Syntax: "syntax",
  ListMark: "list-mark",
  Quote: "quote",
  CodeBlock: "code-block",
  Hr: "hr",
  Directive: "directive",
  DirectiveOpen: "directive-open",
  DirectiveClose: "directive-close",
  DirectiveTitle: "directive-title",
  DragHandle: "drag-handle",
  DropLine: "drop-line",
  DragGhost: "drag-ghost",
  /** A table's lines while its markdown source is shown for editing. */
  Table: "table",
  /** The document root of an adapter that renders rich DOM (ProseMirror). Give it the same class as DocView's root. */
  Doc: "doc",
  Comment: "comment",
  /** The comment thread the caret is in. */
  CommentActive: "comment-active",
  /** The range a comment is being written about, before it's saved. */
  CommentDraft: "comment-draft",
  /** Stands in for an image while it uploads. */
  ImagePlaceholder: "image-placeholder",
} as const
export type EditorPart = (typeof EditorPart)[keyof typeof EditorPart]

export type EditorClasses = Partial<Record<EditorPart, string>>

/** What the editor-agnostic UI layer gives an adapter when mounting it. */
export interface AdapterHooks {
  /** Class names for the editor's own parts; see EditorPart. */
  classes?: EditorClasses
  /** Trigger strings to watch for, e.g. ["@", "/"]. */
  triggers: string[]
  /** Starts read-only when false; `setEditable` flips it later. */
  editable: boolean
  /**
   * Block types the UI layer draws and edits itself through `renderBlock`, e.g. a table grid. The adapter keeps them
   * atomic: no editable content, and no markdown source shown when the cursor goes inside.
   */
  blockOverrides: string[]
  onChange(doc: HeraldDoc): void
  onTrigger(state: TriggerState | null): void
  onSelection(state: SelectionState): void
  /** Called before the editor handles a key. Return true to swallow it (menus use this for arrows and Enter). */
  onKeyDown(event: KeyboardEvent): boolean
  /** Draws an inline atom (a mention chip) into `el`. */
  renderInline(node: HeraldNode, el: HTMLElement, editable: boolean): AtomView
  /** Draws a block atom (inputs, an image, an overridden table) into `el`. Call `update` to write a new node back. */
  renderBlock(node: HeraldNode, el: HTMLElement, update: (node: HeraldNode) => void, editable: boolean): AtomView
  /** Converts pasted clipboard data into nodes to insert, or null for the editor's own paste. */
  onPaste?(data: { getData(mime: string): string }): HeraldNode[] | null
}

/** One editor engine: CodeMirror over markdown text, or ProseMirror over the JSON. */
export interface EditorAdapter {
  /**
   * Stored JSON in, the doc this engine edits out. CodeMirror normalizes to what markdown can hold; ProseMirror keeps
   * the JSON as given, so TipTap docs come back unchanged.
   */
  parse(schema: Schema, value: unknown): HeraldDoc
  mount(el: HTMLElement, doc: HeraldDoc, hooks: AdapterHooks): void
  destroy(): void
  getDoc(): HeraldDoc
  setDoc(doc: HeraldDoc): void
  /** Inserts a node, replacing `range` (e.g. the typed `@query`) or the selection. */
  insert(node: HeraldNode, range?: Range): void
  toggleMark(mark: string): void
  focus(): void
  /** Read-only shows the same views with no caret, trigger menus or drag handles. Keeps the scroll position. */
  setEditable(editable: boolean): void
}
