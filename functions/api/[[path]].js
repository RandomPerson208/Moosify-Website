export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  // Health‑check endpoint
  if (request.method === "GET" && pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Simple hello endpoint (example from your template)
  if (request.method === "GET" && pathname === "/api/hello") {
    return new Response(JSON.stringify({ message: "Hello from Moosify API!" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Prompt endpoint – mirrors the original Worker logic
  if (request.method === "POST" && pathname === "/api/prompt") {
    const secret = await env.MY_SECRET;
    if (!secret) {
      return new Response(JSON.stringify({ error: "Missing required secret" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    // Echo back a mock reply – replace with real LLM logic later
    const result = {
      prompt: payload.prompt,
      reply: `You sent: "${payload.prompt}" – (mock reply)`
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Fallback for unknown routes
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}
