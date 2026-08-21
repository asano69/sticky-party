import { createSignal } from "solid-js";

import { Button } from "@kobalte/core/button";
import Logo from "../components/Logo";

import pb from "../lib/pb";

// Login screen shown by AuthGate when no valid superuser session exists.
// This app is single-user, so the PocketBase superuser account also
// serves as the app's only login; there is no separate "users" collection.
export default function Login() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await pb.collection("_superusers").authWithPassword(email(), password());
      // No further action needed here: AuthGate subscribes to
      // pb.authStore.onChange and swaps this screen for the app once the
      // token is stored.
    } catch {
      setError("Invalid email or password.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="flex min-h-screen w-full items-center justify-center bg-[var(--color-bg)] px-6 text-[var(--color-text)]">
      <form
        onSubmit={handleSubmit}
        class="flex w-full max-w-sm flex-col gap-4 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-field)] p-8 shadow-[0_1px_3px_0_var(--color-shadow)]"
      >
        <div class="flex justify-center">
          <Logo />
        </div>
        <input
          type="email"
          placeholder="Email"
          value={email()}
          onInput={(e) => setEmail(e.target.value)}
          required
          autofocus
          class="rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
        />
        <input
          type="password"
          placeholder="Password"
          value={password()}
          onInput={(e) => setPassword(e.target.value)}
          required
          class="rounded-md border border-[var(--color-border-soft)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)]"
        />
        {error() && <p class="text-sm text-[#dc3545]">{error()}</p>}
        <button type="submit" class="btn" disabled={pending()}>
          {pending() ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
