import { createFileRoute, redirect } from "@tanstack/react-router";

// Home opens the POS counter directly. The _authenticated layout sends
// signed-out users to /auth, so no separate landing page is needed.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/pos", replace: true });
  },
});
