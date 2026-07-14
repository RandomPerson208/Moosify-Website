export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const path = params?.path || [];

  // Example routes — expand as needed
  if (url.pathname === "/api") {
    return new Response(JSON.stringify({
      status: "ok",
      message: "Moosify API is running",
      version: "1.0.0"
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Add your API routes here
  // Example: if (url.pathname === "/api/users") { ... }

  return new Response(JSON.stringify({
    error: "Not found",
    path: url.pathname
  }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
}
