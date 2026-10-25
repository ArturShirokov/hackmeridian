import { extractText, getDocumentProxy } from "unpdf";

/** One string per page (index 0 = page 1). All empty = a scan with no text layer. Throws on a non-PDF. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdfjs detaches the buffer
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
