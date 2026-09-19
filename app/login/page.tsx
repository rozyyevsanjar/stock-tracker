import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  if (await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/");
  const next = params.next?.startsWith("/") ? params.next : "/";

  return (
    <main className="loginPage">
      <section className="loginPanel">
        <div className="loginMark">SR</div>
        <div>
          <span className="loginEyebrow">Private dashboard</span>
          <h1>Welcome back</h1>
          <p>Your portfolio and assistant are protected.</p>
        </div>
        <form action="/api/auth/login" method="post">
          <input name="next" type="hidden" value={next} />
          <label>
            Username
            <input autoComplete="username" autoFocus name="username" required />
          </label>
          <label>
            Password
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          {params.error ? <p className="loginError">The username or password is incorrect.</p> : null}
          <button type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}
