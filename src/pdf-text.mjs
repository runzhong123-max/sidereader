// Use the reader API supported by Safari as well as Chromium. PDF.js 6's
// getTextContent currently requires ReadableStream's newer async iterator.
export async function readPdfText(page) {
  const reader = page.streamTextContent().getReader();
  const text = { items: [], styles: Object.create(null), lang: null };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text;
      text.lang ??= value.lang;
      Object.assign(text.styles, value.styles);
      text.items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }
}
