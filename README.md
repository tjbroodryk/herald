# herald

A prompt editor for LLM apps: `@` mentions, `/` commands, typed agent inputs and output shapes. It compiles what people write into a prompt and gives you typed queries over it ("every tool this prompt mentions").

Live demo: https://tjbroodryk.github.io/herald/ (prompt editor and chat input).

Not published yet. To try it, clone the repo and run the playground (see Developing below).

## Layout

| Directory | What | Depends on |
|---|---|---|
| `packages/core` | JSON model, plugins, `compile`, traversal, JSON codec, the `EditorAdapter` interface | nothing |
| `packages/markdown` | markdown codec, parser, serializer | core, `@lezer/markdown` |
| `packages/agent` | `agentInputs`, `outputShape`, `toolKind` | core |
| `packages/codemirror` | the CodeMirror editor adapter | core, markdown, CodeMirror (peer) |
| `packages/react` | `PromptEditor`, menus, toolbar, `Inspector`, `DocView`, default `styles.css` | core, markdown, agent, React (peer) |

Only the editor adapter depends on an editor engine. The React package talks to the editor only through `EditorAdapter`, so it works the same with the CodeMirror adapter or a future ProseMirror one.

The doc is plain JSON in the same shape as ProseMirror/TipTap (`{ type, attrs, content, marks, text }`), so a server can read, query and compile it without an editor.

## Define a schema

```ts
import { createSchema, mentions, section, starterKit } from "@herald/core"
import { agentInputs, outputShape, toolKind } from "@herald/agent"

export const mention = mentions({
  tool: toolKind(), // collects into `collected.tools`, lists them at the end, flags unknown tools
  user: { label: "User", compile: (a) => `@${a.label} (user ${a.id})` },
  document: {
    label: "Document",
    compile: async (a, ctx) => ctx.compileRef("document", a.id, a.label), // fetched, compiled recursively
  },
})

export const schema = createSchema([starterKit(), mention, section, agentInputs(), outputShape()])
```

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
agentInputs.get(doc)           // [{ name, type, description }]
agentInputs.validate(doc, values) // ["ticket_id is required"]
outputShape.jsonSchema(doc)    // JSON Schema for structured output
schema.diagnose(doc, { tools: knownToolIds }) // unknown tools, undeclared inputs, bad attrs…
```

## Compile

```ts
const out = await schema.compile(doc, {
  resolve: { document: { many: (ids) => db.docs.getMany(ids) } }, // or (id) => db.docs.get(id)
  mode: "markdown", // or "plain"
  signal,
})
out.prompt          // the text
out.collected.tools // ["search_web", "crm_lookup"]
out.diagnostics     // cycles, missing refs
```

Resolvers can be async. Requests at the same depth go out together (one `many` call per depth), repeats are fetched once, cycles and missing refs fall back to the given text and show up in `diagnostics`. A resolver that throws rejects the compile unless you pass `onError: "fallback"`. `override: { mention: (n) => … }` swaps any node's compiler for one call.

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
Use @[Search web](tool:search_web) and :inputRef[customer]{name="customer_id"}.

:::section{title="Rules" color="amber"}
Blocks with content are directives.
:::

```herald:outputShape
{ "fields": [{ "name": "summary", "type": "string" }] }
```
```

Any node type without its own syntax gets one of these forms, so a custom node round-trips without extra code. For another format, implement `Codec<T>` (`encode`, `decode`).

One departure from CommonMark: every newline inside a paragraph is a line break (`hardBreak`), not a space. A prompt keeps the lines the person typed.

## React

```tsx
import { codemirror } from "@herald/codemirror"
import { Inspector, PromptEditor, trigger, useEditor } from "@herald/react"
import "@herald/react/styles.css"

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

<PromptEditor editor={editor} />
<Inspector editor={editor} compile={compileOptions} /> // prompt, JSON, markdown, collected values, diagnostics
```

`Inspector` is meant for your own app too: drop it next to the editor while building, to see exactly what the model will get. Pass `compile`/`diagnose` options that are stable across renders (module constants or `useMemo`).

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

### Styling

- Import `styles.css` and you're done. Dark mode follows the system; `data-theme="dark"|"light"` on any ancestor overrides it.
- Restyle with variables: `--herald-font`, `--herald-accent`, `--herald-radius`, `--herald-color-tool`… (see the top of `styles.css`; `example/app.css` maps them onto a design system).
- All defaults live in `@layer herald`, so your own CSS wins without `!important`. With Tailwind v4, declare `@layer herald, theme, base, components, utilities;`.
- `classNames`, `components={{ Menu, Toolbar }}` and `views={{ inline, block }}` replace parts; `unstyled` drops the stylesheet's hooks entirely.

## Known limits

- Bold, italic and strike can't open next to punctuation inside a word in markdown (`a**-b**`), so that case doesn't survive a markdown round trip. Normal word-boundary formatting does.
- Unknown marks are kept in JSON but dropped from markdown.
- A `:::` directive inside a list item or blockquote isn't supported; put the list inside the directive.
- Fields in `inputs`/`outputShape` are one level deep.
- Only the CodeMirror adapter exists. `EditorAdapter` in core is the interface a ProseMirror adapter would implement.

## Developing

```sh
bun install
bun run example   # playground at http://localhost:3000 and /chat.html
bun test
bun check
bun run build     # packages/*/dist: ESM + .d.ts (+ styles.css), built in dependency order
```

The packages are Bun workspaces. Inside the repo, imports between them resolve to source through `paths` in `tsconfig.json`, so tests and the example need no build.

## CI and the demo site

- `ci.yml`: type checks, tests, the package build and the site build on every push and pull request.
- `pages.yml`: builds the examples (`bun run build:site`) and deploys them to GitHub Pages on every push to `main`.
- `release.yml`: ready for when the packages are published; it runs only on a `v*` tag, and no tags exist yet.
