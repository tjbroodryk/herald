import { expect, test } from "bun:test"
import { parseMarkdown, planMove } from "@herald/markdown"

const apply = (text: string, changes: { from: number; to: number; insert: string }[]) =>
  [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text)

const source = [
  "# Title",
  "",
  "First paragraph with @[A](tool:a).",
  "",
  "",
  ':::section{title="Rules"}',
  "Inside.",
  "",
  "- one",
  ":::",
  "```herald:outputShape",
  '{"fields":[]}',
  "```",
  "",
  "- a",
  "- b",
  "",
  "Last.",
].join("\n")

test("every top-level move lands the block in the gap and keeps the others intact", () => {
  const { doc, spans } = parseMarkdown(source)
  const blocks = spans.filter((s) => s.kind === "block")
  const nodes = doc.content!
  expect(blocks).toHaveLength(nodes.length)
  for (let index = 0; index < nodes.length; index++) {
    for (let gap = 0; gap <= nodes.length; gap++) {
      const plan = planMove(source, blocks, index, gap)
      if (gap === index || gap === index + 1) {
        expect(plan).toBeNull()
        continue
      }
      const expected = [...nodes]
      const [moved] = expected.splice(index, 1)
      expected.splice(gap > index ? gap - 1 : gap, 0, moved!)
      const text = apply(source, plan!.changes)
      expect({ index, gap, content: parseMarkdown(text).doc.content }).toEqual({ index, gap, content: expected })
    }
  }
})
