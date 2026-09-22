import { createClient } from "@supabase/supabase-js";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function allowRequest(ip: string) {
  const key = Symbol.for("lager.invite.rate-limit");
  const root = globalThis as typeof globalThis & {
    [key]?: Map<string, { count: number; reset: number }>;
  };
  const store = (root[key] ??= new Map());
  const now = Date.now();
  const record = store.get(ip);
  if (!record || record.reset < now) {
    store.set(ip, { count: 1, reset: now + 60 * 60 * 1000 });
    return true;
  }
  if (record.count >= 10) return false;
  record.count += 1;
  return true;
}

export default async (req: Request, context: { ip?: string }) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!allowRequest(context.ip || "unknown"))
    return json({ error: "Invitation limit reached. Try again later." }, 429);

  const url = Netlify.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const publicKey = Netlify.env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !serviceKey)
    return json({ error: "Server invitation is not configured." }, 503);

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Sign in required" }, 401);
  const token = authorization.slice(7);
  const caller = createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: access, error: accessError } = await caller.rpc("lager_access");
  if (accessError || access?.role !== "admin")
    return json({ error: "Admin access required" }, 403);

  let input: {
    email?: string;
    role?: string;
    can_view_financials?: boolean;
    can_delete?: boolean;
  };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({ error: "A valid email is required" }, 400);
  if (!["admin", "employee"].includes(String(input.role)))
    return json({ error: "Invalid role" }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError && !/already|registered|exists/i.test(inviteError.message))
    return json({ error: "The invitation could not be sent." }, 400);

  const { error: memberError } = await caller.rpc("lager_set_member", {
    member_email: email,
    member_role: input.role,
    financial_access: !!input.can_view_financials,
    delete_access: !!input.can_delete,
  });
  if (memberError)
    return json(
      {
        error:
          "The user was invited but permissions could not be assigned yet.",
      },
      409,
    );
  return json({ invited: !inviteError });
};

export const config = { path: "/api/team/invite" };
