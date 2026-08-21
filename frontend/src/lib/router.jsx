import { Router, Route } from "@solidjs/router";

import Home from "../routes/Home";
import AppShell from "../components/layout/AppShell";

// All top-level routes in one place, so adding or removing a page never
// requires touching main.jsx.
//
// AppShell is passed as `root` rather than wrapped around <Router> here,
// so its contents (e.g. NavBar's <A> links) render inside the router
// context instead of erroring outside a Route.
export default function AppRouter() {
  return (
    <Router root={AppShell}>
      <Route path="/" component={Home} />
    </Router>
  );
}
