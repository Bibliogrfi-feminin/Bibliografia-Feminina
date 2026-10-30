import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: myRole } = await userClient.rpc("get_my_role");
    if (myRole !== "ADMIN") return json({ error: "Forbidden: somente admins" }, 403);

    const url = new URL(req.url);
    const userId = url.searchParams.get("id");

    if (req.method === "GET") {
      const { data: perfis, error } = await adminClient
        .from("perfis")
        .select("id, nome, role, criado_em")
        .order("criado_em", { ascending: false });
      if (error) throw error;
      const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const emailMap = new Map(authData.users.map((u) => [u.id, u.email]));
      return json(perfis.map((p) => ({ ...p, email: emailMap.get(p.id) ?? null })));
    }

    if (req.method === "POST") {
      const { nome, email, senha, role } = await req.json();
      if (!nome || !email || !senha || !role)
        return json({ error: "nome, email, senha e role sao obrigatorios" }, 400);
      if (!["ADMIN", "ANOTADOR"].includes(role))
        return json({ error: "role deve ser ADMIN ou ANOTADOR" }, 400);
      const { data: created, error: err } = await adminClient.auth.admin.createUser({
        email, password: senha, email_confirm: true,
        app_metadata: { role }, user_metadata: { nome },
      });
      if (err) throw err;
      await adminClient.from("perfis").upsert({ id: created.user.id, nome, role });
      return json({ id: created.user.id, email: created.user.email, nome, role }, 201);
    }

    if (req.method === "PUT") {
      if (!userId) return json({ error: "id e obrigatorio" }, 400);
      const { nome, email, senha, role } = await req.json();
      const authUp: Record<string, unknown> = {};
      if (email) authUp.email = email;
      if (senha) authUp.password = senha;
      if (role) authUp.app_metadata = { role };
      if (nome) authUp.user_metadata = { nome };
      if (Object.keys(authUp).length > 0) {
        const { error: err } = await adminClient.auth.admin.updateUserById(userId, authUp);
        if (err) throw err;
      }
      const perfilUp: Record<string, unknown> = {};
      if (nome) perfilUp.nome = nome;
      if (role) perfilUp.role = role;
      if (Object.keys(perfilUp).length > 0)
        await adminClient.from("perfis").update(perfilUp).eq("id", userId);
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      if (!userId) return json({ error: "id e obrigatorio" }, 400);
      const { data: { user: caller } } = await userClient.auth.getUser();
      if (caller?.id === userId)
        return json({ error: "Nao e possivel deletar seu proprio usuario" }, 400);
      const { error: err } = await adminClient.auth.admin.deleteUser(userId);
      if (err) throw err;
      return json({ success: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    return json({ error: msg }, 500);
  }
});
