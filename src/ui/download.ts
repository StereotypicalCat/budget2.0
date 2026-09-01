/** Triggers a browser download. Works only in a real page, not in tests. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a turn to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
