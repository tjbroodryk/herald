import type { CSSProperties } from "react"
import { createPortal } from "react-dom"
import type { EditorClasses, HeraldDoc } from "@herald/core"
import { usePromptEditor, type HeraldEditor, type MenuState, type ToolbarState } from "@herald/react"
import { cn } from "@/lib/utils"
import { heraldViews } from "@/registry/herald/herald-views"

// The editor draws markdown as rich text. These are the classes it puts on each part; edit them like any other
// Tailwind in this file. Lines get padding through the --herald-line-* variables because CodeMirror owns padding.
export const editorClasses: EditorClasses = {
  h1: "text-2xl font-semibold tracking-tight [--herald-line-top:0.4em]",
  h2: "text-xl font-semibold tracking-tight [--herald-line-top:0.3em]",
  h3: "text-lg font-semibold",
  h4: "font-semibold",
  h5: "font-semibold",
  h6: "font-semibold",
  bold: "font-semibold",
  italic: "italic",
  strike: "line-through",
  code: "rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]",
  link: "text-primary underline underline-offset-4",
  syntax: "text-muted-foreground",
  "list-mark": "text-muted-foreground",
  quote: "border-l-2 border-border text-muted-foreground [--herald-line-indent:12px]",
  "code-block": "bg-muted font-mono text-[0.85em] [--herald-line-indent:12px]",
  hr: "border-b border-border",
  directive:
    "border-l-[3px] border-l-[color:var(--herald-block-color,var(--primary))] bg-[color-mix(in_oklab,var(--herald-block-color,var(--primary))_6%,transparent)] [--herald-line-indent:12px]",
  "directive-open": "[--herald-line-top:4px]",
  "directive-close": "leading-[0.6]",
  "directive-title":
    "text-[0.7rem] font-semibold tracking-wider uppercase text-[color:var(--herald-block-color,var(--primary))]",
  "drag-handle":
    "absolute left-1 z-10 flex w-4 cursor-grab items-center justify-center rounded-sm text-[15px] tracking-[-4px] text-muted-foreground select-none hover:bg-accent hover:text-accent-foreground",
  "drop-line": "pointer-events-none absolute right-3 left-5 z-10 h-0.5 rounded-full bg-primary",
  "drag-ghost": "pointer-events-none absolute right-3 left-5 rounded-sm bg-primary/10",
  table: "font-mono text-[0.85em]",
}

export interface PromptEditorProps {
  editor: HeraldEditor
  className?: string
  /** Makes Enter submit (Shift+Enter for a new line), as in a chat input. */
  onSubmit?: (doc: HeraldDoc) => void
}

export function PromptEditor({ editor, className, onSubmit }: PromptEditorProps) {
  const { ref, menu, toolbar } = usePromptEditor(editor, { views: heraldViews, classes: editorClasses, onSubmit })
  return (
    <div
      className={cn(
        "relative min-h-24 rounded-md border border-input bg-transparent text-sm shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        // the variables CodeMirror reads for the caret, selection and placeholder
        "[--herald-accent:var(--primary)] [--herald-muted:var(--muted-foreground)] [--herald-selection:color-mix(in_oklab,var(--primary)_20%,transparent)]",
        className,
      )}
    >
      <div ref={ref} />
      {menu && <SuggestionMenu menu={menu} />}
      {toolbar && <SelectionToolbar toolbar={toolbar} />}
    </div>
  )
}

export function SuggestionMenu({ menu }: { menu: MenuState }) {
  return createPortal(
    <div
      data-placement={menu.placement}
      style={menu.style}
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 max-h-[300px] max-w-80 min-w-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {menu.loading && menu.items.length === 0 ? (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div role="listbox">
          {menu.items.map((item, i) => {
            const kind = item.kind ? menu.kinds.get(item.kind) : undefined
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={i === menu.active}
                data-active={i === menu.active || undefined}
                onMouseEnter={() => menu.setActive(i)}
                onClick={() => menu.select(item)}
                className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[active]:bg-accent data-[active]:text-accent-foreground"
              >
                {kind && (
                  <span
                    className="size-2 shrink-0 rounded-full bg-(--herald-kind-color)"
                    style={{ "--herald-kind-color": kind.color } as CSSProperties}
                  />
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {(item.detail ?? kind?.label) && (
                  <span className="ml-auto text-xs text-muted-foreground">{item.detail ?? kind?.label}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>,
    document.body,
  )
}

const MARK_STYLE: Record<string, string> = { italic: "italic", strike: "line-through", code: "font-mono text-xs" }

export function SelectionToolbar({ toolbar }: { toolbar: ToolbarState }) {
  return createPortal(
    <div
      style={toolbar.style}
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 flex gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {toolbar.items.map((t) => (
        <button
          key={t.mark}
          type="button"
          title={t.title}
          aria-pressed={toolbar.marks.includes(t.mark)}
          onClick={() => toolbar.toggle(t.mark)}
          className={cn(
            "inline-flex h-7 min-w-7 items-center justify-center rounded-sm px-1.5 text-sm font-semibold hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground",
            MARK_STYLE[t.mark],
          )}
        >
          {t.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
