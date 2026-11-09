import type { HeraldDoc } from "@herald/core"

const reply = { id: "r1", authorId: "u1", authorName: "Ada", body: "SECRET-REPLY-BODY", createdAt: "2026-11-01T10:00:00.000Z" }

/**
 * A document as cotera's TipTap editor saves it, with one of each thing Herald doesn't model: colour, highlight,
 * textStyle, textAlign, superscript, subscript, uniqueId attrs on blocks, taskList/taskItem, a custom section node,
 * comments, and table cells with blocks and colspan/rowspan/colwidth. Marks are in Herald's canonical order.
 */
export const tiptapDoc: HeraldDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h-1", level: 1, textAlign: "left" }, content: [{ type: "text", text: "Quarterly plan" }] },
    {
      type: "paragraph",
      attrs: { id: "p-1", textAlign: "center" },
      content: [
        { type: "text", text: "  Leading spaces, " },
        { type: "text", marks: [{ type: "bold" }], text: "bold " },
        { type: "text", marks: [{ type: "textStyle", attrs: { color: "#958DF1", fontFamily: null } }], text: "violet" },
        { type: "text", text: " and " },
        { type: "text", marks: [{ type: "highlight", attrs: { color: "#fef08a" } }], text: "highlighted" },
        { type: "text", text: ", H" },
        { type: "text", marks: [{ type: "subscript" }], text: "2" },
        { type: "text", text: "O, x" },
        { type: "text", marks: [{ type: "superscript" }], text: "2" },
        { type: "text", text: ", " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "https://cotera.co", target: "_blank", rel: "noopener noreferrer nofollow", class: null } }],
          text: "a link",
        },
        { type: "text", text: " " },
        { type: "mention", attrs: { kind: "user", id: "u2", label: "Grace" } },
        { type: "hardBreak" },
      ],
    },
    { type: "paragraph", attrs: { id: "p-2", textAlign: null } },
    {
      type: "paragraph",
      attrs: { id: "p-3" },
      content: [
        { type: "text", text: "Review " },
        { type: "text", marks: [{ type: "comment", attrs: { commentId: "c1", resolved: false, replies: [reply] } }], text: "this " },
        {
          type: "text",
          marks: [
            { type: "comment", attrs: { commentId: "c1", resolved: false, replies: [reply] } },
            { type: "comment", attrs: { commentId: "c2", resolved: true, replies: [] } },
          ],
          text: "overlapping",
        },
        { type: "text", marks: [{ type: "comment", attrs: { commentId: "c2", resolved: true, replies: [] } }], text: " range" },
        { type: "text", text: " please." },
      ],
    },
    {
      type: "taskList",
      attrs: { id: "t-1" },
      content: [
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Ship it" }] }] },
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Tell people" }] }] },
      ],
    },
    {
      type: "documentSection",
      attrs: { id: "s-1", title: "Appendix", collapsed: false },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Inside a custom section." }] }],
    },
    {
      type: "table",
      attrs: { id: "tbl-1" },
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Area" }] }] },
            { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "First paragraph" }] },
                { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
              ],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
                    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "image", attrs: { src: "data:image/png;base64,iVBORw0KGgo=", alt: "diagram", title: "Flow", width: 320 } },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = 1\n" }] },
  ],
}
