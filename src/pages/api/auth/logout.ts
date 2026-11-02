import type { APIRoute } from "astro";
import { SESSION_COOKIE_NAME } from "../../../lib/auth";

// A plain <form method="post"> submit (see Layout.astro's nav), not a fetch
// call --- the browser navigates on submit, so this needs to redirect
// somewhere rather than return a bodyless 204.
export const POST: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
  return redirect("/", 303);
};
