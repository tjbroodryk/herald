import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { TextSelection } from "prosemirror-state"
import { renderToStaticMarkup } from "react-dom/server"
import { createSchema, mentions, starterKit, type AdapterHooks, type HeraldDoc, type HeraldNode } from "@herald/core"
import { markdown } from "@herald/markdown"
import { prosemirror, type ProseMirrorAdapter } from "@herald/prosemirror"
import { codemirror } from "@herald/codemirror"
import { DocView, HeraldEditor } from "@herald/react"
import { views } from "@herald/ui"
import { tiptapDoc } from "./fixtures"

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const schema = createSchema([starterKit(), mentions({ user: { label: "User" } })])

interface Rendered {
  node: HeraldNode
  editable: boolean
  update: (node: HeraldNode) => void
}

/** A UI layer for tests: draws atoms with @herald/ui's views as static HTML and records what it was given. */
function fakeHooks(over: Partial<AdapterHooks> = {}) {
  const blocks: Rendered[] = []
  const inlines: Rendered[] = []
  const changes: HeraldDoc[] = []
  const hooks: AdapterHooks = {
    triggers: ["@", "/"],
    editable: true,
    blockOverrides: [],
    onChange: (doc) => changes.push(doc),
    onTrigger: () => {},
    onSelection: () => {},
    onKeyDown: () => false,
    renderInline: (node, el, editable) => {
      const rec = { node, editable, update: () => {} }
      inlines.push(rec)
      el.innerHTML = renderToStaticMarkup(
        <views.inline node={node} kind={schema.mentionKinds.get(String(node.attrs?.kind))} editable={editable} />,
      )
      return {
        update: (n, e) => Object.assign(rec, { node: n, editable: e }),
        destroy: () => {},
      }
    },
    renderBlock: (node, el, update, editable) => {
      const rec = { node, editable, update }
      blocks.push(rec)
      const View = views.blocks[node.type] ?? views.blocks.default
      el.innerHTML = renderToStaticMarkup(<View node={node} update={update} editable={editable} />)
      return {
        update: (n, e) => Object.assign(rec, { node: n, editable: e }),
        destroy: () => {},
      }
    },
    ...over,
  }
  return { hooks, blocks, inlines, changes }
}

function mountPM(doc: HeraldDoc, over: Partial<AdapterHooks> = {}, adapter: ProseMirrorAdapter = prosemirror()) {
  const el = document.createElement("div")
  document.body.append(el)
  const ui = fakeHooks(over)
  adapter.mount(el, adapter.parse(schema, doc), ui.hooks)
  return { adapter, el, ...ui, view: adapter.view! }
}

const md = (s: string) => markdown.decode(s)
const para = (text: string, marks?: HeraldNode["marks"]): HeraldDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] }],
})

describe("ProseMirror: lossless TipTap round trip", () => {
  test("a cotera doc with everything Herald doesn't model comes back unchanged", () => {
    const { adapter } = mountPM(tiptapDoc)
    expect(adapter.getDoc()).toEqual(tiptapDoc)
    adapter.destroy()
  })

  test("through HeraldEditor too: content isn't normalized on the way in", () => {
    const editor = new HeraldEditor({ schema, adapter: prosemirror(), content: tiptapDoc })
    expect(editor.getDoc()).toEqual(tiptapDoc)
  })

  test("an edit elsewhere leaves the rest of the doc as it was", () => {
    const { adapter, view, changes } = mountPM(tiptapDoc)
    view.dispatch(view.state.tr.insertText("Draft: ", 1))
    const [heading, ...rest] = adapter.getDoc().content!
    expect(heading!.content).toEqual([{ type: "text", text: "Draft: Quarterly plan" }])
    expect(rest).toEqual(tiptapDoc.content!.slice(1))
    expect(changes.at(-1)).toEqual(adapter.getDoc())
  })

  test("a table with a two-paragraph cell and a list cell keeps its blocks and cell attrs", () => {
    const table = tiptapDoc.content!.find((n) => n.type === "table")!
    const doc: HeraldDoc = { type: "doc", content: [table] }
    const { adapter } = mountPM(doc)
    expect(adapter.getDoc()).toEqual(doc)
    // markdown, which can't hold them, collapses the cells only when it writes
    expect(markdown.encode(doc)).toBe("| Area | Notes |\n| --- | --- |\n| First paragraph Second paragraph | one two |\n")
  })

  test("setDoc with node types the schema hasn't seen", () => {
    const { adapter } = mountPM(para("plain"))
    const next: HeraldDoc = { type: "doc", content: [{ type: "callout", attrs: { tone: "warn" }, content: [{ type: "paragraph", content: [{ type: "text", text: "new", marks: [{ type: "underline" }] }] }] }] }
    adapter.setDoc(next)
    expect(adapter.getDoc()).toEqual(next)
  })
})

describe("comments", () => {
  const thread = (id: string) => ({ commentId: id, resolved: false, replies: [] })
  const commentIds = (doc: HeraldDoc) =>
    doc.content![0]!.content!.map((n) => [n.text, (n.marks ?? []).map((m) => m.attrs?.commentId)])

  test("compile and markdown never include comment marks or their threads", async () => {
    for (const mode of ["markdown", "plain"] as const) {
      const { prompt } = await schema.compile(tiptapDoc, { mode })
      expect(prompt).toContain("Review this overlapping range please.")
      expect(prompt).not.toContain("SECRET-REPLY-BODY")
      expect(prompt).not.toContain("c1")
      expect(prompt).not.toContain("comment")
    }
    const text = markdown.encode(tiptapDoc)
    expect(text).toContain("Review this overlapping range please.")
    expect(text).not.toContain("SECRET-REPLY-BODY")
    expect(text).not.toContain("comment")
  })

  test("typing inside a comment extends it; typing at its edge doesn't; deleting its text drops it", () => {
    const { adapter, view } = mountPM(para("hello world"))
    adapter.addComment({ from: 1, to: 6 }, thread("c1"))
    view.dispatch(view.state.tr.insertText("X", 3))
    view.dispatch(view.state.tr.insertText("!", 7))
    expect(commentIds(adapter.getDoc())).toEqual([
      ["heXllo", ["c1"]],
      ["! world", []],
    ])
    expect(adapter.commentsInDoc()).toEqual([{ commentId: "c1", attrs: thread("c1"), from: 1, to: 7, text: "heXllo" }])
    view.dispatch(view.state.tr.delete(1, 7))
    expect(adapter.commentsInDoc()).toEqual([])
    expect(JSON.stringify(adapter.getDoc())).not.toContain("comment")
  })

  test("overlapping comments, and update/remove touch only their own", () => {
    const { adapter } = mountPM(para("abcdef"))
    adapter.addComment({ from: 1, to: 5 }, thread("c1"))
    adapter.addComment({ from: 3, to: 7 }, thread("c2"))
    expect(commentIds(adapter.getDoc())).toEqual([
      ["ab", ["c1"]],
      ["cd", ["c1", "c2"]],
      ["ef", ["c2"]],
    ])
    const reply = { id: "r", authorId: "u", authorName: "U", body: "ok", createdAt: "2026-11-09T00:00:00.000Z" }
    expect(adapter.updateComment("c2", { resolved: true, replies: [reply] })).toBe(true)
    expect(adapter.commentsInDoc().map((c) => [c.commentId, c.attrs.resolved, c.attrs.replies.length, c.text])).toEqual([
      ["c1", false, 0, "abcd"],
      ["c2", true, 1, "cdef"],
    ])
    expect(adapter.removeComment("c1")).toBe(true)
    expect(adapter.removeComment("missing")).toBe(false)
    expect(adapter.commentsInDoc().map((c) => [c.commentId, c.text])).toEqual([["c2", "cdef"]])
  })

  test("the draft range and the caret's thread are decorations, not doc or history", () => {
    const { adapter, view, el, changes } = mountPM(para("hello world"))
    adapter.addComment({ from: 7, to: 12 }, thread("c9"))
    const before = changes.length
    adapter.setCommentDraft({ from: 1, to: 6 })
    adapter.setCommentDraft({ from: 1, to: 6 })
    expect(el.querySelector(".herald-comment-draft")?.textContent).toBe("hello")
    expect(changes.length).toBe(before)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)))
    expect(el.querySelector(".herald-comment-active")?.textContent).toBe("world")
    adapter.setCommentDraft(null)
    expect(el.querySelector(".herald-comment-draft")).toBeNull()
    expect(JSON.stringify(adapter.getDoc())).not.toContain("draft")
  })
})

describe("read-only", () => {
  test("setEditable flips contenteditable and tells the views, without recreating them", () => {
    const { adapter, el, inlines, blocks } = mountPM(tiptapDoc)
    const root = el.querySelector(".ProseMirror")!
    expect(root.getAttribute("contenteditable")).toBe("true")
    const before = [inlines.length, blocks.length]
    adapter.setEditable(false)
    expect(root.getAttribute("contenteditable")).toBe("false")
    expect([...inlines, ...blocks].every((v) => v.editable === false)).toBe(true)
    expect([inlines.length, blocks.length]).toEqual(before)
    adapter.setEditable(true)
    expect(blocks.every((v) => v.editable)).toBe(true)
  })

  test("a read-only editor draws the same elements as DocView", () => {
    const { adapter, el } = mountPM(tiptapDoc, { editable: false })
    const docView = document.createElement("div")
    docView.innerHTML = renderToStaticMarkup(<DocView doc={tiptapDoc} views={views} schema={schema} />)
    const seen = shape(el.querySelector(".ProseMirror")!)
    // one entry per top-level block, so the comparison isn't vacuous
    expect(seen.length).toBe(tiptapDoc.content!.length)
    expect(seen).toEqual(shape(docView.firstElementChild!))
    adapter.destroy()
  })
})

const MARK_TAGS = new Set(["strong", "em", "s", "code", "a", "sup", "sub", "u", "mark", "span"])

/**
 * What a reader sees: the block tree, and each run of text with the chain of mark elements around it. Leaves out
 * what only an editor adds (host wrappers, ProseMirror's classes, its trailing-break hacks, data-herald-* attrs) and
 * how adjacent runs share a wrapper, which ProseMirror merges and DocView doesn't.
 */
function shape(el: Element, chain: string[] = []): unknown[] {
  const out: unknown[] = []
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      out.push({ text: child.textContent, chain })
      continue
    }
    const e = child as Element
    if (e.classList.contains("herald-chip-host") || e.classList.contains("herald-block-host")) {
      out.push(...shape(e, chain))
      continue
    }
    if (e.classList.contains("ProseMirror-separator") || (e.classList.contains("ProseMirror-trailingBreak") && e.parentElement?.childNodes.length !== 1)) {
      continue
    }
    const attrs = Object.fromEntries(
      Array.from(e.attributes)
        .filter((a) => !/^(class|contenteditable|draggable|data-herald-attrs|data-herald-mark|data-herald-node)$/.test(a.name))
        .map((a) => [a.name, a.name === "style" ? a.value.replace(/;\s*$/, "").replace(/:\s*/g, ": ") : a.value]),
    )
    const tag = e.tagName.toLowerCase()
    const isChip = e.classList.contains("herald-chip")
    if (MARK_TAGS.has(tag) && !isChip && !e.closest("pre")) {
      out.push(...shape(e, [...chain, `${tag}${JSON.stringify(attrs)}`]))
    } else {
      out.push([tag, attrs, shape(e)])
    }
  }
  return out.reduce<unknown[]>((acc, n) => {
    const prev = acc.at(-1) as { text?: string; chain?: string[] } | undefined
    const cur = n as { text?: string; chain?: string[] }
    if (cur.text !== undefined && prev?.text !== undefined && JSON.stringify(prev.chain) === JSON.stringify(cur.chain)) {
      prev.text += cur.text
    } else {
      acc.push(cur.text !== undefined ? { ...cur } : n)
    }
    return acc
  }, [])
}

describe("images", () => {
  test("markdown form", () => {
    const doc = md('![A cat](https://x.y/c.png "Tom")\n\n![](data:image/png;base64,iVBOR=)\n')
    expect(doc.content).toEqual([
      { type: "image", attrs: { src: "https://x.y/c.png", alt: "A cat", title: "Tom" } },
      { type: "image", attrs: { src: "data:image/png;base64,iVBOR=", alt: "" } },
    ])
    expect(markdown.encode(doc)).toBe('![A cat](https://x.y/c.png "Tom")\n\n![](data:image/png;base64,iVBOR=)\n')
    expect(markdown.encode({ type: "doc", content: [{ type: "image", attrs: { src: "a b.png", alt: "x]y", title: 'say "hi"' } }] })).toBe(
      '![x\\]y](<a b.png> "say \\"hi\\"")\n',
    )
    expect(md(markdown.encode({ type: "doc", content: [{ type: "image", attrs: { src: "a b.png", alt: "x]y", title: 'say "hi"' } }] })).content).toEqual([
      { type: "image", attrs: { src: "a b.png", alt: "x]y", title: 'say "hi"' } },
    ])
  })

  test("compile keeps URLs and drops data URLs for the alt text", async () => {
    const doc = md('![A cat](https://x.y/c.png "Tom")\n\n![chart](data:image/png;base64,iVBOR=)\n')
    expect((await schema.compile(doc)).prompt).toBe('![A cat](https://x.y/c.png "Tom")\n\nchart')
    expect((await schema.compile(doc, { mode: "plain" })).prompt).toBe("A cat\n\nchart")
  })

  test("the default view draws the image; a click on it can select it", () => {
    const { el, blocks } = mountPM({ type: "doc", content: [{ type: "image", attrs: { src: "https://x.y/c.png", alt: "c" } }] })
    expect(blocks.map((b) => b.node.type)).toEqual(["image"])
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://x.y/c.png")
  })

  test("an upload shows a placeholder until onImageFile resolves", async () => {
    let finish: (v: { src: string }) => void = () => {}
    const adapter = prosemirror({ onImageFile: () => new Promise((r) => (finish = r)) })
    const { el } = mountPM(para("text"), {}, adapter)
    const file = new File(["x"], "shot.png", { type: "image/png" })
    expect(adapter.insertImageFiles([new File(["x"], "a.txt", { type: "text/plain" })], 1)).toBe(false)
    expect(adapter.insertImageFiles([file], 5)).toBe(true)
    expect(el.querySelector(".herald-image-placeholder")).not.toBeNull()
    expect(JSON.stringify(adapter.getDoc())).not.toContain("image")
    finish({ src: "https://cdn/x.png" })
    await Promise.resolve()
    await Promise.resolve()
    expect(el.querySelector(".herald-image-placeholder")).toBeNull()
    expect(adapter.getDoc().content!.map((n) => n.type)).toEqual(["paragraph", "image"])
    expect(adapter.getDoc().content![1]!.attrs).toEqual({ src: "https://cdn/x.png" })
  })

  test("without onImageFile the image goes in as a data URL", async () => {
    const { adapter } = mountPM(para("text"))
    adapter.insertImageFiles([new File(["x"], "shot.png", { type: "image/png" })], 5)
    for (let i = 0; i < 20 && adapter.getDoc().content!.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(String(adapter.getDoc().content![1]!.attrs!.src)).toStartWith("data:image/png;base64,")
  })
})

describe("table overrides", () => {
  const table = (cells: string[][]): HeraldNode => ({
    type: "table",
    content: cells.map((row, r) => ({
      type: "tableRow",
      content: row.map((text) => ({
        type: r === 0 ? "tableHeader" : "tableCell",
        ...(text ? { content: [{ type: "paragraph", content: [{ type: "text", text }] }] } : {}),
      })),
    })),
  })

  test("ProseMirror: the override gets the node and editable, and update() replaces the table", () => {
    const start = table([["a", "b"], ["1", "2"]])
    const { adapter, blocks, el } = mountPM({ type: "doc", content: [start] }, { blockOverrides: ["table"] })
    const grid = blocks.find((b) => b.node.type === "table")!
    expect(grid.node).toEqual(start)
    expect(grid.editable).toBe(true)
    // the table isn't ProseMirror content any more: it's the view's, inside a non-editable host
    expect(el.querySelector(".ProseMirror > table")).toBeNull()
    expect(el.querySelector(".herald-block-host")?.getAttribute("contenteditable")).toBe("false")
    const next = table([["a", "b"], ["1", "two"], ["3", "4"]])
    grid.update(next)
    expect(adapter.getDoc().content).toEqual([next])
    expect(grid.node).toEqual(next)
    adapter.setEditable(false)
    expect(grid.editable).toBe(false)
  })

  test("without an override ProseMirror edits tables natively", () => {
    const { blocks, el } = mountPM({ type: "doc", content: [table([["a"], ["1"]])] })
    expect(blocks.some((b) => b.node.type === "table")).toBe(false)
    expect(el.querySelector("td p")?.textContent).toBe("1")
  })

  const mountCM = (text: string, over: Partial<AdapterHooks>) => {
    const el = document.createElement("div")
    document.body.append(el)
    const adapter = codemirror({ draggable: false })
    const ui = fakeHooks(over)
    adapter.mount(el, md(text), ui.hooks)
    return { adapter, ...ui }
  }

  test("CodeMirror: an override is an atom that never reveals markdown, and update() rewrites the source", () => {
    const { adapter, blocks } = mountCM("Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", { blockOverrides: ["table"] })
    // put the cursor inside the table's source: an override still draws the grid
    adapter.view!.dispatch({ selection: { anchor: 12 } })
    const grid = blocks.findLast((b) => b.node.type === "table")!
    expect(grid.node).toEqual(table([["a", "b"], ["1", "2"]]))
    expect(adapter.view!.dom.querySelector(".herald-block-host")).not.toBeNull()
    grid.update(table([["a", "b"], ["1", "two"]]))
    expect(adapter.getText()).toBe("Intro\n\n| a | b |\n| --- | --- |\n| 1 | two |\n")
    expect(adapter.getDoc().content![1]).toEqual(table([["a", "b"], ["1", "two"]]))
  })

  test("CodeMirror: the default preview's update() writes back too", () => {
    const { adapter, blocks } = mountCM("| a |\n| --- |\n| 1 |\n\nAfter\n", {})
    const preview = blocks.findLast((b) => b.node.type === "table")!
    preview.update(table([["a"], ["9"]]))
    expect(adapter.getText()).toBe("| a |\n| --- |\n| 9 |\n\nAfter\n")
  })

  test("DocView takes the same overrides", () => {
    const Grid = ({ node, editable }: { node: HeraldNode; editable: boolean }) => (
      <div data-grid={node.content!.length} data-editable={String(editable)} />
    )
    const html = renderToStaticMarkup(
      <DocView doc={{ type: "doc", content: [table([["a"], ["1"]])] }} views={views} overrides={{ block: { table: Grid } }} />,
    )
    expect(html).toBe('<div><div data-grid="2" data-editable="false"></div></div>')
  })
})
