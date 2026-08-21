// Minimal structured logging helper. Call sites attach a level and
// optional structured fields instead of hand-formatting a message
// string, so a log line stays greppable/filterable as more of them get
// added over time. Every line still carries the "[sticky-party]"
// prefix already used throughout the codebase (see e.g. lib/pb.ts's
// console.error calls), so migrating an existing call site to this
// later is a drop-in swap, not a change in what shows up in devtools.
//
// Only info/error exist for now, added on demand rather than
// speculatively -- add more levels here once a call site actually
// needs one (e.g. warn, debug).

const PREFIX = "[sticky-party]";

type LogFields = Record<string, unknown>;

function format(message: string, fields?: LogFields): unknown[] {
  return fields ? [PREFIX, message, fields] : [PREFIX, message];
}

export const log = {
  info(message: string, fields?: LogFields): void {
    console.info(...format(message, fields));
  },
  error(message: string, fields?: LogFields): void {
    console.error(...format(message, fields));
  },
};
