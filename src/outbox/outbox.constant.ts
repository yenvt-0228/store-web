// How often the relay looks for events waiting to be published. Short enough
// that a consumer sees an order within seconds, long enough that an idle
// database is not polled constantly.
export const OUTBOX_POLL_INTERVAL_MS = 5_000;

// Rows read per tick. A backlog is drained over several ticks rather than in
// one transaction that holds the connection for minutes.
export const OUTBOX_BATCH_SIZE = 100;

// Publishing failures per row before it is parked as FAILED. A row that failed
// this often is not a broker hiccup any more; it needs somebody to look at it,
// and retrying it forever would block every event queued behind it.
export const OUTBOX_MAX_ATTEMPTS = 10;

// Published rows are kept for a while: they are the log that answers "was this
// event ever sent?" during an incident.
export const OUTBOX_KEEP_SENT_DAYS = 7;

// Postgres would take the whole message, but a driver stack trace in a column
// nobody reads is not worth the row size.
export const OUTBOX_ERROR_MAX_LENGTH = 500;
