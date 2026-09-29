// Shared lazy PDF.js runtime. Import and rendering use one engine/worker setup.
export async function pdfEngine() {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdf;
}
