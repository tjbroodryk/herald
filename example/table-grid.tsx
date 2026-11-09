import { useEffect, useState } from "react"
import { NodeType, type HeraldNode } from "@herald/core"
import { markdown } from "@herald/markdown"
import type { BlockViewProps } from "@herald/react"
import { DocView } from "@herald/ui"

// A table drawn as a grid of its own, the way cotera's MarkdownTableGrid replaces TipTap's cells: it reads the node,
// edits each cell as markdown text, and writes the whole table back through update(). Pass it as
// `views: { block: { table: TableGrid } }`; both adapters then draw it as an atom and never show its markdown.

const cellText = (cell: HeraldNode) => markdown.encode({ type: NodeType.Doc, content: cell.content ?? [] }).trimEnd()

// a cell's markdown back to blocks; a cell always holds at least a paragraph, as TipTap's do
const cellBlocks = (text: string): HeraldNode[] => {
  const content = markdown.decode(text).content ?? []
  return content.length ? content : [{ type: NodeType.Paragraph }]
}

export function TableGrid({ node, editable, update }: BlockViewProps) {
  const rows = node.content ?? []
  const setCell = (r: number, c: number, text: string) =>
    update({
      ...node,
      content: rows.map((row, ri) =>
        ri !== r
          ? row
          : { ...row, content: (row.content ?? []).map((cell, ci) => (ci === c ? { ...cell, content: cellBlocks(text) } : cell)) },
      ),
    })
  const addRow = () => {
    const width = rows[0]?.content?.length ?? 1
    const cell: HeraldNode = { type: NodeType.TableCell, content: [{ type: NodeType.Paragraph }] }
    update({ ...node, content: [...rows, { type: NodeType.TableRow, content: Array.from({ length: width }, () => cell) }] })
  }
  return (
    <div className="grid-table" data-editable={editable || undefined}>
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {(row.content ?? []).map((cell, c) => {
                const Cell = cell.type === NodeType.TableHeader ? "th" : "td"
                return (
                  <Cell key={c}>
                    {editable ? (
                      <CellEditor text={cellText(cell)} onCommit={(t) => setCell(r, c, t)} />
                    ) : (
                      <DocView doc={{ type: NodeType.Doc, content: cell.content ?? [] }} />
                    )}
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button type="button" className="btn" onClick={addRow}>
          + row
        </button>
      )}
    </div>
  )
}

// local text while typing; the doc gets the cell when focus leaves it
function CellEditor({ text, onCommit }: { text: string; onCommit(text: string): void }) {
  const [value, setValue] = useState(text)
  useEffect(() => setValue(text), [text])
  return (
    <textarea
      aria-label="cell"
      value={value}
      rows={Math.max(1, value.split("\n").length)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== text && onCommit(value)}
    />
  )
}
