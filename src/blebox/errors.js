// -----------------------------------------------------------------------------
// The failures of a request to a device, by kind. Messages are our own words
// only: never an address, a header, a password or a body.
// -----------------------------------------------------------------------------

/**
 * - timeout:     no complete answer in time
 * - unreachable: no connection, or a connection lost
 * - late:        a command could not leave before its deadline (nothing sent)
 * - auth:        HTTP 401/403, the credentials are refused
 * - busy:        HTTP 429 or 5xx, the device asks for a pause
 * - http:        another HTTP status
 * - invalid:     not the JSON a BleBox device answers
 * - tooLarge:    the answer exceeds the size cap
 */
export class BleBoxError extends Error {
  constructor(kind, { status, sent = false, retryAfter } = {}) {
    super(status ? `${kind} (HTTP ${status})` : kind);
    this.name = 'BleBoxError';
    this.kind = kind;
    this.status = status;
    this.sent = sent;
    this.retryAfter = retryAfter;
  }
}

/** A short reason for the logs and the user: the kind, and the status if any. */
export const reasonOf = (err) => (err instanceof BleBoxError ? err.message : 'unexpected error');
