import { useState } from "react"
import type { CompileOptions, DiagnoseOptions } from "@herald/core"
import { INSPECTOR_TABS, InspectorTab, useInspector, type HeraldEditor } from "@herald/react"
import { cn } from "@/lib/utils"

export interface InspectorProps {
  editor: HeraldEditor
  /** Keep these stable across renders (module constants or useMemo). */
  compile?: CompileOptions
  diagnose?: DiagnoseOptions
  className?: string
}

/** What the editor produces: the compiled prompt, the JSON state, its markdown, collected values and diagnostics. */
export function Inspector({ editor, compile, diagnose, className }: InspectorProps) {
  const { diagnostics, text } = useInspector(editor, { compile, diagnose })
  const [tab, setTab] = useState<InspectorTab>(InspectorTab.Prompt)
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div role="tablist" className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
        {INSPECTOR_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            data-state={t === tab ? "active" : "inactive"}
            onClick={() => setTab(t)}
            className="inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-sm font-medium capitalize transition-colors hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-input/30"
          >
            {t}
            {t === "diagnostics" && diagnostics.length > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-white">{diagnostics.length}</span>
            )}
          </button>
        ))}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {text(tab)}
      </pre>
    </div>
  )
}
