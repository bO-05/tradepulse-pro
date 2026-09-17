/**
 * Extracts a user-actionable message from Convex/client errors.
 * ConvexError payloads arrive on `error.data`; plain server errors are masked as
 * "[CONVEX ...] Server Error" and must not be shown verbatim to end users.
 */
export function getErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (!err) return fallback;
  const anyErr = err as any;

  const data = anyErr.data;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
    try {
      const json = JSON.stringify(data);
      if (json && json !== "{}") return json;
    } catch {
      // fall through to message handling
    }
  }

  const message = anyErr.message;
  if (typeof message === "string" && message.trim()) {
    if (!message.includes("[CONVEX")) return message.trim();
    const afterServerError = message.split(/Server Error/i)[1]?.trim();
    if (afterServerError && !/^Called by client/i.test(afterServerError)) {
      return afterServerError;
    }
  }

  return fallback;
}