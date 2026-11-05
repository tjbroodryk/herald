import type { ReactNode } from "react"
import type { HeraldDoc, HeraldNode, Schema } from "@herald/core"
import type { ViewSet } from "./index"

export interface DocViewProps {
  doc: HeraldDoc
  /** The chip and block views to use, as for the editor. */
  views: ViewSet
  /** Gives mention chips their kind's colour and label. */
  schema?: Schema
  className?: string
}

/**
 * Read-only rendering of a doc, e.g. a sent chat message. No editor is created. Renders plain semantic HTML;
 * container nodes such as sections get `data-herald-block="<type>"` for styling.
 */
export function DocView({ doc, views, schema, className }: DocViewProps) {
  return <div className={className}>{nodes(doc.content, views, schema)}</div>
}

function nodes(content: HeraldNode[] | undefined, views: ViewSet, schema?: Schema): ReactNode {
  return content?.map((n, i) => <Node key={i} node={n} views={views} schema={schema} />)
}

const safeHref = (href: unknown) => (typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : undefined)

function Node({ node, views, schema }: { node: HeraldNode; views: ViewSet; schema?: Schema }): ReactNode {
  const children = nodes(node.content, views, schema)
  const { inline: Chip } = views
  const Block = views.blocks[node.type] ?? views.blocks.default
  switch (node.type) {
    case "paragraph":
      return <p>{children}</p>
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      const H = `h${level}` as "h1"
      return <H>{children}</H>
    }
    case "bulletList":
      return <ul>{children}</ul>
    case "orderedList":
      return <ol start={Number(node.attrs?.start ?? 1)}>{children}</ol>
    case "listItem":
      return <li>{children}</li>
    case "blockquote":
      return <blockquote>{children}</blockquote>
    case "codeBlock":
      return (
        <pre>
          <code>{node.content?.map((c) => c.text).join("")}</code>
        </pre>
      )
    case "horizontalRule":
      return <hr />
    case "hardBreak":
      return <br />
    case "text":
      return text(node)
    case "mention":
      return <Chip node={node} kind={schema?.mentionKinds.get(String(node.attrs?.kind))} />
    default:
      if (node.content) {
        return <div data-herald-block={node.type}>{children}</div>
      }
      return typeof node.attrs?.label === "string" ? <Chip node={node} /> : <Block node={node} update={() => {}} />
  }
}

function text(node: HeraldNode): ReactNode {
  let out: ReactNode = node.text
  for (const mark of [...(node.marks ?? [])].reverse()) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>
        break
      case "italic":
        out = <em>{out}</em>
        break
      case "strike":
        out = <s>{out}</s>
        break
      case "code":
        out = <code>{out}</code>
        break
      case "link": {
        const href = safeHref(mark.attrs?.href)
        out = href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {out}
          </a>
        ) : (
          out
        )
        break
      }
    }
  }
  return out
}
