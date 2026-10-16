// Unified error format: { error: { code, message, field? } }
export class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const bad = (code, message, field) => new ApiError(400, code, message, field);
export const notFound = (code, message) => new ApiError(404, code, message);

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    const body = { code: err.code, message: err.message };
    if (err.field) body.field = err.field;
    return res.status(err.status).json({ error: body });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'リクエストの形式が正しくありません' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'サーバーでエラーが発生しました' } });
}
