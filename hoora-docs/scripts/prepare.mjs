import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("public/vendor", { recursive: true });
await mkdir("public/fonts", { recursive: true });
await Promise.all([
  build({
    entryPoints: ["src/uploads.js"],
    outdir: "public/vendor",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    minify: true,
  }),
  build({
    entryPoints: ["src/markdown.js"],
    outfile: "public/vendor/markdown.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    legalComments: "eof",
  }),
  build({
    entryPoints: ["src/oauth.js"],
    outfile: "public/vendor/oauth.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    legalComments: "eof",
  }),
  build({
    entryPoints: ["src/rich-editor.js"],
    outfile: "public/vendor/rich-editor.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    legalComments: "eof",
  }),
  copyFile(
    "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
    "public/fonts/geist-latin.woff2",
  ),
]);
await writeFile(
  "public/fonts.css",
  "@font-face{font-family:Geist;font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/geist-latin.woff2') format('woff2')}\n",
);
console.log("Prepared local Markdown, OAuth, and font assets.");
