import NavBar from "../NavBar";

// Wraps every route so NavBar renders once regardless of page (it's
// global chrome, not something that should vary per route). Passed as
// Router's `root` prop (see lib/router.jsx) instead of wrapping <Router>
// from outside, since anything AppShell renders needs to live inside the
// router context (e.g. NavBar's <A> links).
export default function AppShell(props) {
  return (
    <div class="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center bg-[var(--color-bg)] px-6 py-12 text-[var(--color-text)]">
      <NavBar />
      {props.children}
    </div>
  );
}
