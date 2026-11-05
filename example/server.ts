import index from "./index.html"
import chat from "./chat.html"

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: { "/": index, "/chat.html": chat },
  development: { hmr: true, console: true },
})

console.log(`herald playground: ${server.url}`)
