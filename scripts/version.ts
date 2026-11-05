// Sets one version on every package (they release together). Usage: bun scripts/version.ts 0.2.0
import { Glob } from "bun"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: bun scripts/version.ts <semver>")
  process.exit(1)
}
for await (const path of new Glob("packages/*/package.json").scan()) {
  const pkg = await Bun.file(path).json()
  pkg.version = version
  await Bun.write(path, JSON.stringify(pkg, null, 2) + "\n")
  console.log(`${pkg.name} -> ${version}`)
}
