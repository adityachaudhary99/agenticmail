import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  // Pass method/path as separate arguments rather than concatenating
  // into the format string. CodeQL `js/tainted-format-string` —
  // although `console.error` doesn't actually do printf-style
  // interpretation in Node, putting user input on the LHS of the
  // call confuses static analyzers and risks regressing if a
  // future logger replaces console.error.
  console.error('[ERROR] %s %s:', req.method, req.path, err instanceof Error ? err.stack || message : message);

  // Don't send response if headers already sent (e.g., SSE streams)
  if (res.headersSent) return;

  // JSON parse error from express.json() middleware
  if (err instanceof SyntaxError && (err as any).status === 400) {
    res.status(400).json({ error: 'Invalid JSON in request body' });
    return;
  }

  // Use explicit status if set on the error object
  if (typeof err.statusCode === 'number') {
    res.status(err.statusCode).json({ error: message });
    return;
  }

  // Pattern-match common error messages (fallback heuristic)
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('not found') && !lowerMsg.includes('not found a')) {
    res.status(404).json({ error: message });
    return;
  }

  if (lowerMsg.includes('already exists') || lowerMsg.includes('unique constraint')) {
    res.status(409).json({ error: 'Resource already exists' });
    return;
  }

  if (lowerMsg.includes('invalid') || lowerMsg.includes('required') || lowerMsg.includes('must ')) {
    res.status(400).json({ error: message });
    return;
  }

  res.status(500).json({ error: message || 'Internal server error' });
}
