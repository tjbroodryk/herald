// Builds the demo site for GitHub Pages: the three example pages, plus the shadcn registry JSON at site/r/.
import tailwind from "bun-plugin-tailwind"
import { $ } from "bun"

await $`rm -rf site`
const result = await Bun.build({
  entrypoints: ["example/index.html", "example/chat.html", "example/shadcn.html"],
  outdir: "site",
  minify: true,
  splitting: true,
  // relative asset URLs, so the site works under /herald/ on Pages
  publicPath: "./",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [tailwind],
})
if (!result.success) {
  console.error(result.logs.join("\n"))
  process.exit(1)
}
await $`bunx shadcn build registry.json --output ../../site/r`.cwd("packages/shadcn")
console.log(`site/: ${result.outputs.length} files, plus the shadcn registry in site/r/`)
