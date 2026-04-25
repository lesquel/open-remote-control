// ─── Error base ────────────────────────────────────────────────────────────

export class PilotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 500,
  ) {
    super(message)
    this.name = "PilotError"
  }
}
