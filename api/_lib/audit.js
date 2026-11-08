// Audit trail. In this first slice there is no database table yet (a reviewed migration comes with the first
// write action), so events are written as one structured JSON line per event to the function log. The sink is
// replaceable, and the shape matches the planned listings.audit_log table. Tokens are never logged.

let sink = (line) => console.log(line);

export function setAuditSink(fn) {
  sink = fn;
}

export function audit({ action, outcome, actor, detail }) {
  const event = {
    type: 'audit',
    at: new Date().toISOString(),
    action,
    outcome,
    actor: actor ? { email: actor.email ?? null, authUserId: actor.authUserId ?? null } : null,
    detail: detail ?? {},
  };
  try {
    sink(JSON.stringify(event));
  } catch {
    // an audit failure must never break, or silently allow, the request
  }
}
