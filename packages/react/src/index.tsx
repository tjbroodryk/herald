import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import type {
  CompileOptions,
  CompileResult,
  DiagnoseOptions,
  Diagnostic,
  EditorAdapter,
  HeraldDoc,
  HeraldNode,
  MentionKind,
  Schema,
  SelectionState,
  SuggestionItem,
  TriggerState,
} from "@herald/core"
import { markdown } from "@herald/markdown"
import { FieldsBlock, JsonBlock, MentionChip, type BlockViewProps, type InlineViewProps } from "./views"

export { FieldsBlock, JsonBlock, MentionChip, type BlockViewProps, type InlineViewProps } from "./views"
export { DocView, type DocViewProps } from "./doc-view"

export interface TriggerDef {
  trigger: string
  /** "slash" lists every plugin's slash items, filtered by the query. A function returns its own (filtered) items. */
  items: "slash" | ((query: string, ctx: { doc: HeraldDoc; signal: AbortSignal }) => SuggestionItem[] | Promise<SuggestionItem[]>)
}

export function trigger(char: string, options: Omit<TriggerDef, "trigger">): TriggerDef {
  return { trigger: char, ...options }
}

export interface Views {
  /** Inline atoms by node type. Mentions default to MentionChip. */
  inline?: Record<string, ComponentType<InlineViewProps>>
  /** Block atoms by node type. `inputs` and `outputShape` default to FieldsBlock, anything else to JsonBlock. */
  block?: Record<string, ComponentType<BlockViewProps>>
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
    const content = options.content ?? { type: "doc" }
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

export interface MenuProps {
  items: SuggestionItem[]
  active: number
  loading: boolean
  query: string
  kinds: Map<string, MentionKind>
  onHover(index: number): void
  onSelect(item: SuggestionItem): void
}

export interface ToolbarProps {
  editor: HeraldEditor
  marks: string[]
}

export interface PromptEditorProps {
  editor: HeraldEditor
  className?: string
  style?: CSSProperties
  /** Extra classes for the parts. */
  classNames?: { root?: string; menu?: string; toolbar?: string }
  /** Replace the default menu or selection toolbar. They get the same props the defaults use. */
  components?: { Menu?: ComponentType<MenuProps>; Toolbar?: ComponentType<ToolbarProps> }
  /** Drop the `herald` class so none of the default stylesheet applies. */
  unstyled?: boolean
  /** Makes Enter submit (Shift+Enter for a new line), as in a chat input. An open menu still gets Enter first. */
  onSubmit?: (doc: HeraldDoc) => void
}

export function PromptEditor(props: PromptEditorProps) {
  const { editor, className, style, classNames, components, unstyled } = props
  const host = useRef<HTMLDivElement>(null)
  const [trig, setTrig] = useState<TriggerState | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const menuKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null)
  const onSubmit = useRef(props.onSubmit)
  onSubmit.current = props.onSubmit
  // Escape closes the menu until the user starts a new trigger somewhere else
  const dismissed = useRef<number | null>(null)
  const scope = unstyled ? "" : "herald"

  useEffect(() => {
    const el = host.current!
    const { schema, views } = editor
    editor.adapter.mount(el, editor.getDoc(), {
      triggers: editor.triggers.map((t) => t.trigger),
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
        if (onSubmit.current && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          onSubmit.current(editor.getDoc())
          return true
        }
        return false
      },
      renderInline: (node, target) => {
        const View = views.inline?.[node.type] ?? MentionChip
        const root = createRoot(target)
        root.render(<View node={node} kind={schema.mentionKinds.get(String(node.attrs?.kind))} />)
        return () => unmountLater(root)
      },
      renderBlock: (node, target, update) => {
        const View = views.block?.[node.type] ?? DEFAULT_BLOCKS[node.type] ?? JsonBlock
        const root = createRoot(target)
        const render = (n: HeraldNode) => root.render(<View node={n} update={update} />)
        render(node)
        return { update: render, destroy: () => unmountLater(root) }
      },
    })
    return () => editor.adapter.destroy()
  }, [editor])

  const Menu = components?.Menu ?? SuggestionMenu
  const Toolbar = components?.Toolbar ?? SelectionToolbar
  return (
    <div
      className={[scope && "herald-editor", className, classNames?.root].filter(Boolean).join(" ")}
      style={style}
    >
      <div ref={host} className={scope && "herald-editor-host"} />
      {trig && (
        <MenuHost
          key={`${trig.trigger}:${trig.range.from}`}
          editor={editor}
          state={trig}
          Menu={Menu}
          className={[scope && "herald-floating herald-menu", classNames?.menu].filter(Boolean).join(" ")}
          keys={menuKeys}
          close={() => setTrig(null)}
          dismiss={() => {
            dismissed.current = trig.range.from
            setTrig(null)
          }}
        />
      )}
      {selection && !selection.empty && editor.schema.toolbar.length > 0 &&
        createPortal(
          <div
            className={[scope && "herald-floating herald-toolbar", classNames?.toolbar].filter(Boolean).join(" ")}
            style={{ position: "fixed", left: selection.rect.left, top: selection.rect.top - 8, transform: "translateY(-100%)" }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Toolbar editor={editor} marks={selection.marks} />
          </div>,
          document.body,
        )}
    </div>
  )
}

// React warns when a root unmounts while CodeMirror is mid-update; defer it.
function unmountLater(root: Root) {
  queueMicrotask(() => root.unmount())
}

// matches .herald-menu max-height in styles.css
const MENU_MAX_HEIGHT = 300

const DEFAULT_BLOCKS: Record<string, ComponentType<BlockViewProps>> = {
  inputs: FieldsBlock,
  outputShape: FieldsBlock,
}

function MenuHost(props: {
  editor: HeraldEditor
  state: TriggerState
  Menu: ComponentType<MenuProps>
  className: string
  keys: { current: ((e: KeyboardEvent) => boolean) | null }
  /** After picking an item. */
  close(): void
  /** Escape: keep this trigger closed while it's still being typed. */
  dismiss(): void
}) {
  const { editor, state, Menu, keys, close, dismiss } = props
  const [items, setItems] = useState<SuggestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(0)
  const def = editor.triggers.find((t) => t.trigger === state.trigger)

  useEffect(() => {
    if (!def) {
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const q = state.query.toLowerCase()
    const result =
      def.items === "slash"
        ? editor.schema.slash.filter((i) => i.label.toLowerCase().includes(q) || i.id.includes(q))
        : def.items(state.query, { doc: editor.getDoc(), signal: controller.signal })
    Promise.resolve(result).then((next) => {
      if (!controller.signal.aborted) {
        setItems(next)
        setActive(0)
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [def, state.query])

  const select = (item: SuggestionItem) => {
    editor.adapter.insert(item.insert(), state.range)
    close()
  }

  keys.current = (e) => {
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
  useEffect(() => () => void (keys.current = null), [])

  if (!loading && items.length === 0) {
    return null
  }
  // opens upward when there's no room below, e.g. a chat input docked at the bottom
  // shortcut: no horizontal flip or collision handling; use floating-ui if menus end up near the right edge.
  const above = window.innerHeight - state.rect.bottom < MENU_MAX_HEIGHT + 8 && state.rect.top > MENU_MAX_HEIGHT + 8
  const position: CSSProperties = above
    ? { position: "fixed", left: state.rect.left, bottom: window.innerHeight - state.rect.top + 4 }
    : { position: "fixed", left: state.rect.left, top: state.rect.bottom + 4 }
  return createPortal(
    <div
      className={props.className}
      data-placement={above ? "top" : "bottom"}
      style={position}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Menu
        items={items}
        active={active}
        loading={loading}
        query={state.query}
        kinds={editor.schema.mentionKinds}
        onHover={setActive}
        onSelect={select}
      />
    </div>,
    document.body,
  )
}

export function SuggestionMenu({ items, active, loading, kinds, onHover, onSelect }: MenuProps) {
  if (loading && items.length === 0) {
    return <div className="herald-menu-empty">loading…</div>
  }
  return (
    <ul role="listbox" className="herald-menu-list">
      {items.map((item, i) => {
        const kind = item.kind ? kinds.get(item.kind) : undefined
        return (
          <li
            key={item.id}
            role="option"
            aria-selected={i === active}
            data-active={i === active || undefined}
            className="herald-menu-item"
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(item)}
          >
            {kind && <span className="herald-dot" style={{ "--herald-kind-color": kind.color } as CSSProperties} />}
            <span className="herald-menu-label">{item.label}</span>
            {(item.detail ?? kind?.label) && <span className="herald-menu-detail">{item.detail ?? kind?.label}</span>}
          </li>
        )
      })}
    </ul>
  )
}

export function SelectionToolbar({ editor, marks }: ToolbarProps) {
  return (
    <>
      {editor.schema.toolbar.map((t) => (
        <button
          key={t.mark}
          type="button"
          title={t.title}
          aria-pressed={marks.includes(t.mark)}
          data-mark={t.mark}
          className="herald-toolbar-button"
          onClick={() => editor.adapter.toggleMark(t.mark)}
        >
          {t.label}
        </button>
      ))}
    </>
  )
}

export interface InspectorProps {
  editor: HeraldEditor
  compile?: CompileOptions
  diagnose?: DiagnoseOptions
  className?: string
}

const TABS = ["prompt", "json", "markdown", "collected", "diagnostics"] as const

/** Shows what the editor produces: the compiled prompt, the JSON state, its markdown, collected values and diagnostics. */
export function Inspector({ editor, compile, diagnose, className }: InspectorProps) {
  const doc = useDoc(editor)
  const [tab, setTab] = useState<(typeof TABS)[number]>("prompt")
  const [result, setResult] = useState<CompileResult | { error: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    editor.schema
      .compile(doc, { ...compile, signal: controller.signal })
      .then((r) => !controller.signal.aborted && setResult(r))
      .catch((e: unknown) => !controller.signal.aborted && setResult({ error: String(e) }))
    return () => controller.abort()
  }, [doc, compile])

  const diagnostics: Diagnostic[] = [
    ...editor.schema.diagnose(doc, diagnose),
    ...(result && "diagnostics" in result ? result.diagnostics : []),
  ]
  const body = () => {
    switch (tab) {
      case "prompt":
        return result ? ("error" in result ? result.error : result.prompt) : "compiling…"
      case "json":
        return JSON.stringify(doc, null, 2)
      case "markdown":
        return markdown.encode(doc)
      case "collected":
        return result && "collected" in result ? JSON.stringify(result.collected, null, 2) : ""
      case "diagnostics":
        return diagnostics.length ? diagnostics.map((d) => `${d.code}  ${d.message}`).join("\n") : "no problems"
    }
  }
  return (
    <div className={["herald-inspector", className].filter(Boolean).join(" ")}>
      <div role="tablist" className="herald-inspector-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
            {t === "diagnostics" && diagnostics.length > 0 && <span className="herald-count">{diagnostics.length}</span>}
          </button>
        ))}
      </div>
      <pre className="herald-inspector-body">{body()}</pre>
    </div>
  )
}
