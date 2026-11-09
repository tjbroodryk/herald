import { COMMENT_MARK, MarkType, type Attrs, type HeraldMark } from "./types"

// How marks and block styles are drawn, shared by @herald/react's DocView and the ProseMirror adapter, so a read-only
// editor and a DocView put the same elements on the page.

export interface ElementSpec {
  tag: string
  attrs: Record<string, string>
  /** CSS properties, kebab-case. */
  style: Record<string, string>
}

export const safeHref = (href: unknown): string | undefined =>
  typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : undefined

// a value that can't close the declaration or pull in a URL
const safeCss = (v: unknown): v is string => typeof v === "string" && !!v && !/[;{}<>]|url\(/i.test(v)

const pick = (attrs: Attrs | undefined, props: Record<string, string>): Record<string, string> => {
  const style: Record<string, string> = {}
  for (const [attr, prop] of Object.entries(props)) {
    const v = attrs?.[attr]
    if (safeCss(v)) {
      style[prop] = v
    }
  }
  return style
}

const el = (tag: string, attrs: Record<string, string> = {}, style: Record<string, string> = {}): ElementSpec => ({
  tag,
  attrs,
  style,
})

/** The element a mark draws. Marks Herald doesn't know draw a `span[data-mark]`, so they still wrap their text. */
export function markElement(mark: HeraldMark): ElementSpec {
  switch (mark.type) {
    case MarkType.Bold:
      return el("strong")
    case MarkType.Italic:
      return el("em")
    case MarkType.Strike:
      return el("s")
    case MarkType.Code:
      return el("code")
    case MarkType.Link: {
      const href = safeHref(mark.attrs?.href)
      return el("a", href ? { href, target: "_blank", rel: "noreferrer" } : {})
    }
    case COMMENT_MARK:
      return el("span", {
        ...(typeof mark.attrs?.commentId === "string" ? { "data-comment-id": mark.attrs.commentId } : {}),
        "data-comment-resolved": String(mark.attrs?.resolved === true),
      })
    // TipTap's presentation marks
    case "superscript":
      return el("sup")
    case "subscript":
      return el("sub")
    case "underline":
      return el("u")
    case "highlight":
      return el("mark", {}, pick(mark.attrs, { color: "background-color" }))
    case "textStyle":
      return el(
        "span",
        {},
        pick(mark.attrs, { color: "color", backgroundColor: "background-color", fontFamily: "font-family", fontSize: "font-size" }),
      )
    default:
      return el("span", { "data-mark": mark.type })
  }
}

/** Styles a block's attrs ask for, e.g. TipTap's `textAlign`. */
export function blockStyle(attrs: Attrs | undefined): Record<string, string> {
  return pick(attrs, { textAlign: "text-align" })
}
