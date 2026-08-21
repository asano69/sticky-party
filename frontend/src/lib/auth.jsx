import { createSignal, onCleanup, Show } from "solid-js";

import pb from "./pb";
import Login from "../routes/Login";

// AuthGate blocks the whole app behind Login until a valid superuser
// session exists, tracking pb.authStore so it reacts immediately to
// both login and logout.
export default function AuthGate(props) {
  const [authed, setAuthed] = createSignal(pb.authStore.isValid);
  const unsubscribe = pb.authStore.onChange(() =>
    setAuthed(pb.authStore.isValid),
  );
  onCleanup(unsubscribe);

  // pb.authStore.isValid already accounts for token expiry, but nothing
  // re-checks it while the tab stays open with no login/logout activity.
  // Poll periodically so an expired token falls back to Login on its own,
  // instead of waiting for a page reload or a failed API call.
  const expiryCheck = setInterval(
    () => setAuthed(pb.authStore.isValid),
    30_000,
  );
  onCleanup(() => clearInterval(expiryCheck));

  return (
    <Show when={authed()} fallback={<Login />}>
      {props.children}
    </Show>
  );
}
