import PocketBase from "pocketbase";

// Single shared PocketBase client, used to call sticky-party' custom API routes
// (e.g. POST /api/admin/jobs/rescan) from the frontend.
const pb = new PocketBase("/");

// A 401 means the server rejected the request as unauthenticated. A 403
// also means the same thing in this app: every collection here is
// superuser-only (listRule/viewRule = null), so PocketBase responds with
// 403 "Only superusers can perform this action" -- not 401 -- whenever
// the request carries an invalid/expired token, since an invalid token is
// treated as no auth at all rather than a distinct "unauthenticated"
// error. Either status means the client-side JWT expiry check in
// pb.authStore.isValid failed to catch a session the server has already
// invalidated (revoked token, password change, etc.). Clearing the store
// here triggers AuthGate's onChange listener and falls back to Login,
// instead of leaving requests (e.g. Catalog's fetchManifests) stuck
// rejected forever behind a "Loading…" screen.
pb.afterSend = function (response, data) {
  if (response.status === 401 || response.status === 403) {
    pb.authStore.clear();
  }
  // In dev, also log the full response body for failed requests
  // (validation errors, etc.) so a bare status code in the UI doesn't
  // leave you guessing what actually went wrong. Stripped out of prod
  // builds since it's gated behind Vite's import.meta.env.DEV.
  if (import.meta.env.DEV && !response.ok) {
    console.error(`[pb] ${response.status} ${response.url}`, data);
  }
  return data;
};

export default pb;
