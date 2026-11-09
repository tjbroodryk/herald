import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { Compartment, EditorState, Prec, RangeSet, StateField, type Extension, type Range as CMRange } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  keymap,
  placeholder as placeholderExt,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view"
import {
  findTrigger,
  MarkType,
  NodeType,
  type AdapterHooks,
  type AtomView,
  type EditorAdapter,
  type EditorPart,
  type HeraldDoc,
  type HeraldNode,
  type Range,
  type Schema,
} from "@herald/core"
import { isInlineAtom, parseMarkdown, serializeMarkdown, serializeWithCursor, SpanKind, type ParseResult, type Span } from "@herald/markdown"
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

const DELIMS: Record<string, string> = { [MarkType.Bold]: "**", [MarkType.Italic]: "*", [MarkType.Strike]: "~~", [MarkType.Code]: "`" }

export class CodeMirrorAdapter implements EditorAdapter {
  view: EditorView | undefined
  private parsed = StateField.define<ParseResult>({
    create: (state) => parseMarkdown(state.doc.toString()),
    update: (value, tr) => (tr.docChanged ? parseMarkdown(tr.state.doc.toString()) : value),
  })

  private cls: (key: EditorPart) => string = (key) => `herald-${key}`
  private readonly editable = new Compartment()
  private editableNow = true

  constructor(private readonly options: CodeMirrorOptions) {}

  parse(schema: Schema, value: unknown): HeraldDoc {
    return schema.parse(value)
  }

  // read-only: no caret, no edits, no drag handles
  private editableExtensions(editable: boolean): Extension {
    return [
      EditorView.editable.of(editable),
      EditorState.readOnly.of(!editable),
      editable && this.options.draggable !== false ? dragBlocks(this.parsed, this.cls) : [],
    ]
  }

  setEditable(editable: boolean): void {
    this.editableNow = editable
    this.view?.dispatch({ effects: this.editable.reconfigure(this.editableExtensions(editable)) })
  }

  mount(el: HTMLElement, doc: HeraldDoc, hooks: AdapterHooks): void {
    this.cls = (key) => hooks.classes?.[key] ?? `herald-${key}`
    this.editableNow = hooks.editable
    const parsed = this.parsed
    const decorations = StateField.define<{ decos: DecorationSet; atoms: RangeSet<Decoration> }>({
      create: (state) => this.decorate(state, hooks),
      update: (value, tr) =>
        tr.docChanged || tr.selection || tr.reconfigured ? this.decorate(tr.state, hooks) : value,
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
              paste: (event) => {
                const nodes = event.clipboardData && hooks.onPaste?.(event.clipboardData)
                if (!nodes) {
                  return false
                }
                event.preventDefault()
                this.insertNodes(nodes)
                return true
              },
            }),
          ),
          this.editable.of(this.editableExtensions(hooks.editable)),
          keymap.of([
            { key: "Mod-b", run: markKey(MarkType.Bold) },
            { key: "Mod-i", run: markKey(MarkType.Italic) },
            { key: "Mod-e", run: markKey(MarkType.Code) },
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

  /** Inserts pasted nodes at the selection: one paragraph inline, anything else as blocks on their own lines. */
  insertNodes(nodes: HeraldNode[]): void {
    const view = this.requireView()
    const { from, to } = view.state.selection.main
    const text = serializeMarkdown({ type: NodeType.Doc, content: nodes }).trimEnd()
    const single = nodes.length === 1 && nodes[0]!.type === NodeType.Paragraph
    let insert = text
    if (!single) {
      // blocks need blank lines between them and the text around the selection
      const before = view.state.doc.lineAt(from)
      const after = view.state.doc.lineAt(to)
      const textBefore = before.text.slice(0, from - before.from)
      const textAfter = after.text.slice(to - after.from)
      insert = (textBefore.trim() ? "\n\n" : "") + text + (textAfter.trim() ? "\n\n" : "")
    }
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    })
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
      .spans.find((s) => s.kind === SpanKind.Style && s.key === mark && s.from <= from && s.to >= to)
    if (active) {
      const len = mark === MarkType.Code ? 1 : delim.length
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
    if (!view.hasFocus || !sel.empty || !this.editableNow) {
      return null
    }
    const line = view.state.doc.lineAt(sel.head)
    const found = findTrigger(line.text.slice(0, sel.head - line.from), triggers)
    if (!found) {
      return null
    }
    const from = line.from + found.at
    const coords = view.coordsAtPos(from)
    if (!coords) {
      return null
    }
    return {
      trigger: found.trigger,
      query: found.query,
      range: { from, to: sel.head },
      rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
    }
  }

  private selection(view: EditorView) {
    const sel = view.state.selection.main
    const start = view.coordsAtPos(sel.from)
    const end = view.coordsAtPos(sel.to)
    const marks = view.state
      .field(this.parsed)
      .spans.flatMap((s) => (s.kind === SpanKind.Style && s.from <= sel.from && s.to >= sel.to ? [s.key] : []))
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
    const editable = state.facet(EditorView.editable)
    // read-only never shows markdown source; neither does a block the UI layer draws and edits itself
    const revealed = (r: Range) => editable && sel.some((s) => s.from <= r.to && s.to >= r.from)
    const owned = (s: Span) => s.kind === SpanKind.Preview && hooks.blockOverrides.includes(s.node.type)
    const decos: CMRange<Decoration>[] = []
    const atoms: CMRange<Decoration>[] = []
    // a rendered preview (a table) replaces its text, so nothing inside it gets decorated
    const previews = spans.filter((s) => s.kind === SpanKind.Preview && (owned(s) || !revealed(s.reveal)))
    const covered = (s: Span) =>
      s.kind !== SpanKind.Preview && s.kind !== SpanKind.Block && previews.some((p) => s.from >= p.from && s.to <= p.to)
    for (const span of spans) {
      if (covered(span)) {
        continue
      }
      if (owned(span)) {
        // an atom like a herald:type block: drawn by the UI layer, written back through update()
        const node = (span as Extract<Span, { kind: typeof SpanKind.Preview }>).node
        const deco = Decoration.replace({
          widget: new BlockWidget(node, hooks, editable, (dom, next) => this.replaceBlock(dom, next)),
          block: true,
        }).range(state.doc.lineAt(span.from).from, span.to)
        decos.push(deco)
        atoms.push(deco)
        continue
      }
      this.decorateSpan(state, span, hooks, editable, revealed, decos, atoms)
    }
    return { decos: Decoration.set(decos, true), atoms: Decoration.set(atoms, true) }
  }

  private decorateSpan(
    state: EditorState,
    span: Span,
    hooks: AdapterHooks,
    editable: boolean,
    revealed: (r: Range) => boolean,
    decos: CMRange<Decoration>[],
    atoms: CMRange<Decoration>[],
  ) {
    const doc = state.doc
    switch (span.kind) {
      case SpanKind.Hide:
        if (span.to > span.from && !revealed(span.reveal)) {
          decos.push(Decoration.replace({}).range(span.from, span.to))
        }
        return
      case SpanKind.Style:
        if (span.to > span.from) {
          decos.push(Decoration.mark({ class: this.cls(span.key) }).range(span.from, span.to))
        }
        return
      case SpanKind.Lines: {
        const last = doc.lineAt(Math.max(span.from, span.to - 1)).number
        for (let n = doc.lineAt(span.from).number; n <= last; n++) {
          decos.push(Decoration.line({ class: this.cls(span.key), attributes: span.attrs }).range(doc.line(n).from))
        }
        return
      }
      case SpanKind.Label:
        if (!revealed(span.reveal)) {
          decos.push(
            Decoration.replace({ widget: new LabelWidget(span.text, this.cls(span.key)) }).range(span.from, span.to),
          )
        }
        return
      case SpanKind.Atom: {
        if (span.block) {
          const from = doc.lineAt(span.from).from
          const deco = Decoration.replace({
            widget: new BlockWidget(span.node, hooks, editable, (dom, next) => this.replaceBlock(dom, next)),
            block: true,
          }).range(from, span.to)
          decos.push(deco)
          atoms.push(deco)
        } else {
          const deco = Decoration.replace({ widget: new ChipWidget(span.node, hooks, editable) }).range(span.from, span.to)
          decos.push(deco)
          atoms.push(deco)
        }
        return
      }
      case SpanKind.Preview:
        // not atomic: clicking or arrowing into it moves the cursor inside, which shows the source
        if (!revealed(span.reveal)) {
          decos.push(
            Decoration.replace({
              widget: new PreviewWidget(span.node, hooks, editable, (dom, next) => this.replaceBlock(dom, next)),
              block: true,
            }).range(
              doc.lineAt(span.from).from,
              span.to,
            ),
          )
        }
    }
  }

  private replaceBlock(dom: HTMLElement, next: HeraldNode) {
    const view = this.requireView()
    const pos = view.posAtDOM(dom)
    const span = view.state
      .field(this.parsed)
      .spans.find(
        (s) =>
          ((s.kind === SpanKind.Atom && s.block) || s.kind === SpanKind.Preview) &&
          view.state.doc.lineAt(s.from).from <= pos &&
          s.to >= pos,
      )
    if (!span) {
      return
    }
    view.dispatch({
      changes: { from: span.from, to: span.to, insert: serializeWithCursor(next).text },
      userEvent: "input",
    })
  }
}

const atomViews = new WeakMap<HTMLElement, { type: string; view: AtomView }>()

/** A node drawn by the UI layer. Keeps the same DOM (and React state, and input focus) while its attrs change. */
abstract class AtomWidget extends WidgetType {
  constructor(
    readonly node: HeraldNode,
    readonly hooks: AdapterHooks,
    readonly editable: boolean,
  ) {
    super()
  }

  protected abstract render(el: HTMLElement): AtomView

  protected host(tag: string, className: string): HTMLElement {
    const el = document.createElement(tag)
    el.className = className
    atomViews.set(el, { type: this.node.type, view: this.render(el) })
    return el
  }

  override eq(other: AtomWidget) {
    return other.editable === this.editable && JSON.stringify(other.node) === JSON.stringify(this.node)
  }

  override updateDOM(dom: HTMLElement) {
    const existing = atomViews.get(dom)
    if (!existing || existing.type !== this.node.type) {
      return false
    }
    existing.view.update(this.node, this.editable)
    return true
  }

  override destroy(dom: HTMLElement) {
    atomViews.get(dom)?.view.destroy()
  }
}

class ChipWidget extends AtomWidget {
  protected render(el: HTMLElement) {
    return this.hooks.renderInline(this.node, el, this.editable)
  }

  toDOM() {
    return this.host("span", "herald-chip-host")
  }
}

class BlockWidget extends AtomWidget {
  constructor(
    node: HeraldNode,
    hooks: AdapterHooks,
    editable: boolean,
    readonly write: (dom: HTMLElement, next: HeraldNode) => void,
  ) {
    super(node, hooks, editable)
  }

  protected render(el: HTMLElement) {
    return this.hooks.renderBlock(this.node, el, (next) => this.write(el, next), this.editable)
  }

  toDOM() {
    return this.host("div", "herald-block-host")
  }

  override ignoreEvent() {
    return true
  }
}

/** A rendering of a block (a table, an image) that gives way to its source when the cursor goes inside. */
class PreviewWidget extends BlockWidget {
  override toDOM() {
    return this.host("div", "herald-preview-host")
  }

  // let CodeMirror handle clicks, so a click places the cursor inside and reveals the source
  override ignoreEvent() {
    return false
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
