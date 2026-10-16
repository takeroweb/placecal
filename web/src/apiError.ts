/** Error shape used by the UI for both the server API and the on-device backend. */
export class ApiError extends Error {
  code: string
  field?: string
  status: number
  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
  }
}
