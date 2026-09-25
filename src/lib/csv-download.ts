export type CsvDownloadAnchor = HTMLAnchorElement;

export type CsvDownloadDependencies = {
  createBlob: (parts: BlobPart[], options: BlobPropertyBag) => Blob;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createAnchor: () => CsvDownloadAnchor;
  appendAnchor: (anchor: CsvDownloadAnchor) => void;
  clickAnchor: (anchor: CsvDownloadAnchor) => void;
  removeAnchor: (anchor: CsvDownloadAnchor) => void;
  scheduleCleanup: (callback: () => void) => void;
};

export type CsvDownloadDispatchResult =
  | { dispatched: true }
  | { dispatched: false; error: unknown };

const browserCsvDownloadDependencies: CsvDownloadDependencies = {
  createBlob: (parts, options) => new Blob(parts, options),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"),
  appendAnchor: (anchor) => document.body.appendChild(anchor),
  clickAnchor: (anchor) => anchor.click(),
  removeAnchor: (anchor) => anchor.remove(),
  scheduleCleanup: (callback) => window.setTimeout(callback, 0),
};

function safelyRun(action: () => void) {
  try {
    action();
  } catch {
    // A cleanup failure must not hide the original dispatch failure.
  }
}

export function dispatchCsvDownload(
  filename: string,
  csv: string,
  dependencies: CsvDownloadDependencies = browserCsvDownloadDependencies,
): CsvDownloadDispatchResult {
  let objectUrl: string | null = null;
  let anchor: CsvDownloadAnchor | null = null;

  try {
    const blob = dependencies.createBlob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    objectUrl = dependencies.createObjectUrl(blob);
    anchor = dependencies.createAnchor();
    anchor.href = objectUrl;
    anchor.download = filename;

    dependencies.appendAnchor(anchor);
    dependencies.clickAnchor(anchor);
    dependencies.removeAnchor(anchor);
    anchor = null;
    const scheduledUrl = objectUrl;
    dependencies.scheduleCleanup(() => dependencies.revokeObjectUrl(scheduledUrl));

    return { dispatched: true };
  } catch (error) {
    const failedAnchor = anchor;
    if (failedAnchor) {
      safelyRun(() => dependencies.removeAnchor(failedAnchor));
    }

    const failedUrl = objectUrl;
    if (failedUrl) {
      safelyRun(() => dependencies.revokeObjectUrl(failedUrl));
    }

    return { dispatched: false, error };
  }
}
