import type { HeraldDoc, Schema } from "@herald/core"
import { DocView as HeadlessDocView } from "@herald/react"
import { cn } from "@/lib/utils"
import { heraldViews } from "@/registry/herald/herald-views"

/** Read-only rendering of a doc, e.g. a sent chat message. */
export function DocView({ doc, schema, className }: { doc: HeraldDoc; schema?: Schema; className?: string }) {
  return (
    <HeadlessDocView
      doc={doc}
      schema={schema}
      views={heraldViews}
      className={cn(
        "text-sm leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        "[&_p]:my-1.5 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold",
        "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_hr]:my-3",
        "[&_[data-herald-block]]:my-1.5 [&_[data-herald-block]]:border-l-[3px] [&_[data-herald-block]]:border-primary [&_[data-herald-block]]:pl-3",
        className,
      )}
    />
  )
}
