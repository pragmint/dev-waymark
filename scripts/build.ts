import { $ } from "bun"
import { build } from "bun";
import { globSync } from "node:fs";

const files = globSync("src/frontend/scripts/*.ts");

await build({
  entrypoints: files,
  outdir: "resources/public",
  naming: "[dir]/[name].js",
});


await $`sass src/styles/main.scss:resources/public/style.css`
