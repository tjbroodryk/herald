import type { HeraldDoc, Schema } from "@herald/core"
import { DocView as HeadlessDocView } from "@herald/react"
import { cn } from "@/lib/utils"
import { docViewClassName, heraldViews } from "@/registry/herald/herald-views"

/** Read-only rendering of a doc, e.g. a sent chat message. */
export function DocView({ doc, schema, className }: { doc: HeraldDoc; schema?: Schema; className?: string }) {
  return <HeadlessDocView doc={doc} schema={schema} views={heraldViews} className={cn(docViewClassName, className)} />
}
