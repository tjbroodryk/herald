import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { createSchema, NodeType, starterKit, tables, type HeraldDoc, type HeraldNode } from "@herald/core"
import { htmlPaste } from "@herald/paste"
import { prosemirror } from "@herald/prosemirror"
import { DocView, PromptEditor, trigger, useDoc, useEditor } from "@herald/ui"
import "@herald/ui/styles.css"
import { tiptapDoc } from "../test/fixtures"
import { Nav, ThemeToggle } from "./chrome"
import { compileOptions, mention, mentionItems } from "./mentions"
import { TableGrid } from "./table-grid"

// A long rich document in the ProseMirror adapter: cotera's TipTap JSON loads and saves unchanged, tables are drawn
// by a grid override, comments live in the doc, images upload with a placeholder, and the editor flips read-only.

const schema = createSchema([starterKit(), mention, tables(), htmlPaste()])

// the cotera fixture, then enough prose to scroll
const longDoc: HeraldDoc = {
  type: NodeType.Doc,
  content: [
    ...tiptapDoc.content!,
    ...Array.from({ length: 12 }, (_, i): HeraldNode[] => [
      { type: NodeType.Heading, attrs: { level: 2 }, content: [{ type: NodeType.Text, text: `Section ${i + 1}` }] },
      {
        type: NodeType.Paragraph,
        content: [
          { type: NodeType.Text, text: "Long documents are edited as JSON, so a keystroke costs a transaction, not a markdown re-parse. " },
          { type: NodeType.Text, text: "Select some text and add a comment.", marks: [{ type: "italic" }] },
        ],
      },
    ]).flat(),
  ],
}

// pretend upload: half a second, then an object URL
const onImageFile = (file: File) =>
  new Promise<{ src: string }>((resolve) => setTimeout(() => resolve({ src: URL.createObjectURL(file) }), 500))

const overrides = { block: { table: TableGrid } }

function App() {
  const adapter = useMemo(() => prosemirror({ onImageFile }), [])
  const editor = useEditor({
    schema,
    adapter,
    content: longDoc,
    views: overrides,
    triggers: [trigger("@", { items: mentionItems }), trigger("/", { items: "slash" })],
  })
  const doc = useDoc(editor)
  const [editable, setEditable] = useState(true)
  const [asDocView, setAsDocView] = useState(false)
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null)
  const [body, setBody] = useState("")
  const [prompt, setPrompt] = useState("")

  useEffect(() => {
    schema.compile(doc, compileOptions).then((r) => setPrompt(r.prompt))
  }, [doc])

  const flip = () => {
    editor.setEditable(!editable)
    setEditable(!editable)
  }

  const startComment = () => {
    const sel = adapter.view?.state.selection
    if (!sel || sel.empty) {
      return
    }
    const range = { from: sel.from, to: sel.to }
    adapter.setCommentDraft(range)
    setDraft(range)
  }

  const saveComment = () => {
    if (!draft) {
      return
    }
    const reply = { id: crypto.randomUUID(), authorId: "me", authorName: "You", body, createdAt: new Date().toISOString() }
    adapter.addComment(draft, { commentId: crypto.randomUUID(), resolved: false, replies: [reply] })
    adapter.setCommentDraft(null)
    setDraft(null)
    setBody("")
  }

  // re-read on every doc change
  const comments = useMemo(() => (adapter.view ? adapter.commentsInDoc() : []), [doc])

  return (
    <div className="page">
      <header className="top">
        <h1>
          <span className="prompt">$</span> herald
        </h1>
        <Nav current="./document.html" />
        <div className="spacer" />
        <button type="button" className="btn" onClick={flip}>
          {editable ? "read-only" : "edit"}
        </button>
        <button type="button" className="btn" onClick={() => setAsDocView(!asDocView)} disabled={editable}>
          {asDocView ? "show editor" : "show DocView"}
        </button>
        <ThemeToggle />
      </header>

      <main className="grid">
        <section className="card">
          <div className="label">
            <span className="br">[</span> DOCUMENT <span className="br">]</span>
            <span className="muted">
              {editable ? "ProseMirror, editing" : asDocView ? "DocView" : "ProseMirror, read-only"} · paste or drop an image
            </span>
          </div>
          {/* the editor stays mounted while DocView shows, so flipping back keeps its scroll and state */}
          <div hidden={asDocView} className="doc-scroll">
            <PromptEditor editor={editor} />
          </div>
          {asDocView && (
            <div className="doc-scroll">
              <DocView doc={doc} schema={schema} overrides={overrides} />
            </div>
          )}
        </section>

        <section className="card">
          <div className="label">
            <span className="br">[</span> COMMENTS <span className="br">]</span>
            <span className="muted">stored in the doc, never in the prompt</span>
          </div>
          {draft ? (
            <div className="comment-composer">
              <textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" />
              <button type="button" className="btn" onClick={saveComment}>
                save
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  adapter.setCommentDraft(null)
                  setDraft(null)
                }}
              >
                cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={startComment} disabled={!editable}>
              comment on selection
            </button>
          )}
          <ul className="comment-list">
            {comments.map((c) => (
              <li key={c.commentId}>
                <q>{c.text}</q>
                {c.attrs.resolved && <span className="badge ok">resolved</span>}
                {c.attrs.replies.map((r) => (
                  <p key={r.id}>
                    <b>{r.authorName}</b> {r.body}
                  </p>
                ))}
                {editable && (
                  <span>
                    <button type="button" className="btn" onClick={() => adapter.updateComment(c.commentId, { resolved: !c.attrs.resolved })}>
                      {c.attrs.resolved ? "reopen" : "resolve"}
                    </button>{" "}
                    <button type="button" className="btn" onClick={() => adapter.removeComment(c.commentId)}>
                      delete
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="label">
            <span className="br">[</span> MODEL RECEIVES <span className="br">]</span>
          </div>
          <pre className="prompt-out">{prompt}</pre>
        </section>
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
