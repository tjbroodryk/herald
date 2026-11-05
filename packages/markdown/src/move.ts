import type { Range } from "@herald/core"

export interface MovePlan {
  /** Text edits in original positions: remove the block, insert it at the gap. */
  changes: { from: number; to: number; insert: string }[]
  /** Where the inserted text goes, in original positions, and where the block starts inside it. */
  at: number
  offset: number
}

/**
 * Moves top-level block `index` to `gap` (0 = before the first block, blocks.length = after the last).
 * `blocks` are the top-level block ranges in document order. Returns null when the move changes nothing.
 * shortcut: a list dropped next to a list of the same type merges into it, as markdown reads them as one list.
 */
export function planMove(text: string, blocks: Range[], index: number, gap: number): MovePlan | null {
  const block = blocks[index]
  if (!block || gap < 0 || gap > blocks.length || gap === index || gap === index + 1) {
    return null
  }
  const chunk = text.slice(block.from, block.to)
  const next = blocks[index + 1]
  const prev = blocks[index - 1]
  // take the blank lines that separate the block from its neighbour with it
  const remove = next ? { from: block.from, to: next.from } : { from: prev ? prev.to : block.from, to: block.to }
  if (gap < blocks.length) {
    const at = blocks[gap]!.from
    return { changes: [{ ...remove, insert: "" }, { from: at, to: at, insert: chunk + "\n\n" }], at, offset: 0 }
  }
  const at = blocks[blocks.length - 1]!.to
  return { changes: [{ ...remove, insert: "" }, { from: at, to: at, insert: "\n\n" + chunk }], at, offset: 2 }
}
