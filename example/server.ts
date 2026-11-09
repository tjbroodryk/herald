import index from "./index.html"
import chat from "./chat.html"
import shadcn from "./shadcn.html"
import documentPage from "./document.html"

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { "/": index, "/chat.html": chat, "/document.html": documentPage, "/shadcn.html": shadcn },
  development: { hmr: true, console: true },
})

console.log(`herald playground: ${server.url}`)
