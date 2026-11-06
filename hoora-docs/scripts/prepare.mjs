import { build } from "esbuild";
import { mkdir, copyFile, writeFile, rm, cp } from "node:fs/promises";
await rm(new URL('../public/vendor/', import.meta.url), {recursive:true,force:true});
await mkdir("public/vendor", { recursive: true });
await mkdir("public/fonts", { recursive: true });
await Promise.all([
  cp('node_modules/pdfjs-dist/cmaps','public/vendor/pdf/cmaps',{recursive:true}),
  cp('node_modules/pdfjs-dist/standard_fonts','public/vendor/pdf/standard_fonts',{recursive:true}),
  cp('node_modules/pdfjs-dist/wasm','public/vendor/pdf/wasm',{recursive:true}),
  build({entryPoints:["src/pdf-viewer.js"],outfile:"public/vendor/pdf-viewer.js",bundle:true,format:"esm",platform:"browser",minify:true}),
  copyFile("node_modules/pdfjs-dist/build/pdf.worker.min.mjs","public/vendor/pdf.worker.min.mjs"),
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
