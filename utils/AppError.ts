export class AppError extends Error {
  public code?: string;

  constructor(public message: string, public statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}
