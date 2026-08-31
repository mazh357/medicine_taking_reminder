export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ILLEGAL_STATE_TRANSITION'
  | 'EVIDENCE_REQUIRED'
  | 'QUANTITY_REQUIRED'
  | 'QUANTITY_INVALID'
  | 'QUANTITY_ASSERTION_MISMATCH'
  | 'WINDOW_ORDER_INVALID'
  | 'ALREADY_REVOKED'
  | 'LEDGER_INVARIANT_VIOLATION'
  | 'TRANSACTION_FAILED';

export interface DomainError {
  code: DomainErrorCode;
  messageKey: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean>;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: DomainErrorCode,
  messageKey: string,
  retryable = false,
  details?: DomainError['details'],
): Result<never> => ({
  ok: false,
  error: { code, messageKey, retryable, ...(details ? { details } : {}) },
});

export class DomainRuleError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly messageKey: string,
    readonly details?: DomainError['details'],
  ) {
    super(messageKey);
    this.name = 'DomainRuleError';
  }
}

export function toDomainError(error: unknown): DomainError {
  if (error instanceof DomainRuleError) {
    return {
      code: error.code,
      messageKey: error.messageKey,
      retryable: error.code === 'VERSION_CONFLICT',
      ...(error.details ? { details: error.details } : {}),
    };
  }

  return {
    code: 'TRANSACTION_FAILED',
    messageKey: 'error.transaction_failed',
    retryable: true,
  };
}
