// The connector API (app/api/connect) is for an outside assistant, not a
// signed-in person, so it is guarded by its own secret, sent as
// "Authorization: Bearer <token>". More than one secret can be accepted so each
// consumer carries its own, rotatable independently:
//   HUB_CONNECT_TOKEN             Muse's token (the original)
//   HUB_CONNECT_TOKEN_SOCIALDESK  SocialDesk's own token
// With none configured the API is closed to everyone.

import { timingSafeEqual } from "node:crypto";

function acceptedTokens(): string[] {
  return [process.env.HUB_CONNECT_TOKEN, process.env.HUB_CONNECT_TOKEN_SOCIALDESK]
    .map((v) => (v ?? "").trim())
    .filter((v) => v.length >= 24); // unset, or too short to be a real secret
}

export function connectorAuthorized(request: Request): boolean {
  const supplied = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (supplied.length < 24) return false;
  const a = Buffer.from(supplied);
  // Constant-time compare against each accepted token; the length guard keeps
  // timingSafeEqual from throwing on a mismatch.
  return acceptedTokens().some((tok) => {
    const b = Buffer.from(tok);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Who a connector save is attributed to on the client page. */
export function connectorName(): string {
  return (process.env.HUB_CONNECT_NAME ?? "Muse").trim() || "Muse";
}
