export const APP_ERROR_CODE = {
  Unknown: 'UNKNOWN',

  AiResponseEmpty: 'AI_RESPONSE_EMPTY',
  AiResponseParseFailed: 'AI_RESPONSE_PARSE_FAILED',
  AiResponseInvalid: 'AI_RESPONSE_INVALID',
} as const;

export type AppErrorCode = typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE];

export type AppError = Error & {
  code: AppErrorCode;
  cause?: unknown;
  context?: Record<string, unknown>;
};

export function appError(
  code: AppErrorCode,
  message: string,
  options: { cause?: unknown; context?: Record<string, unknown> } = {}
): AppError {
  const error = new Error(message) as AppError;
  error.name = 'AppError';
  error.code = code;
  if (options.cause !== undefined) error.cause = options.cause;
  if (options.context !== undefined) error.context = options.context;
  return error;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof Error && 'code' in error;
}

