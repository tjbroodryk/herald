import { useState, type ComponentType, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import type { CompileOptions, DiagnoseOptions, HeraldDoc, Schema } from "@herald/core"
import {
  DocView as HeadlessDocView,
  INSPECTOR_TABS,
  InspectorTab,
  useInspector,
  usePromptEditor,
  type HeraldEditor,
  type MenuState,
  type ToolbarState,
  type Views,
} from "@herald/react"
import { views } from "./views"

// The ready-styled look: plain CSS classes, themed with --herald-* variables in styles.css.

export { FieldsBlock, ImageBlock, JsonBlock, MentionChip, TablePreview, views } from "./views"
export { trigger, useDoc, useEditor, type HeraldEditor, type TriggerDef } from "@herald/react"

export interface PromptEditorProps {
  editor: HeraldEditor
  className?: string
  style?: CSSProperties
  /** Extra classes for the parts. */
  classNames?: { root?: string; menu?: string; toolbar?: string }
  /** Replace the default menu or selection toolbar. They get the same state the defaults use. */
  components?: { Menu?: ComponentType<{ menu: MenuState }>; Toolbar?: ComponentType<{ toolbar: ToolbarState }> }
  /** Makes Enter submit (Shift+Enter for a new line), as in a chat input. An open menu still gets Enter first. */
  onSubmit?: (doc: HeraldDoc) => void
}

export function PromptEditor({ editor, className, style, classNames, components, onSubmit }: PromptEditorProps) {
  const { ref, menu, toolbar } = usePromptEditor(editor, { views, onSubmit })
  const Menu = components?.Menu ?? SuggestionMenu
  const Toolbar = components?.Toolbar ?? SelectionToolbar
  return (
    <div className={cx("herald-editor", className, classNames?.root)} style={style}>
      <div ref={ref} className="herald-editor-host" />
      {menu &&
        createPortal(
          <div
            className={cx("herald-floating herald-menu", classNames?.menu)}
            data-placement={menu.placement}
            style={menu.style}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Menu menu={menu} />
          </div>,
          document.body,
        )}
      {toolbar &&
        createPortal(
          <div
            className={cx("herald-floating herald-toolbar", classNames?.toolbar)}
            style={toolbar.style}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Toolbar toolbar={toolbar} />
          </div>,
          document.body,
        )}
    </div>
  )
}

export function SuggestionMenu({ menu }: { menu: MenuState }) {
  if (menu.loading && menu.items.length === 0) {
    return <div className="herald-menu-empty">loading…</div>
  }
  return (
    <ul role="listbox" className="herald-menu-list">
      {menu.items.map((item, i) => {
        const kind = item.kind ? menu.kinds.get(item.kind) : undefined
        return (
          <li
            key={item.id}
            role="option"
            aria-selected={i === menu.active}
            data-active={i === menu.active || undefined}
            className="herald-menu-item"
            onMouseEnter={() => menu.setActive(i)}
            onClick={() => menu.select(item)}
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

export function SelectionToolbar({ toolbar }: { toolbar: ToolbarState }) {
  return (
    <>
      {toolbar.items.map((t) => (
        <button
          key={t.mark}
          type="button"
          title={t.title}
          aria-pressed={toolbar.marks.includes(t.mark)}
          data-mark={t.mark}
          className="herald-toolbar-button"
          onClick={() => toolbar.toggle(t.mark)}
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

/** Shows what the editor produces: the compiled prompt, the JSON state, its markdown, collected values and diagnostics. */
export function Inspector({ editor, compile, diagnose, className }: InspectorProps) {
  const { diagnostics, text } = useInspector(editor, { compile, diagnose })
  const [tab, setTab] = useState<InspectorTab>(InspectorTab.Prompt)
  return (
    <div className={cx("herald-inspector", className)}>
      <div role="tablist" className="herald-inspector-tabs">
        {INSPECTOR_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
            {t === "diagnostics" && diagnostics.length > 0 && <span className="herald-count">{diagnostics.length}</span>}
          </button>
        ))}
      </div>
      <pre className="herald-inspector-body">{text(tab)}</pre>
    </div>
  )
}

/** Read-only rendering of a doc, e.g. a sent chat message. Pass the editor's `views` as `overrides` to match it. */
export function DocView({ doc, schema, overrides, className }: { doc: HeraldDoc; schema?: Schema; overrides?: Views; className?: string }) {
  return <HeadlessDocView doc={doc} views={views} overrides={overrides} schema={schema} className={cx("herald-doc", className)} />
}

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" ")
