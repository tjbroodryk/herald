import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { EditorState, Prec, RangeSet, StateField, type Extension, type Range as CMRange } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  keymap,
  placeholder as placeholderExt,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view"
import type { AdapterHooks, BlockView, EditorAdapter, EditorClassKey, HeraldDoc, HeraldNode, Range } from "@herald/core"
import { isInlineAtom, parseMarkdown, serializeMarkdown, serializeWithCursor, type ParseResult, type Span } from "@herald/markdown"
import { dragBlocks, moveBlockCommand } from "./drag"

export interface CodeMirrorOptions {
  placeholder?: string
  /** Drag handles and ⌥⇧↑/↓ to reorder top-level blocks. Default true. */
  draggable?: boolean
  /** Extra CodeMirror extensions, added after Herald's. */
  extensions?: Extension[]
}

/** The editor is CodeMirror over markdown text; the Herald JSON is parsed from that text on every change. */
export function codemirror(options: CodeMirrorOptions = {}): CodeMirrorAdapter {
  return new CodeMirrorAdapter(options)
}

const DELIMS: Record<string, string> = { bold: "**", italic: "*", strike: "~~", code: "`" }

export class CodeMirrorAdapter implements EditorAdapter {
  view: EditorView | undefined
  private parsed = StateField.define<ParseResult>({
    create: (state) => parseMarkdown(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? parseMarkdown(tr.state.doc.toString()) : value),
  })

  private cls: (key: EditorClassKey) => string = (key) => `herald-${key}`

  constructor(private readonly options: CodeMirrorOptions) {}

  mount(el: HTMLElement, doc: HeraldDoc, hooks: AdapterHooks): void {
    this.cls = (key) => hooks.classes?.[key] ?? `herald-${key}`
    const parsed = this.parsed
    const decorations = StateField.define<{ decos: DecorationSet; atoms: RangeSet<Decoration> }>({
      create: (state) => this.decorate(state, hooks),
      update: (value, tr) => (tr.docChanged || tr.selection ? this.decorate(tr.state, hooks) : value),
      provide: (f) => [
        EditorView.decorations.from(f, (v) => v.decos),
        EditorView.atomicRanges.of((view) => view.state.field(f).atoms),
      ],
    })
    const markKey = (mark: string) => () => {
      this.toggleMark(mark)
      return true
    }
    const text = serializeMarkdown(doc)
    const draggable = this.options.draggable !== false
    this.view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: text,
        // start at the end so the first line isn't shown as raw markdown
        selection: { anchor: text.length },
        extensions: [
          parsed,
          decorations,
          history(),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event) => {
                if (hooks.onKeyDown(event)) {
                  event.preventDefault()
                  return true
                }
                return false
              },
            }),
          ),
          draggable ? dragBlocks(parsed, this.cls) : [],
          keymap.of([
            { key: "Mod-b", run: markKey("bold") },
            { key: "Mod-i", run: markKey("italic") },
            { key: "Mod-e", run: markKey("code") },
            ...(draggable
              ? [
                  { key: "Alt-Shift-ArrowUp", run: moveBlockCommand(parsed, -1) },
                  { key: "Alt-Shift-ArrowDown", run: moveBlockCommand(parsed, 1) },
                ]
              : []),
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-multiline": "true", role: "textbox" }),
          theme,
          this.options.placeholder ? placeholderExt(this.options.placeholder) : [],
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              hooks.onChange(u.state.field(parsed).doc)
            }
            if (u.docChanged || u.selectionSet || u.focusChanged) {
              hooks.onTrigger(this.trigger(u.view, hooks.triggers))
              hooks.onSelection(this.selection(u.view))
            }
          }),
          ...(this.options.extensions ?? []),
        ],
      }),
    })
  }

  destroy(): void {
    this.view?.destroy()
    this.view = undefined
  }

  getDoc(): HeraldDoc {
    return this.requireView().state.field(this.parsed).doc
  }

  /** The markdown as typed. Store this if you want the user's own spelling kept. */
  getText(): string {
    return this.requireView().state.doc.toString()
  }

  setDoc(doc: HeraldDoc): void {
    const view = this.requireView()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: serializeMarkdown(doc) } })
  }

  focus(): void {
    this.view?.focus()
  }

  insert(node: HeraldNode, range?: Range): void {
    const view = this.requireView()
    const r = range ?? view.state.selection.main
    const { text, cursor } = serializeWithCursor(node)
    if (isInlineAtom(node)) {
      view.dispatch({
        changes: { from: r.from, to: r.to, insert: text + " " },
        selection: { anchor: r.from + text.length + 1 },
        userEvent: "input",
      })
      view.focus()
      return
    }
    const doc = view.state.doc
    const line = doc.lineAt(r.from)
    const rest = line.text.slice(0, r.from - line.from) + line.text.slice(r.to - line.from)
    // blocks need blank lines around them, or markdown merges them into their neighbours
    const blank = (n: number) => n < 1 || n > doc.lines || !doc.line(n).text.trim()
    if (!rest.trim()) {
      const before = blank(line.number - 1) ? "" : "\n"
      const after = blank(line.number + 1) ? "" : "\n"
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: before + text + after },
        selection: { anchor: line.from + before.length + cursor },
        userEvent: "input",
      })
    } else {
      view.dispatch({
        changes: [
          { from: r.from, to: r.to },
          { from: line.to, insert: "\n\n" + text + (blank(line.number + 1) ? "" : "\n") },
        ],
        selection: { anchor: line.to - (r.to - r.from) + 2 + cursor },
        userEvent: "input",
      })
    }
    view.focus()
  }

  toggleMark(mark: string): void {
    const view = this.requireView()
    const delim = DELIMS[mark]
    if (!delim) {
      return
    }
    const { from, to } = view.state.selection.main
    const active = view.state
      .field(this.parsed)
      .spans.find((s) => s.kind === "style" && s.key === mark && s.from <= from && s.to >= to)
    if (active) {
      const len = mark === "code" ? 1 : delim.length
      view.dispatch({
        changes: [
          { from: active.from, to: active.from + len },
          { from: active.to - len, to: active.to },
        ],
        userEvent: "input",
      })
    } else {
      view.dispatch({
        changes: [
          { from, insert: delim },
          { from: to, insert: delim },
        ],
        selection: { anchor: from + delim.length, head: to + delim.length },
        userEvent: "input",
      })
    }
    view.focus()
  }

  private requireView(): EditorView {
    if (!this.view) {
      throw new Error("herald: the editor is not mounted")
    }
    return this.view
  }

  private trigger(view: EditorView, triggers: string[]) {
    const sel = view.state.selection.main
    if (!view.hasFocus || !sel.empty) {
      return null
    }
    const line = view.state.doc.lineAt(sel.head)
    const before = line.text.slice(0, sel.head - line.from)
    for (const t of [...triggers].sort((a, b) => b.length - a.length)) {
      const at = before.lastIndexOf(t)
      if (at < 0 || (at > 0 && !/[\s(]/.test(before[at - 1]!))) {
        continue
      }
      const query = before.slice(at + t.length)
      if (!/^[\p{L}\p{N}_.-]*$/u.test(query)) {
        continue
      }
      const from = line.from + at
      const coords = view.coordsAtPos(from)
      if (!coords) {
        return null
      }
      return {
        trigger: t,
        query,
        range: { from, to: sel.head },
        rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
      }
    }
    return null
  }

  private selection(view: EditorView) {
    const sel = view.state.selection.main
    const start = view.coordsAtPos(sel.from)
    const end = view.coordsAtPos(sel.to)
    const marks = view.state
      .field(this.parsed)
      .spans.flatMap((s) => (s.kind === "style" && s.from <= sel.from && s.to >= sel.to ? [s.key] : []))
    return {
      empty: sel.empty || !view.hasFocus,
      rect: {
        left: Math.min(start?.left ?? 0, end?.left ?? 0),
        right: Math.max(start?.right ?? 0, end?.right ?? 0),
        top: Math.min(start?.top ?? 0, end?.top ?? 0),
        bottom: Math.max(start?.bottom ?? 0, end?.bottom ?? 0),
      },
      marks,
    }
  }

  private decorate(state: EditorState, hooks: AdapterHooks) {
    const { spans } = state.field(this.parsed)
    const sel = state.selection.ranges
    const revealed = (r: Range) => sel.some((s) => s.from <= r.to && s.to >= r.from)
    const decos: CMRange<Decoration>[] = []
    const atoms: CMRange<Decoration>[] = []
    for (const span of spans) {
      this.decorateSpan(state, span, hooks, revealed, decos, atoms)
    }
    return { decos: Decoration.set(decos, true), atoms: Decoration.set(atoms, true) }
  }

  private decorateSpan(
    state: EditorState,
    span: Span,
    hooks: AdapterHooks,
    revealed: (r: Range) => boolean,
    decos: CMRange<Decoration>[],
    atoms: CMRange<Decoration>[],
  ) {
    const doc = state.doc
    switch (span.kind) {
      case "hide":
        if (span.to > span.from && !revealed(span.reveal)) {
          decos.push(Decoration.replace({}).range(span.from, span.to))
        }
        return
      case "style":
        if (span.to > span.from) {
          decos.push(Decoration.mark({ class: this.cls(span.key) }).range(span.from, span.to))
        }
        return
      case "lines": {
        const last = doc.lineAt(Math.max(span.from, span.to - 1)).number
        for (let n = doc.lineAt(span.from).number; n <= last; n++) {
          decos.push(Decoration.line({ class: this.cls(span.key), attributes: span.attrs }).range(doc.line(n).from))
        }
        return
      }
      case "label":
        if (!revealed(span.reveal)) {
          decos.push(
            Decoration.replace({ widget: new LabelWidget(span.text, this.cls(span.key)) }).range(span.from, span.to),
          )
        }
        return
      case "atom": {
        if (span.block) {
          const from = doc.lineAt(span.from).from
          const deco = Decoration.replace({
            widget: new BlockWidget(span.node, hooks, (dom, next) => this.replaceBlock(dom, next)),
            block: true,
          }).range(from, span.to)
          decos.push(deco)
          atoms.push(deco)
        } else {
          const deco = Decoration.replace({ widget: new ChipWidget(span.node, hooks) }).range(span.from, span.to)
          decos.push(deco)
          atoms.push(deco)
        }
      }
    }
  }

  private replaceBlock(dom: HTMLElement, next: HeraldNode) {
    const view = this.requireView()
    const pos = view.posAtDOM(dom)
    const span = view.state
      .field(this.parsed)
      .spans.find((s) => s.kind === "atom" && s.block && view.state.doc.lineAt(s.from).from <= pos && s.to >= pos)
    if (!span) {
      return
    }
    view.dispatch({
      changes: { from: span.from, to: span.to, insert: serializeWithCursor(next).text },
      userEvent: "input",
    })
  }
}

const cleanups = new WeakMap<HTMLElement, () => void>()
const blockViews = new WeakMap<HTMLElement, { type: string; view: BlockView }>()

class ChipWidget extends WidgetType {
  constructor(
    readonly node: HeraldNode,
    readonly hooks: AdapterHooks,
  ) {
    super()
  }

  override eq(other: ChipWidget) {
    return JSON.stringify(other.node) === JSON.stringify(this.node)
  }

  toDOM() {
    const el = document.createElement("span")
    el.className = "herald-chip-host"
    cleanups.set(el, this.hooks.renderInline(this.node, el))
    return el
  }

  override destroy(dom: HTMLElement) {
    cleanups.get(dom)?.()
  }
}

class BlockWidget extends WidgetType {
  constructor(
    readonly node: HeraldNode,
    readonly hooks: AdapterHooks,
    readonly write: (dom: HTMLElement, next: HeraldNode) => void,
  ) {
    super()
  }

  override eq(other: BlockWidget) {
    return JSON.stringify(other.node) === JSON.stringify(this.node)
  }

  toDOM() {
    const el = document.createElement("div")
    el.className = "herald-block-host"
    const view = this.hooks.renderBlock(this.node, el, (next) => this.write(el, next))
    blockViews.set(el, { type: this.node.type, view })
    return el
  }

  // keeps the same DOM (and React state, and input focus) while its attrs change
  override updateDOM(dom: HTMLElement) {
    const existing = blockViews.get(dom)
    if (!existing || existing.type !== this.node.type) {
      return false
    }
    existing.view.update(this.node)
    return true
  }

  override ignoreEvent() {
    return true
  }

  override destroy(dom: HTMLElement) {
    blockViews.get(dom)?.view.destroy()
  }
}

class LabelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly cls: string,
  ) {
    super()
  }

  override eq(other: LabelWidget) {
    return other.text === this.text && other.cls === this.cls
  }

  toDOM() {
    const el = document.createElement("span")
    el.className = this.cls
    el.textContent = this.text
    return el
  }

  override ignoreEvent() {
    return false
  }
}

// CodeMirror's own base theme is unlayered, so the few properties it sets are pointed at variables here. Each has a
// fallback, so a UI layer that sets none of them (Tailwind classes only) still gets a sensible editor.
const theme = EditorView.theme({
  "&": { color: "var(--herald-fg, inherit)", backgroundColor: "transparent", fontSize: "var(--herald-font-size, inherit)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--herald-font, inherit)", lineHeight: "var(--herald-line-height, 1.6)" },
  ".cm-content": {
    padding: "var(--herald-padding, 12px 14px 12px 24px)",
    caretColor: "var(--herald-accent, currentColor)",
  },
  ".cm-line": { padding: "var(--herald-line-top, 0) 0 0 var(--herald-line-indent, 0)" },
  ".cm-placeholder": { color: "var(--herald-muted, GrayText)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--herald-selection, Highlight)",
  },
})
