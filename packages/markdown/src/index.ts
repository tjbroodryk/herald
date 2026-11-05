import type { Codec, HeraldDoc } from "@herald/core"
import { parseMarkdown } from "./parse"
import { serializeMarkdown } from "./serialize"

export { parseMarkdown, SpanKind, type ParseResult, type Span } from "./parse"
export { isInlineAtom, serializeMarkdown, serializeWithCursor } from "./serialize"
export { parseAttrs, serializeAttrs } from "./attrs"
export { planMove, type MovePlan } from "./move"

/**
 * Markdown storage. `decode(encode(doc))` equals `normalize(doc)`; `encode(decode(text))` is the canonical
 * spelling of `text`, not always the same characters (`_a_` comes back as `*a*`).
 */
export const markdown: Codec<string> = {
  encode: (doc: HeraldDoc) => serializeMarkdown(doc),
  decode: (text: string) => parseMarkdown(text).doc,
}
