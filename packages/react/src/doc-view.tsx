import { createElement, type CSSProperties, type ReactNode } from "react"
import { blockStyle, markElement, NodeType, type HeraldDoc, type HeraldNode, type Schema } from "@herald/core"
import type { Views, ViewSet } from "./index"

export interface DocViewProps {
  doc: HeraldDoc
  /** The chip and block views to use, as for the editor. */
  views: ViewSet
  /** The editor's per-type overrides (`useEditor({ views })`), e.g. a table grid. They get `editable: false`. */
  overrides?: Views
  /** Gives mention chips their kind's colour and label. */
  schema?: Schema
  className?: string
}

/**
 * Read-only rendering of a doc, e.g. a sent chat message. No editor is created. Renders plain semantic HTML, the same
 * elements a read-only ProseMirror editor draws; container nodes such as sections get `data-herald-block="<type>"`.
 */
export function DocView({ doc, views, overrides, schema, className }: DocViewProps) {
  return <div className={className}>{nodes(doc.content, { views, overrides, schema })}</div>
}

interface Ctx {
  views: ViewSet
  overrides?: Views
  schema?: Schema
}

function nodes(content: HeraldNode[] | undefined, ctx: Ctx): ReactNode {
  return content?.map((n, i) => <Node key={i} node={n} ctx={ctx} />)
}

const noop = () => {}

// kebab-case CSS from @herald/core to React's camelCase
const css = (style: Record<string, string>): CSSProperties | undefined =>
  Object.keys(style).length
    ? Object.fromEntries(Object.entries(style).map(([k, v]) => [k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), v]))
    : undefined

function Node({ node, ctx }: { node: HeraldNode; ctx: Ctx }): ReactNode {
  const { views, overrides, schema } = ctx
  const kind = schema?.mentionKinds.get(String(node.attrs?.kind))
  const OwnInline = overrides?.inline?.[node.type]
  if (OwnInline) {
    return <OwnInline node={node} kind={kind} editable={false} />
  }
  const OwnBlock = overrides?.block?.[node.type]
  if (OwnBlock) {
    return <OwnBlock node={node} update={noop} editable={false} />
  }
  const children = nodes(node.content, ctx)
  const style = css(blockStyle(node.attrs))
  const { inline: Chip } = views
  const Block = views.blocks[node.type] ?? views.blocks.default
  switch (node.type) {
    case NodeType.Paragraph:
      // an empty paragraph keeps its line, as it does in an editor
      return <p style={style}>{node.content?.length ? children : <br />}</p>
    case NodeType.Heading: {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      const H = `h${level}` as "h1"
      return <H style={style}>{children}</H>
    }
    case NodeType.BulletList:
      return <ul>{children}</ul>
    case NodeType.OrderedList:
      return <ol start={Number(node.attrs?.start ?? 1)}>{children}</ol>
    case NodeType.ListItem:
      return <li>{children}</li>
    case NodeType.Blockquote:
      return <blockquote>{children}</blockquote>
    case NodeType.CodeBlock:
      return (
        <pre>
          <code>{node.content?.map((c) => c.text).join("")}</code>
        </pre>
      )
    case NodeType.HorizontalRule:
      return <hr />
    case NodeType.HardBreak:
      return <br />
    case NodeType.Text:
      return text(node)
    case NodeType.Mention:
      return <Chip node={node} kind={kind} editable={false} />
    case NodeType.Table:
      // header cells are <th>; one <tbody>, as ProseMirror draws it
      return (
        <table>
          <tbody>{children}</tbody>
        </table>
      )
    case NodeType.TableRow:
      return <tr>{children}</tr>
    case NodeType.TableHeader:
    case NodeType.TableCell: {
      const Cell = node.type === NodeType.TableHeader ? "th" : "td"
      const align = node.attrs?.align
      return <Cell style={typeof align === "string" ? { textAlign: align as "left" } : undefined}>{children}</Cell>
    }
    default:
      if (node.content) {
        return (
          <div data-herald-block={node.type} style={style}>
            {children}
          </div>
        )
      }
      return typeof node.attrs?.label === "string" ? (
        <Chip node={node} editable={false} />
      ) : (
        <Block node={node} update={noop} editable={false} />
      )
  }
}

function text(node: HeraldNode): ReactNode {
  let out: ReactNode = node.text
  for (const mark of [...(node.marks ?? [])].reverse()) {
    const spec = markElement(mark)
    out = createElement(spec.tag, { ...spec.attrs, style: css(spec.style) }, out)
  }
  return out
}
