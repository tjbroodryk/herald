import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type RefObject,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import {
  NodeType,
  type CompileOptions,
  type CompileResult,
  type DiagnoseOptions,
  type Diagnostic,
  type EditorAdapter,
  type EditorClasses,
  type HeraldDoc,
  type HeraldNode,
  type MentionKind,
  type Schema,
  type SelectionState,
  type SuggestionItem,
  type ToolbarItem,
  type TriggerState,
} from "@herald/core"
import { FIELD_TYPES, FieldType, type Field, type FieldShape } from "@herald/agent"
import { markdown } from "@herald/markdown"

// Headless: state and behaviour for building a Herald editor UI, no markup and no styles.
// @herald/ui (plain CSS) and the shadcn registry (Tailwind) are two looks built on these hooks.

export { DocView, type DocViewProps } from "./doc-view"

export interface TriggerDef {
  trigger: string
  /** "slash" lists every plugin's slash items, filtered by the query. A function returns its own (filtered) items. */
  items: "slash" | ((query: string, ctx: { doc: HeraldDoc; signal: AbortSignal }) => SuggestionItem[] | Promise<SuggestionItem[]>)
}

export function trigger(char: string, options: Omit<TriggerDef, "trigger">): TriggerDef {
  return { trigger: char, ...options }
}

export interface InlineViewProps {
  node: HeraldNode
  /** The mention kind, when the node is a mention. */
  kind?: MentionKind
}

export interface BlockViewProps {
  node: HeraldNode
  /** Writes a new version of the node back into the document. */
  update(node: HeraldNode): void
}

/** Per-editor overrides of how atoms render, by node type. */
export interface Views {
  inline?: Record<string, ComponentType<InlineViewProps>>
  block?: Record<string, ComponentType<BlockViewProps>>
}

/** The look a UI layer brings: a chip for inline atoms and views for block atoms (`default` for any other type). */
export interface ViewSet {
  inline: ComponentType<InlineViewProps>
  blocks: { default: ComponentType<BlockViewProps> } & Record<string, ComponentType<BlockViewProps>>
}

export interface UseEditorOptions {
  schema: Schema
  adapter: EditorAdapter
  /** A doc, or markdown text. Read once, when the editor is created. */
  content?: HeraldDoc | string
  onChange?: (doc: HeraldDoc) => void
  triggers?: TriggerDef[]
  views?: Views
}

/** Owns the adapter and the current doc. Make one with `useEditor`, or construct it yourself outside React. */
export class HeraldEditor {
  readonly schema: Schema
  readonly adapter: EditorAdapter
  readonly triggers: TriggerDef[]
  readonly views: Views
  onChange?: (doc: HeraldDoc) => void
  private doc: HeraldDoc
  private listeners = new Set<() => void>()

  constructor(options: UseEditorOptions) {
    this.schema = options.schema
    this.adapter = options.adapter
    this.triggers = options.triggers ?? [trigger("/", { items: "slash" })]
    this.views = options.views ?? {}
    this.onChange = options.onChange
    const content = options.content ?? { type: NodeType.Doc }
    this.doc = typeof content === "string" ? markdown.decode(content) : options.schema.parse(content)
  }

  getDoc = (): HeraldDoc => this.doc

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called by the adapter on every edit. */
  changed(doc: HeraldDoc) {
    this.doc = doc
    this.listeners.forEach((l) => l())
    this.onChange?.(doc)
  }

  setDoc(doc: HeraldDoc) {
    this.adapter.setDoc(doc)
  }
}

export function useEditor(options: UseEditorOptions): HeraldEditor {
  const [editor] = useState(() => new HeraldEditor(options))
  editor.onChange = options.onChange
  return editor
}

/** The current doc, re-rendering on every change. */
export function useDoc(editor: HeraldEditor): HeraldDoc {
  return useSyncExternalStore(editor.subscribe, editor.getDoc)
}

/** Which side of the trigger a menu opens on. */
export const MenuPlacement = { Top: "top", Bottom: "bottom" } as const
export type MenuPlacement = (typeof MenuPlacement)[keyof typeof MenuPlacement]

/** An open `@` or `/` menu. Render `items` in an element with `style` (fixed next to the trigger), portaled to body. */
export interface MenuState {
  trigger: string
  query: string
  items: SuggestionItem[]
  active: number
  loading: boolean
  placement: MenuPlacement
  style: CSSProperties
  kinds: Map<string, MentionKind>
  setActive(index: number): void
  select(item: SuggestionItem): void
}

/** The selection toolbar. Render `items` in an element with `style` (fixed above the selection), portaled to body. */
export interface ToolbarState {
  items: ToolbarItem[]
  marks: string[]
  style: CSSProperties
  toggle(mark: string): void
}

export interface UsePromptEditorOptions {
  views: ViewSet
  /** Class names for the editor's own parts (headings, chips, sections, drag handles). */
  classes?: EditorClasses
  /** Makes Enter submit (Shift+Enter for a new line), as in a chat input. An open menu still gets Enter first. */
  onSubmit?: (doc: HeraldDoc) => void
}

/**
 * Mounts the editor into `ref` and tracks the menu and toolbar. Put `ref` on an empty div, and stop `mousedown` from
 * taking focus on the menu and toolbar elements (`onMouseDown={(e) => e.preventDefault()}`).
 */
export function usePromptEditor(
  editor: HeraldEditor,
  options: UsePromptEditorOptions,
): { ref: RefObject<HTMLDivElement | null>; menu: MenuState | null; toolbar: ToolbarState | null } {
  const ref = useRef<HTMLDivElement>(null)
  const [trig, setTrig] = useState<TriggerState | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const menuKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null)
  const latest = useRef(options)
  latest.current = options
  // Escape closes the menu until the user starts a new trigger somewhere else
  const dismissed = useRef<number | null>(null)

  useEffect(() => {
    const { schema, views } = editor
    const set = () => latest.current.views
    editor.adapter.mount(ref.current!, editor.getDoc(), {
      triggers: editor.triggers.map((t) => t.trigger),
      classes: latest.current.classes,
      onChange: (doc) => editor.changed(doc),
      onTrigger: (t) => {
        // a dismissal only lasts while that same trigger is still being typed
        if (t?.range.from !== dismissed.current) {
          dismissed.current = null
        }
        setTrig(dismissed.current === null ? t : null)
      },
      onSelection: setSelection,
      onKeyDown: (e) => {
        if (menuKeys.current?.(e)) {
          return true
        }
        const onSubmit = latest.current.onSubmit
        if (onSubmit && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          onSubmit(editor.getDoc())
          return true
        }
        return false
      },
      renderInline: (node, target) => {
        const View = views.inline?.[node.type] ?? set().inline
        const root = createRoot(target)
        root.render(<View node={node} kind={schema.mentionKinds.get(String(node.attrs?.kind))} />)
        return () => unmountLater(root)
      },
      renderBlock: (node, target, update) => {
        const View = views.block?.[node.type] ?? set().blocks[node.type] ?? set().blocks.default
        const root = createRoot(target)
        const render = (n: HeraldNode) => root.render(<View node={n} update={update} />)
        render(node)
        return { update: render, destroy: () => unmountLater(root) }
      },
    })
    return () => editor.adapter.destroy()
  }, [editor])

  const menu = useMenu(editor, trig, menuKeys, {
    close: () => setTrig(null),
    dismiss: () => {
      dismissed.current = trig?.range.from ?? null
      setTrig(null)
    },
  })

  const toolbar: ToolbarState | null =
    selection && !selection.empty && editor.schema.toolbar.length > 0
      ? {
          items: editor.schema.toolbar,
          marks: selection.marks,
          style: { position: "fixed", left: selection.rect.left, top: selection.rect.top - 8, transform: "translateY(-100%)" },
          toggle: (mark) => editor.adapter.toggleMark(mark),
        }
      : null

  return { ref, menu, toolbar }
}

// React warns when a root unmounts while CodeMirror is mid-update; defer it.
function unmountLater(root: Root) {
  queueMicrotask(() => root.unmount())
}

/** Menus are assumed to be at most this tall when deciding to open upward. */
export const MENU_MAX_HEIGHT = 300

function useMenu(
  editor: HeraldEditor,
  trig: TriggerState | null,
  keys: { current: ((e: KeyboardEvent) => boolean) | null },
  { close, dismiss }: { close(): void; dismiss(): void },
): MenuState | null {
  const [items, setItems] = useState<SuggestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(0)
  const key = trig ? `${trig.trigger}:${trig.range.from}` : null
  const def = trig ? editor.triggers.find((t) => t.trigger === trig.trigger) : undefined

  // a new trigger starts with an empty list
  useEffect(() => {
    setItems([])
    setActive(0)
    setLoading(true)
  }, [key])

  useEffect(() => {
    if (!trig || !def) {
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const q = trig.query.toLowerCase()
    const result =
      def.items === "slash"
        ? editor.schema.slash.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q))
        : def.items(trig.query, { doc: editor.getDoc(), signal: controller.signal })
    Promise.resolve(result).then((next) => {
      if (!controller.signal.aborted) {
        setItems(next)
        setActive(0)
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [key, trig?.query])

  const select = (item: SuggestionItem) => {
    editor.adapter.insert(item.insert(), trig!.range)
    close()
  }

  keys.current = trig
    ? (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const step = e.key === "ArrowDown" ? 1 : -1
          setActive((a) => (items.length ? (a + step + items.length) % items.length : 0))
          return true
        }
        if ((e.key === "Enter" || e.key === "Tab") && items[active]) {
          select(items[active]!)
          return true
        }
        if (e.key === "Escape") {
          dismiss()
          return true
        }
        return false
      }
    : null

  if (!trig || (!loading && items.length === 0)) {
    return null
  }
  // opens upward when there's no room below, e.g. a chat input docked at the bottom
  // shortcut: no horizontal flip or collision handling; use floating-ui if menus end up near the right edge.
  const above = window.innerHeight - trig.rect.bottom < MENU_MAX_HEIGHT + 8 && trig.rect.top > MENU_MAX_HEIGHT + 8
  return {
    trigger: trig.trigger,
    query: trig.query,
    items,
    active,
    loading,
    placement: above ? MenuPlacement.Top : MenuPlacement.Bottom,
    style: above
      ? { position: "fixed", left: trig.rect.left, bottom: window.innerHeight - trig.rect.top + 4 }
      : { position: "fixed", left: trig.rect.left, top: trig.rect.bottom + 4 },
    kinds: editor.schema.mentionKinds,
    setActive,
    select,
  }
}

/** State for an editor of typed fields (the `inputs` and `outputShape` blocks). */
/**
 * Where a field sits in the tree: indexes into `fields`, with "items" stepping into an array's item shape.
 * `[2, "items", 0]` is the first field of the objects in the third field's array.
 */
export type FieldPath = (number | "items")[]

export interface FieldsApi {
  fields: Field[]
  types: FieldType[]
  /** Changes a field or an array's item shape. Switching type adds or drops `fields`/`items` to match. */
  patch(path: FieldPath, change: Partial<Field>): void
  /** Adds a field to the object at `path` (`[]` for the top level). */
  add(path: FieldPath): void
  remove(path: FieldPath): void
}

/** State for an editor of typed fields (the `inputs` and `outputShape` blocks), nested to any depth. */
export function useFields({ node, update }: BlockViewProps): FieldsApi {
  const incoming = (Array.isArray(node.attrs?.fields) ? node.attrs.fields : []) as unknown as Field[]
  // local copy so typing isn't reset while the change round-trips through the document
  const [fields, setFields] = useState(incoming)
  const key = JSON.stringify(incoming)
  useEffect(() => setFields(incoming), [key])

  const edit = (path: FieldPath, fn: (shape: FieldShape) => FieldShape) => {
    const next = (updateAt({ type: FieldType.Object, fields }, path, fn).fields ?? []) as Field[]
    setFields(next)
    update({ ...node, attrs: { ...node.attrs, fields: next as never } })
  }
  return {
    fields,
    types: FIELD_TYPES,
    patch: (path, change) => edit(path, (shape) => withType({ ...shape, ...change })),
    add: (path) =>
      edit(path, (shape) => {
        const list = shape.fields ?? []
        return { ...shape, fields: [...list, { name: `field_${list.length + 1}`, type: FieldType.String }] }
      }),
    remove: (path) => {
      const index = path.at(-1) as number
      edit(path.slice(0, -1), (shape) => ({ ...shape, fields: (shape.fields ?? []).filter((_, i) => i !== index) }))
    },
  }
}

function updateAt(shape: FieldShape, path: FieldPath, fn: (shape: FieldShape) => FieldShape): FieldShape {
  const [head, ...rest] = path
  if (head === undefined) {
    return fn(shape)
  }
  if (head === "items") {
    return { ...shape, items: updateAt(shape.items ?? { type: FieldType.String }, rest, fn) }
  }
  return {
    ...shape,
    fields: (shape.fields ?? []).map((f, i) => (i === head ? (updateAt(f, rest, fn) as Field) : f)),
  }
}

// keep children consistent with the type: objects have fields, arrays have an item shape, scalars have neither
function withType<S extends FieldShape>(shape: S): S {
  const { fields, items, ...rest } = shape
  if (shape.type === FieldType.Object) {
    return { ...rest, fields: fields ?? [] } as S
  }
  if (shape.type === FieldType.Array) {
    return { ...rest, items: items ?? { type: FieldType.String } } as S
  }
  return rest as S
}

export const InspectorTab = {
  Prompt: "prompt",
  Json: "json",
  Markdown: "markdown",
  Collected: "collected",
  Diagnostics: "diagnostics",
} as const
export type InspectorTab = (typeof InspectorTab)[keyof typeof InspectorTab]
/** The tabs in display order. */
export const INSPECTOR_TABS: InspectorTab[] = Object.values(InspectorTab)

/**
 * What the editor produces: compiled prompt, JSON, markdown, collected values and diagnostics, as text per tab.
 * Pass `compile`/`diagnose` options that are stable across renders.
 */
export function useInspector(editor: HeraldEditor, options: { compile?: CompileOptions; diagnose?: DiagnoseOptions } = {}) {
  const doc = useDoc(editor)
  const [result, setResult] = useState<CompileResult | { error: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    editor.schema
      .compile(doc, { ...options.compile, signal: controller.signal })
      .then((r) => !controller.signal.aborted && setResult(r))
      .catch((e: unknown) => !controller.signal.aborted && setResult({ error: String(e) }))
    return () => controller.abort()
  }, [doc, options.compile])

  const diagnostics: Diagnostic[] = [
    ...editor.schema.diagnose(doc, options.diagnose),
    ...(result && "diagnostics" in result ? result.diagnostics : []),
  ]
  const text = (tab: InspectorTab): string => {
    switch (tab) {
      case InspectorTab.Prompt:
        return result ? ("error" in result ? result.error : result.prompt) : "compiling…"
      case InspectorTab.Json:
        return JSON.stringify(doc, null, 2)
      case InspectorTab.Markdown:
        return markdown.encode(doc)
      case InspectorTab.Collected:
        return result && "collected" in result ? JSON.stringify(result.collected, null, 2) : ""
      case InspectorTab.Diagnostics:
        return diagnostics.length ? diagnostics.map((d) => `${d.code}  ${d.message}`).join("\n") : "no problems"
    }
  }
  return { doc, diagnostics, text }
}
