import { baseKeymap, toggleMark } from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { Fragment, Node as PMNode, Slice, type Schema as PMSchema } from "prosemirror-model"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { EditorState, Plugin, PluginKey, Selection, TextSelection, type Command, type Transaction } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view"
import {
  COMMENT_MARK,
  EditorPart,
  findTrigger,
  MarkType,
  NodeType,
  type AdapterHooks,
  type AtomView,
  type CommentAttrs,
  type EditorAdapter,
  type HeraldDoc,
  type HeraldNode,
  type Range,
  type Schema,
  type SelectionState,
  type TriggerState,
} from "@herald/core"
import { buildSchema, covers, observe, toHerald, toPM } from "./schema"

export { toHerald, toPM } from "./schema"

export interface ProseMirrorOptions {
  /**
   * Uploads a pasted or dropped image and returns its URL. A placeholder shows until it resolves; it's a decoration,
   * not a node, so a doc saved mid-upload never holds it. Without this, images go in as data URLs.
   */
  onImageFile?: (file: File) => Promise<{ src: string }>
  /** Extra ProseMirror plugins, added after Herald's. */
  plugins?: Plugin[]
}

/** A comment's thread and where it sits. `from`/`to` span its first to last character. */
export interface CommentInDoc {
  commentId: string
  attrs: CommentAttrs
  from: number
  to: number
  text: string
}

/** The editor is ProseMirror over the Herald JSON itself: no markdown in between, so long documents stay fast. */
export function prosemirror(options: ProseMirrorOptions = {}): ProseMirrorAdapter {
  return new ProseMirrorAdapter(options)
}

const draftKey = new PluginKey<Range | null>("heraldCommentDraft")
const uploadKey = new PluginKey<DecorationSet>("heraldUploads")

type UploadMeta = { add: { id: object; pos: number } } | { remove: { id: object } }

export class ProseMirrorAdapter implements EditorAdapter {
  view: EditorView | undefined
  private hooks: AdapterHooks | undefined
  private schema: PMSchema | undefined
  private editableNow = true
  private readonly atoms = new Set<AtomNodeView>()

  constructor(private readonly options: ProseMirrorOptions) {}

  parse(schema: Schema, value: unknown): HeraldDoc {
    return schema.validate(value)
  }

  private cls = (part: EditorPart) => this.hooks?.classes?.[part] ?? `herald-${part}`

  mount(el: HTMLElement, doc: HeraldDoc, hooks: AdapterHooks): void {
    this.hooks = hooks
    this.editableNow = hooks.editable
    this.schema = buildSchema(observe([doc]), this.cls)
    this.view = new EditorView(el, {
      state: this.createState(toPM(this.schema, doc)),
      editable: () => this.editableNow,
      nodeViews: this.nodeViews(),
      // ProseMirror needs pre-wrap to keep typed spaces; the rest of the look comes from the doc class
      attributes: {
        class: this.cls(EditorPart.Doc),
        style: "white-space: pre-wrap; word-wrap: break-word",
        role: "textbox",
        "aria-multiline": "true",
      },
      dispatchTransaction: (tr) => this.apply(tr),
      handleKeyDown: (_view, event) => {
        if (hooks.onKeyDown(event)) {
          event.preventDefault()
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) {
          return false
        }
        if (this.insertImageFiles([...data.files], view.state.selection.from)) {
          return true
        }
        // a copy from this editor carries the whole slice; ProseMirror's own paste keeps every mark and attr
        if (data.getData("text/html").includes("data-pm-slice")) {
          return false
        }
        const nodes = hooks.onPaste?.(data)
        if (!nodes) {
          return false
        }
        this.insertNodes(nodes)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (moved || !files.length) {
          return false
        }
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        return this.insertImageFiles(files, pos)
      },
      handleDOMEvents: {
        focus: () => this.reportSoon(),
        blur: () => this.reportSoon(),
      },
    })
  }

  destroy(): void {
    this.view?.destroy()
    this.view = undefined
  }

  getDoc(): HeraldDoc {
    return toHerald(this.requireView().state.doc) as HeraldDoc
  }

  setDoc(doc: HeraldDoc): void {
    this.ensureSchema([doc])
    const view = this.requireView()
    const next = toPM(this.schema!, doc)
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
  }

  focus(): void {
    this.view?.focus()
  }

  setEditable(editable: boolean): void {
    this.editableNow = editable
    if (!this.view) {
      return
    }
    // only contenteditable flips; the DOM and its layout stay, so the scroll position does too
    this.view.setProps({ editable: () => editable })
    this.atoms.forEach((a) => a.refresh())
    this.report()
  }

  get editable(): boolean {
    return this.editableNow
  }

  /** Inserts a node, replacing `range` (e.g. the typed `@query`) or the selection. Blocks go after the textblock. */
  insert(node: HeraldNode, range?: Range): void {
    this.ensureSchema([node])
    const view = this.requireView()
    const { state } = view
    const r = range ?? state.selection
    const pm = PMNode.fromJSON(this.schema!, node)
    const tr = state.tr
    if (pm.isInline) {
      tr.replaceWith(r.from, r.to, [pm, this.schema!.text(" ")])
      tr.setSelection(TextSelection.create(tr.doc, r.from + pm.nodeSize + 1))
    } else {
      tr.delete(r.from, r.to)
      const $pos = tr.doc.resolve(r.from)
      let at = r.from
      if ($pos.parent.isTextblock && $pos.depth > 0) {
        // an emptied textblock (a line holding just `/heading`) is replaced; otherwise the block goes after it
        at = $pos.before()
        if ($pos.parent.content.size === 0) {
          tr.replaceWith(at, $pos.after(), pm)
        } else {
          at = $pos.after()
          tr.insert(at, pm)
        }
      } else {
        tr.insert(at, pm)
      }
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))))
    }
    view.dispatch(tr.scrollIntoView())
    view.focus()
  }

  /** Inserts pasted nodes at the selection: one paragraph inline, anything else as blocks. */
  insertNodes(nodes: HeraldNode[]): void {
    this.ensureSchema(nodes)
    const view = this.requireView()
    const content = Fragment.fromArray(nodes.map((n) => PMNode.fromJSON(this.schema!, n)))
    const single = nodes.length === 1 && nodes[0]!.type === NodeType.Paragraph
    view.dispatch(view.state.tr.replaceSelection(new Slice(content, single ? 1 : 0, single ? 1 : 0)).scrollIntoView())
  }

  toggleMark(mark: string): void {
    const view = this.requireView()
    const type = this.schema!.marks[mark]
    if (type) {
      toggleMark(type)(view.state, view.dispatch)
      view.focus()
    }
  }

  /** Puts a comment on `range`. Comments can overlap. */
  addComment(range: Range, attrs: CommentAttrs): void {
    const view = this.requireView()
    view.dispatch(view.state.tr.addMark(range.from, range.to, this.schema!.marks[COMMENT_MARK]!.create(attrs)))
  }

  /** Changes a comment's thread wherever it is. Returns false when no text carries it. */
  updateComment(commentId: string, attrs: Partial<Omit<CommentAttrs, "commentId">>): boolean {
    return this.eachComment(commentId, (tr, from, to, mark) => {
      tr.removeMark(from, to, mark)
      tr.addMark(from, to, mark.type.create({ ...mark.attrs, ...attrs, commentId }))
    })
  }

  /** Removes a comment and keeps its text. Returns false when no text carries it. */
  removeComment(commentId: string): boolean {
    return this.eachComment(commentId, (tr, from, to, mark) => tr.removeMark(from, to, mark))
  }

  commentsInDoc(): CommentInDoc[] {
    const out = new Map<string, CommentInDoc>()
    this.requireView().state.doc.descendants((node, pos) => {
      if (!node.isText) {
        return
      }
      for (const mark of node.marks) {
        const id = mark.attrs.commentId
        if (mark.type.name !== COMMENT_MARK || typeof id !== "string") {
          continue
        }
        const seen = out.get(id)
        if (seen) {
          seen.text += (pos > seen.to ? " " : "") + node.text
          seen.to = pos + node.nodeSize
        } else {
          out.set(id, { commentId: id, attrs: mark.attrs as CommentAttrs, from: pos, to: pos + node.nodeSize, text: node.text! })
        }
      }
    })
    return [...out.values()]
  }

  /**
   * Highlights the range a comment is being written about, so it stays visible while focus is in the composer. Not
   * stored in the doc or the undo history; null clears it. The thread the caret is in is highlighted on its own.
   */
  setCommentDraft(range: Range | null): void {
    const view = this.requireView()
    const current = draftKey.getState(view.state) ?? null
    if (current?.from === range?.from && current?.to === range?.to) {
      return
    }
    view.dispatch(view.state.tr.setMeta(draftKey, range).setMeta("addToHistory", false))
  }

  /** Inserts image files at `pos`, through `onImageFile` when set. Returns false when none of them are images. */
  insertImageFiles(files: File[], pos: number): boolean {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (!images.length) {
      return false
    }
    const upload = this.options.onImageFile ?? readDataUrl
    for (const file of images) {
      const id = {}
      const view = this.requireView()
      view.dispatch(view.state.tr.setMeta(uploadKey, { add: { id, pos } } satisfies UploadMeta).setMeta("addToHistory", false))
      const settle = (src: string | null) => {
        const view = this.view
        if (!view) {
          return
        }
        const found = uploadKey.getState(view.state)?.find(undefined, undefined, (spec) => spec.id === id)[0]
        const tr = view.state.tr.setMeta(uploadKey, { remove: { id } } satisfies UploadMeta)
        if (found && src) {
          tr.replaceRangeWith(found.from, found.from, this.schema!.nodes[NodeType.Image]!.create({ src }))
        }
        view.dispatch(tr)
      }
      upload(file).then(
        ({ src }) => settle(src),
        () => settle(null),
      )
    }
    return true
  }

  private eachComment(commentId: string, fn: (tr: Transaction, from: number, to: number, mark: PMNode["marks"][number]) => void) {
    const view = this.requireView()
    const tr = view.state.tr
    let found = false
    view.state.doc.descendants((node, pos) => {
      const mark = node.isText ? node.marks.find((m) => m.type.name === COMMENT_MARK && m.attrs.commentId === commentId) : undefined
      if (mark) {
        found = true
        fn(tr, pos, pos + node.nodeSize, mark)
      }
    })
    if (found) {
      view.dispatch(tr)
    }
    return found
  }

  private createState(doc: PMNode): EditorState {
    const schema = doc.type.schema
    const nodes = schema.nodes
    const mark = (name: string): Command => (state, dispatch) =>
      schema.marks[name] ? toggleMark(schema.marks[name]!)(state, dispatch) : false
    return EditorState.create({
      doc,
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-y": redo,
          "Mod-b": mark(MarkType.Bold),
          "Mod-i": mark(MarkType.Italic),
          "Mod-e": mark(MarkType.Code),
          Enter: splitListItem(nodes[NodeType.ListItem]!),
          Tab: sinkListItem(nodes[NodeType.ListItem]!),
          "Shift-Tab": liftListItem(nodes[NodeType.ListItem]!),
          "Shift-Enter": (state, dispatch) => {
            dispatch?.(state.tr.replaceSelectionWith(nodes[NodeType.HardBreak]!.create()).scrollIntoView())
            return true
          },
        }),
        keymap(baseKeymap),
        this.commentPlugin(),
        this.uploadPlugin(),
        ...(this.options.plugins ?? []),
      ],
    })
  }

  // the thread under the caret and the draft range: view state, never written into the doc
  private commentPlugin() {
    return new Plugin<Range | null>({
      key: draftKey,
      state: {
        init: () => null,
        apply(tr, value) {
          const meta = tr.getMeta(draftKey) as Range | null | undefined
          if (meta !== undefined) {
            return meta
          }
          if (!value || !tr.docChanged) {
            return value
          }
          const from = tr.mapping.map(value.from)
          const to = tr.mapping.map(value.to)
          // the words were deleted; a zero-width highlight would be a stray sliver
          return from < to ? { from, to } : null
        },
      },
      props: {
        decorations: (state) => {
          const decos: Decoration[] = []
          const draft = draftKey.getState(state)
          if (draft) {
            decos.push(Decoration.inline(draft.from, draft.to, { class: this.cls(EditorPart.CommentDraft) }))
          }
          // comment marks aren't inclusive, so this is a thread only when the caret is inside it, not at its edge
          const active = state.selection.$from.marks().find((m) => m.type.name === COMMENT_MARK)?.attrs.commentId
          if (typeof active === "string") {
            state.doc.descendants((node, pos) => {
              if (node.isText && node.marks.some((m) => m.type.name === COMMENT_MARK && m.attrs.commentId === active)) {
                decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: this.cls(EditorPart.CommentActive) }))
              }
            })
          }
          return decos.length ? DecorationSet.create(state.doc, decos) : null
        },
      },
    })
  }

  private uploadPlugin() {
    return new Plugin<DecorationSet>({
      key: uploadKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => {
          let next = set.map(tr.mapping, tr.doc)
          const meta = tr.getMeta(uploadKey) as UploadMeta | undefined
          if (meta && "add" in meta) {
            const el = document.createElement("div")
            el.className = this.cls(EditorPart.ImagePlaceholder)
            next = next.add(tr.doc, [Decoration.widget(meta.add.pos, el, { id: meta.add.id })])
          } else if (meta) {
            next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove.id))
          }
          return next
        },
      },
      props: { decorations: (state) => uploadKey.getState(state) },
    })
  }

  // atoms the UI layer draws: mentions, images, unknown leaves, and block types it overrides (a table grid)
  private nodeViews(): Record<string, (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
    const out: Record<string, (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView> = {}
    const overrides = new Set(this.hooks!.blockOverrides)
    for (const type of Object.values(this.schema!.nodes)) {
      const name = type.name
      const atom = type.isLeaf && name !== NodeType.Text && name !== NodeType.HardBreak && name !== NodeType.HorizontalRule
      if (atom || overrides.has(name)) {
        out[name] = (node, _view, getPos) => new AtomNodeView(node, this, type.isInline, getPos)
      }
    }
    return out
  }

  /** @internal Draws an atom through the hooks. */
  renderAtom(node: PMNode, el: HTMLElement, inline: boolean, getPos: () => number | undefined): AtomView {
    const hooks = this.hooks!
    const json = toHerald(node)
    return inline
      ? hooks.renderInline(json, el, this.editableNow)
      : hooks.renderBlock(json, el, (next) => this.replaceAt(getPos(), next), this.editableNow)
  }

  /** @internal */
  track(atom: AtomNodeView, live: boolean) {
    if (live) {
      this.atoms.add(atom)
    } else {
      this.atoms.delete(atom)
    }
  }

  // a block view's update(next): new attrs in place, or the whole node when its content changed (a table grid edit)
  private replaceAt(pos: number | undefined, next: HeraldNode) {
    const view = this.view
    if (!view || pos === undefined || !this.editableNow) {
      return
    }
    this.ensureSchema([next])
    const current = view.state.doc.nodeAt(pos)
    if (!current) {
      return
    }
    const pm = PMNode.fromJSON(this.schema!, next)
    const tr = view.state.tr
    if (current.type === pm.type && current.content.eq(pm.content)) {
      tr.setNodeMarkup(pos, undefined, pm.attrs, pm.marks)
    } else {
      tr.replaceWith(pos, pos + current.nodeSize, pm)
    }
    view.dispatch(tr)
  }

  // a doc (or an inserted node) can bring a node type, mark or attr the schema hasn't seen; rebuild it to hold them
  private ensureSchema(nodes: HeraldNode[]) {
    const view = this.requireView()
    if (covers(this.schema!, nodes)) {
      return
    }
    const current = toHerald(view.state.doc)
    this.schema = buildSchema(observe([current, ...nodes]), this.cls)
    const head = view.state.selection.head
    // shortcut: the rebuilt state starts a new undo history; keep it if unknown types turn up mid-session often
    const state = this.createState(toPM(this.schema, current))
    view.setProps({ nodeViews: this.nodeViews() })
    view.updateState(
      state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(Math.min(head, state.doc.content.size))))),
    )
  }

  private apply(tr: Transaction) {
    const view = this.requireView()
    view.updateState(view.state.apply(tr))
    if (tr.docChanged) {
      this.hooks!.onChange(this.getDoc())
    }
    if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) {
      this.report()
    }
  }

  private reportSoon() {
    queueMicrotask(() => this.view && this.report())
    return false
  }

  private report() {
    const view = this.requireView()
    this.hooks!.onTrigger(this.trigger(view))
    this.hooks!.onSelection(this.selection(view))
  }

  private trigger(view: EditorView): TriggerState | null {
    const sel = view.state.selection
    if (!this.editableNow || !view.hasFocus() || !sel.empty) {
      return null
    }
    const $from = sel.$from
    if (!$from.parent.isTextblock || $from.parent.type.spec.code) {
      return null
    }
    // atoms count as one character, so offsets in the text are offsets into the textblock
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, (n) =>
      n.type.name === NodeType.HardBreak ? "\n" : "￼",
    )
    const found = findTrigger(before, this.hooks!.triggers)
    if (!found) {
      return null
    }
    const from = $from.start() + found.at
    const coords = view.coordsAtPos(from)
    return {
      trigger: found.trigger,
      query: found.query,
      range: { from, to: sel.head },
      rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
    }
  }

  private selection(view: EditorView): SelectionState {
    const { state } = view
    const { from, to, empty, $from } = state.selection
    const marks = Object.values(state.schema.marks)
      .filter((type) => {
        if (empty) {
          return !!type.isInSet(state.storedMarks ?? $from.marks())
        }
        let any = false
        let all = true
        state.doc.nodesBetween(from, to, (n) => {
          if (n.isText) {
            any = true
            all &&= !!type.isInSet(n.marks)
          }
        })
        return any && all
      })
      .map((t) => t.name)
    if (empty || !view.hasFocus()) {
      return { empty: true, rect: { left: 0, right: 0, top: 0, bottom: 0 }, marks }
    }
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    return {
      empty: false,
      rect: {
        left: Math.min(start.left, end.left),
        right: Math.max(start.right, end.right),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
      },
      marks,
    }
  }

  private requireView(): EditorView {
    if (!this.view) {
      throw new Error("herald: the editor is not mounted")
    }
    return this.view
  }
}

/** A node the UI layer draws (a chip, an image, a table grid). ProseMirror leaves its DOM alone. */
class AtomNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly atom: AtomView

  constructor(
    private node: PMNode,
    private readonly adapter: ProseMirrorAdapter,
    inline: boolean,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement(inline ? "span" : "div")
    this.dom.className = inline ? "herald-chip-host" : "herald-block-host"
    this.dom.contentEditable = "false"
    this.atom = adapter.renderAtom(node, this.dom, inline, getPos)
    adapter.track(this, true)
  }

  // keeps the same DOM (and React state, and input focus) while attrs change
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false
    }
    this.node = node
    this.refresh()
    return true
  }

  refresh() {
    this.atom.update(toHerald(this.node), this.adapter.editable)
  }

  // inputs inside a block view (a grid cell, a field name) handle their own events; clicks elsewhere select the node
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return !!target?.closest?.("input, textarea, select, button, [contenteditable='true']")
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy() {
    this.atom.destroy()
    this.adapter.track(this, false)
  }
}

function readDataUrl(file: File): Promise<{ src: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ src: String(reader.result) })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
