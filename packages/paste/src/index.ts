import { NodeType, normalize, PasteMime, type Plugin } from "@herald/core"
import { markdown } from "@herald/markdown"
import { htmlToNodes } from "./html"

// Paste formats are plugins: list the ones to accept, in priority order. The first one that produces content wins;
// with none, the editor pastes as it normally would (for CodeMirror, the text goes in as typed).

export { htmlToNodes } from "./html"

/**
 * Rich text copied from web pages, Google Docs, Word or Notion: headings, lists, links, bold/italic/strike, code,
 * quotes and tables. HTML with no structure at all (code editors copy styled divs) is left to the next rule.
 */
export function htmlPaste(options: { domParser?: DOMParser } = {}): Plugin {
  return {
    name: "htmlPaste",
    paste: [{ mime: PasteMime.Html, parse: (html) => htmlToNodes(html, options.domParser) }],
  }
}

/** Plain text read as markdown, so pasted `# Title` or `- item` becomes a heading or a list. */
export function markdownPaste(): Plugin {
  return {
    name: "markdownPaste",
    paste: [{ mime: PasteMime.Text, parse: (text) => markdown.decode(text).content ?? null }],
  }
}

/** Plain text inserted literally: `# Title` stays those characters. Blank lines separate paragraphs. */
export function plainTextPaste(): Plugin {
  return {
    name: "plainTextPaste",
    paste: [
      {
        mime: PasteMime.Text,
        parse: (text) => {
          const paragraphs = text
            .split(/\r?\n\s*\r?\n/)
            .filter((p) => p.trim())
            .map((p) => ({ type: NodeType.Paragraph, content: [{ type: NodeType.Text, text: p.replace(/\r\n/g, "\n") }] }))
          return normalize({ type: NodeType.Doc, content: paragraphs }).content ?? null
        },
      },
    ],
  }
}
