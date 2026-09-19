/**
 * A13-04: print a contract in an isolated document so the output is the full
 * draft with no app chrome or modal scroll clipping. Note: `noopener` in the
 * window features makes `window.open` return null in Chrome, which silently
 * broke the previous implementation — do not add it back here.
 */
export function printContractText(agreementNumber: string, contractText: string): boolean {
  const printWindow = window.open("", "_blank", "width=900,height=1000");
  if (!printWindow) return false;
  const escaped = contractText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  printWindow.document.write(
    `<!doctype html><html><head><title>${agreementNumber}</title><style>body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;white-space:pre-wrap;padding:24px;line-height:1.45;color:#111}</style></head><body>${escaped}</body></html>`
  );
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}