# herald

A prompt editor for LLM apps: `@` mentions, `/` commands, typed agent inputs and output shapes. It compiles what people write into a prompt and gives you typed queries over it ("every tool this prompt mentions").

Live demo: https://tjbroodryk.github.io/herald/ (prompt editor, chat input, and the shadcn version).

Not published yet. To try it, clone the repo and run the playground (see Developing below).

## Layout

| Directory | What | Depends on |
|---|---|---|
| `packages/core` | JSON model, plugins, `compile`, traversal, JSON codec, the `EditorAdapter` interface | nothing |
| `packages/markdown` | markdown codec, parser, serializer | core, `@lezer/markdown` |
| `packages/paste` | paste plugins: `htmlPaste`, `markdownPaste`, `plainTextPaste` | core, markdown |
| `packages/agent` | `agentInputs`, `outputShape`, `toolKind` | core |
| `packages/codemirror` | the CodeMirror editor adapter | core, markdown, CodeMirror (peer) |
| `packages/react` | headless hooks: `useEditor`, `usePromptEditor`, `useFields`, `useInspector`, `DocView` | core, markdown, agent, React (peer) |
| `packages/ui` | the ready-styled look: `PromptEditor`, `Inspector`, `DocView` and `styles.css` | react |
| `packages/shadcn` | the shadcn registry: the same components as Tailwind source you copy into your app | react |

Only the editor adapter depends on an editor engine. Everything above it talks to the editor through `EditorAdapter`, so it works the same with the CodeMirror adapter or a future ProseMirror one.

The doc is plain JSON in the same shape as ProseMirror/TipTap (`{ type, attrs, content, marks, text }`), so a server can read, query and compile it without an editor.

## Define a schema

A schema is a list of plugins. Mention kinds are yours to name: each key you pass to `mentions` becomes a kind, stored in the JSON as `kind: "<key>"`. `toolKind()` is a ready-made definition for tools; nothing else is built in.

```ts
import { createSchema, mentions, section, starterKit } from "@herald/core"
import { agentInputs, outputShape, toolKind } from "@herald/agent"

export const mention = mentions({
  tool: toolKind(), // collects into `collected.tools`, lists them at the end, flags unknown tools
  user: { label: "User", compile: (a) => `@${a.label} (user ${a.id})` },
  document: {
    label: "Document",
    // "document" here names a resolver you pass to compile (below)
    compile: async (a, ctx) => ctx.compileRef("document", a.id, a.label),
  },
})

// agent plugins are opt-in; keep the instances to query docs with them
export const inputs = agentInputs()
export const output = outputShape()

export const schema = createSchema([starterKit(), mention, section, inputs, output])
```

The inputs and output-shape blocks hold typed fields (`FieldType.String`, `Number`, `Boolean`, `Object`, `Array`). Object fields have their own `fields`, and arrays have an `items` shape, to any depth. Both turn into JSON Schema, and the editors for them nest the same way.

Types and values the library defines are constant objects with a matching type, rather than bare strings: `NodeType`, `MarkType`, `FieldType`, `CompileMode`, `DiagnosticCode`, `EditorPart` and so on. The JSON still stores the plain strings.

A custom node is one definition: its attrs (any Standard Schema validator), how it compiles, and its `/` menu entry.

```ts
const callout = defineNode({
  type: "callout",
  attrs: z.object({ tone: z.enum(["info", "warn"]) }),
  compile: async (node, ctx) => `${node.attrs.tone.toUpperCase()}: ${await ctx.children()}`,
  slash: [{ id: "callout", label: "Callout", insert: () => ({ type: "callout", attrs: { tone: "info" }, content: [{ type: "paragraph" }] }) }],
})
```

## Work with the JSON

```ts
const doc = schema.parse(row.editor_state) // validates attrs, keeps unknown nodes, normalizes

mention.tool.all(doc)          // [{ kind: "tool", id: "search_web", label: "Search web" }, …]
find(doc, mention.user)        // the nodes
replace(doc, mention.tool, (n) => …) // renames, returns a new doc
inputs.get(doc)                // [{ name, type, description }]
inputs.validate(doc, values)   // ["ticket_id is required", "orders[1].sku should be string, got number"]
output.jsonSchema(doc)         // JSON Schema for structured output
schema.diagnose(doc, { tools: knownToolIds }) // unknown tools, undeclared inputs, bad attrs…
```

## Compile

```ts
const out = await schema.compile(doc, {
  resolve: { document: { many: (ids) => db.docs.getMany(ids) } }, // or (id) => db.docs.get(id)
  mode: CompileMode.Markdown, // or CompileMode.Plain
  signal,
})
out.prompt          // the text
out.collected.tools // ["search_web", "crm_lookup"]
out.diagnostics     // cycles, missing refs
```

Resolvers can be async. Requests at the same depth go out together (one `many` call per depth), repeats are fetched once, cycles and missing refs fall back to the given text and show up in `diagnostics`. A resolver that throws rejects the compile unless you pass `onError: OnResolveError.Fallback`. `override: { [NodeType.Mention]: (n) => … }` swaps any node's compiler for one call.

## Storage

The doc can be stored as JSON or as markdown, and both convert back to the same JSON:

```ts
import { json } from "@herald/core"
import { markdown } from "@herald/markdown"

markdown.encode(doc) // string
markdown.decode(text) // doc; decode(encode(doc)) equals normalize(doc)
```

Herald's markdown adds three things to CommonMark:

```md
Use @[Search web](tool:search_web), and a custom inline node: :badge[beta]{tone="info"}.

:::section{title="Rules" color="amber"}
Blocks with content are directives.
:::

```herald:outputShape
{ "fields": [{ "name": "summary", "type": "string" }] }
```
```

Any node type without its own syntax gets one of these forms, so a custom node round-trips without extra code. For another format, implement `Codec<T>` (`encode`, `decode`).

One departure from CommonMark: every newline inside a paragraph is a line break (`hardBreak`), not a space. A prompt keeps the lines the person typed.

## Tables

Markdown tables (GitHub's pipe syntax, with `:---:` alignment) are built in. In the JSON they have TipTap's shape (`table` > `tableRow` > `tableHeader`/`tableCell` > `paragraph`), so existing TipTap tables load as they are. Cells hold inline content, so mentions, code and bold work inside them.

```md
| Amount | Decision | Who |
| :--- | :---: | --- |
| over $500 | `escalate` | @[Ana Ruiz](user:u_ana) |
```

- In the editor a table shows rendered. Click into it (or arrow into it) and its markdown shows for editing; move out and it renders again.
- `tables()` adds a "Table" entry to the `/` menu.
- Tables compile to a markdown table, or in `CompileMode.Plain` to one line per row with cells separated by ` | `.
- Markdown cells are one line, so normalize puts each cell on one line, makes the first row the header, pads rows to the widest one, and drops TipTap's colspan/rowspan/colwidth.

## Paste

Which clipboard formats become document content is up to you: paste formats are plugins in `@herald/paste`, listed in priority order. The first one that produces content wins; with none, the editor pastes as it normally would (CodeMirror inserts the text as typed, which is markdown).

```ts
import { htmlPaste, markdownPaste, plainTextPaste } from "@herald/paste"

createSchema([starterKit(), tables(), htmlPaste(), markdownPaste()]) // rich text first, then text as markdown
createSchema([starterKit(), plainTextPaste()])                       // text only, markdown characters kept literal
```

- `htmlPaste()` converts copied HTML from web pages, Google Docs, Word and Notion: headings, lists, links (http, https and mailto only), bold, italic, strike, code, quotes and tables. HTML with no structure, such as styled spans copied from a code editor, is passed to the next rule.
- `markdownPaste()` reads pasted text as markdown.
- `plainTextPaste()` inserts text literally; blank lines separate paragraphs.
- Write your own: a plugin with `paste: [{ mime, parse(data) }]`, where `parse` returns nodes or null to pass.

## React: one engine, three ways to render it

All three share the same editor setup:

```tsx
import { codemirror } from "@herald/codemirror"
import { trigger, useEditor } from "@herald/react"

const editor = useEditor({
  schema,
  adapter: codemirror({ placeholder: "Type / for blocks, @ to mention" }),
  content: savedMarkdownOrDoc,
  onChange: (doc) => save(markdown.encode(doc)),
  triggers: [
    trigger("/", { items: "slash" }),
    trigger("@", { items: async (q) => (await searchTools(q)).map((t) => mention.tool.item({ id: t.id, label: t.name })) }),
  ],
})
```

**Ready-styled (`@herald/ui`).** Plain CSS classes, themed with `--herald-*` variables.

```tsx
import { Inspector, PromptEditor } from "@herald/ui"
import "@herald/ui/styles.css"

<PromptEditor editor={editor} />
<Inspector editor={editor} compile={compileOptions} /> // prompt, JSON, markdown, collected values, diagnostics
```

- Dark mode follows the system; `data-theme="dark"|"light"` on any ancestor overrides it.
- Restyle with variables: `--herald-font`, `--herald-accent`, `--herald-radius`, `--herald-color-tool`… (see the top of `styles.css`; `example/app.css` maps them onto a design system).
- All defaults live in `@layer herald`, so your own CSS wins without `!important`.
- `classNames`, `components={{ Menu, Toolbar }}` and `useEditor({ views })` replace parts.

**shadcn (`packages/shadcn`).** The same components as Tailwind source, using your shadcn theme tokens (`bg-popover`, `text-muted-foreground`, `ring`, `--radius`) and `cn()`. Add them with the shadcn CLI and they're files in your app:

```sh
npx shadcn add https://tjbroodryk.github.io/herald/r/herald-prompt-editor.json
npx shadcn add https://tjbroodryk.github.io/herald/r/herald-inspector.json
npx shadcn add https://tjbroodryk.github.io/herald/r/herald-doc-view.json
```

The editor's own parts (headings, chips, sections, drag handles) are styled by the `editorClasses` map at the top of `herald-prompt-editor.tsx`. The mention colours come from `--herald-color-*` variables the registry item adds to your theme, mapped to your chart colours. The components install the `@herald/*` packages as dependencies, so the CLI only works once those are published. `example/shadcn.tsx` uses the registry source directly.

**Headless (`@herald/react`).** The behaviour without markup, for building your own look. `usePromptEditor(editor, { views, classes, onSubmit })` mounts the editor and returns `{ ref, menu, toolbar }`: put `ref` on an empty div, and render `menu.items` and `toolbar.items` however you like, positioned with the `style` each provides. `useFields` drives the inputs and output-shape blocks, and `useInspector` the inspector. Both styled packages are built this way.

### Inspector

`Inspector` is meant for your own app too: drop it next to the editor while building, to see exactly what the model will get. Pass `compile`/`diagnose` options that are stable across renders (module constants or `useMemo`).

### Moving blocks

Top-level blocks get a drag handle, and ⌥⇧↑/↓ moves the block under the cursor. A section moves with everything in it; nothing can be dropped inside a section or list. Turn it off with `codemirror({ draggable: false })`.

### As a chat input

```tsx
const editor = useEditor({
  schema,
  adapter: codemirror({ placeholder: "Message…", draggable: false }),
  triggers: [trigger("/", { items: commandItems }), trigger("@", { items: mentionItems })],
})

<PromptEditor
  editor={editor}
  onSubmit={(doc) => {        // Enter sends, Shift+Enter is a new line; an open menu gets Enter first
    send(doc)
    editor.setDoc({ type: "doc" })
  }}
/>

<DocView doc={message} schema={schema} /> // read-only rendering of a sent message, chips included
```

`example/chat.tsx` has the whole thing, with `/` commands as a mention kind (`prefix: "/"`) that compile into a task line at the top of the prompt. Menus open upward when there's no room below.

## Known limits

- Bold, italic and strike can't open next to punctuation inside a word in markdown (`a**-b**`), so that case doesn't survive a markdown round trip. Normal word-boundary formatting does.
- Unknown marks are kept in JSON but dropped from markdown.
- A `:::` directive inside a list item or blockquote isn't supported; put the list inside the directive.
- Only the CodeMirror adapter exists. `EditorAdapter` in core is the interface a ProseMirror adapter would implement.

## Developing

```sh
bun install
bun run example     # playground at http://localhost:3000, /chat.html and /shadcn.html
bun test
bun check
bun run build       # packages/*/dist: ESM + .d.ts (+ styles.css), built in dependency order
bun run build:site  # site/: the three example pages and the shadcn registry JSON at site/r/
```

The packages are Bun workspaces. Inside the repo, imports between them resolve to source through `paths` in `tsconfig.json`, so tests and the example need no build. The same `paths` resolve the registry files' `@/lib/utils` and `@/registry/herald/*` imports, which the shadcn CLI rewrites to your aliases on install.

## CI and the demo site

- `ci.yml`: type checks, tests, the package build and the site build on every push and pull request.
- `pages.yml`: builds the site (`bun run build:site`) and deploys it to GitHub Pages on every push to `main`, which also serves the shadcn registry.
- `release.yml`: ready for when the packages are published; it runs only on a `v*` tag, and no tags exist yet.
