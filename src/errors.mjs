/** Errori tipizzati: main.mjs li traduce in codici di uscita distinti. */

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiError';
  }
}

export class HttpError extends ApiError {
  constructor(status, message, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export class MailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailError';
  }
}

/** Interno: la sessione è scaduta e va rifatta la login. */
export class SessionExpiredError extends Error {
  constructor(message = 'sessione scaduta') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}
