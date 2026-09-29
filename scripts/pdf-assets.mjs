import { cp, mkdir } from "node:fs/promises";
const assets = ["cmaps", "standard_fonts", "wasm"];
await mkdir("public/pdfjs", { recursive: true });
await Promise.all(
  assets.map((name) =>
    cp(`node_modules/pdfjs-dist/${name}`, `public/pdfjs/${name}`, {
      recursive: true,
    }),
  ),
);
