import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createSchema, starterKit } from "@herald/core"
import { markdown } from "@herald/markdown"
import { htmlPaste, htmlToNodes, markdownPaste, plainTextPaste } from "@herald/paste"

const domParser = new new Window().DOMParser() as unknown as DOMParser
const html = (s: string) => htmlToNodes(s, domParser)
const asMarkdown = (nodes: ReturnType<typeof html>) => markdown.encode({ type: "doc", content: nodes ?? [] })

describe("htmlToNodes", () => {
  test("a web page: headings, lists, links, marks, code", () => {
    const nodes = html(
      `<h2>Setup</h2><p>Run <code>bun install</code>, then read <a href="https://bun.sh">the <strong>docs</strong></a>.</p>
       <ul><li>one <em>fast</em></li><li><s>old</s> two</li></ul>
       <pre><code class="language-ts">const a = 1
</code></pre><blockquote><p>quoted</p></blockquote>`,
    )
    expect(asMarkdown(nodes)).toBe(
      [
        "## Setup",
        "",
        "Run `bun install`, then read [the **docs**](https://bun.sh).",
        "",
        "- one *fast*",
        "- ~~old~~ two",
        "",
        "```ts",
        "const a = 1",
        "```",
        "",
        "> quoted",
        "",
      ].join("\n"),
    )
  })

  test("Google Docs: wrapper <b> isn't bold, styled spans are", () => {
    const nodes = html(
      `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span> and </span><span style="font-style:italic;">italic</span></p><ol><li><p><span>first</span></p></li></ol></b>`,
    )
    expect(asMarkdown(nodes)).toBe("**Bold** and *italic*\n\n1. first\n")
  })

  test("tables, with alignment and the first row as the header", () => {
    const nodes = html(
      `<table><tr><td>Name</td><td style="text-align:right">Count</td></tr><tr><td><b>a</b></td><td>2</td></tr></table>`,
    )
    expect(asMarkdown(nodes)).toBe("| Name | Count |\n| --- | ---: |\n| **a** | 2 |\n")
  })

  test("unsafe links are dropped and unstructured HTML is passed on", () => {
    expect(asMarkdown(html(`<p><a href="javascript:alert(1)">x</a></p>`))).toBe("x\n")
    // what a code editor puts on the clipboard: styled divs and spans, no structure
    expect(html(`<div><span style="color:red">const</span> a = 1</div>`)).toBeNull()
  })
})

describe("paste rules", () => {
  const clipboard = (data: Record<string, string>) => ({ getData: (mime: string) => data[mime] ?? "" })

  test("rules run in plugin order and the first that produces content wins", () => {
    const schema = createSchema([starterKit(), htmlPaste({ domParser }), markdownPaste()])
    const both = clipboard({ "text/html": "<p><strong>rich</strong></p>", "text/plain": "# plain" })
    expect(asMarkdown(schema.parsePaste(both))).toBe("**rich**\n")
    // unstructured HTML falls through to the markdown rule
    const code = clipboard({ "text/html": "<div><span>x</span></div>", "text/plain": "# Title\n\n- a" })
    expect(asMarkdown(schema.parsePaste(code))).toBe("# Title\n\n- a\n")
  })

  test("plain text paste keeps markdown characters literal", () => {
    const schema = createSchema([starterKit(), plainTextPaste()])
    const nodes = schema.parsePaste(clipboard({ "text/plain": "# not a heading\nsecond line\n\n- not a list" }))
    expect(asMarkdown(nodes)).toBe("\\# not a heading\nsecond line\n\n\\- not a list\n")
  })

  test("no paste plugins: the editor's own paste handles it", () => {
    expect(createSchema([starterKit()]).parsePaste(clipboard({ "text/plain": "x" }))).toBeNull()
  })
})
