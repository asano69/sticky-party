// Logs out of the currently active profile: clears the auth token plus
// every piece of locally-cached, profile-scoped data (target cache +
// its content-script registrations, popup color, annotation count,
// sync-error badge state, draft note). Called by Settings.tsx right
// before saving a changed backend/email/password, so nothing from the
// old profile leaks into the new one.
//
// This is the single-profile building block for the multi-profile
// support planned later: "log out" here always means "the one active
// profile", not "profile N". Once multiple profiles exist, this will
// likely take a profile id instead of acting globally.

import { clearAuthStore } from "./pb";
import { clearPopupColor } from "./popupColor";
import { clearTargets } from "./targets";
import { clearCachedAnnotationCount } from "./annotationCountCache";
import { clearSyncErrorBadge } from "./syncBadge";
import { clearDraftNote } from "./draft";

export async function logout(): Promise<void> {
  await Promise.all([
    clearAuthStore(),
    clearPopupColor(),
    clearTargets(),
    clearCachedAnnotationCount(),
    clearSyncErrorBadge(),
    clearDraftNote(),
  ]);
}
