// Types for errors.js (also used by the browser-only build).
export class ApiError extends Error {
  constructor(status: number, code: string, message: string, field?: string)
  status: number
  code: string
  field?: string
}
export function bad(code: string, message: string, field?: string): ApiError
export function notFound(code: string, message: string): ApiError
export function errorHandler(err: unknown, req: unknown, res: unknown, next: unknown): unknown
