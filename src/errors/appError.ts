export const APP_ERROR_CODE = {
  Unknown: 'UNKNOWN',

  BadRequest: 'BAD_REQUEST',
  NotFound: 'NOT_FOUND',

  AiResponseEmpty: 'AI_RESPONSE_EMPTY',
  AiResponseParseFailed: 'AI_RESPONSE_PARSE_FAILED',
  AiResponseInvalid: 'AI_RESPONSE_INVALID',

  DbQueryFailed: 'DB_QUERY_FAILED',
  DbSerializeFailed: 'DB_SERIALIZE_FAILED',
  DbDeserializeFailed: 'DB_DESERIALIZE_FAILED',

  ConfigInvalid: 'CONFIG_INVALID',
} as const;

export type AppErrorCode = typeof APP_ERROR_CODE[keyof typeof APP_ERROR_CODE];

export type AppError = Error & {
  code: AppErrorCode;
  cause?: unknown;
  context?: Record<string, unknown>;
  status?: number;
  expose?: boolean;
};

export function appError(
  code: AppErrorCode,
  message: string,
  options: { cause?: unknown; context?: Record<string, unknown>; status?: number; expose?: boolean } = {}
): AppError {
  const error = new Error(message) as AppError;
  error.name = 'AppError';
  error.code = code;
  if (options.cause !== undefined) error.cause = options.cause;
  if (options.context !== undefined) error.context = options.context;
  if (options.status !== undefined) error.status = options.status;
  if (options.expose !== undefined) error.expose = options.expose;
  return error;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof Error && 'code' in error;
}

export function toAppError(
  cause: unknown,
  fallback: {
    code: AppErrorCode;
    message: string;
    context?: Record<string, unknown>;
    status?: number;
    expose?: boolean;
  } = { code: APP_ERROR_CODE.Unknown, message: 'Unknown error' }
): AppError {
  if (isAppError(cause)) return cause;
  return appError(fallback.code, fallback.message, {
    cause,
    context: fallback.context,
    status: fallback.status,
    expose: fallback.expose,
  });
}
