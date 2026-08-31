export type LocalSecurityErrorCode =
  | 'DATABASE_KEY_UNAVAILABLE'
  | 'DATABASE_KEY_INVALID'
  | 'DATABASE_AUTHENTICATION_FAILED'
  | 'LEGACY_DATA_CLEANUP_FAILED';

export class LocalSecurityError extends Error {
  constructor(
    readonly code: LocalSecurityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocalSecurityError';
  }
}

export class DatabaseKeyUnavailableError extends LocalSecurityError {
  constructor() {
    super(
      'DATABASE_KEY_UNAVAILABLE',
      '本机数据密钥不可用。数据未被清除，请勿反复重试或重新安装。',
    );
    this.name = 'DatabaseKeyUnavailableError';
  }
}

export class DatabaseKeyInvalidError extends LocalSecurityError {
  constructor() {
    super(
      'DATABASE_KEY_INVALID',
      '本机数据密钥状态异常。数据未被清除，需要先处理密钥问题。',
    );
    this.name = 'DatabaseKeyInvalidError';
  }
}

export class DatabaseAuthenticationError extends LocalSecurityError {
  constructor() {
    super(
      'DATABASE_AUTHENTICATION_FAILED',
      '无法验证本机加密数据。数据未被清除，请勿继续写入。',
    );
    this.name = 'DatabaseAuthenticationError';
  }
}

export class LegacyDataCleanupError extends LocalSecurityError {
  constructor() {
    super(
      'LEGACY_DATA_CLEANUP_FAILED',
      '旧测试数据未能完整清除，因此尚未启用个人数据存储。',
    );
    this.name = 'LegacyDataCleanupError';
  }
}
