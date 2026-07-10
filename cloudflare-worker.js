// Cloudflare Worker for Moosify chat with multi‑provider failover
// Exported module for Workers runtime (ESM)

export default {
  async fetch(request, env, ctx) {
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

    // ---------------------------------------------------------------------
    // 1️⃣ Health‑check endpoint – useful for CI/CD and monitoring
    // ---------------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // ---------------------------------------------------------------------
    // 2️⃣ Prompt endpoint – demonstrates secret handling & permission check
    // ---------------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/prompt") {
      // Expect a secret named MY_SECRET to be set via Wrangler
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

    // ---------------------------------------------------------------------
    // Existing chat endpoint – keep original behaviour for any other POST
    // ---------------------------------------------------------------------
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
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

    // Maintenance mode – if client explicitly requests down, short‑circuit
    if (payload.chatStatus && payload.chatStatus === "down") {
      return new Response(JSON.stringify({ reply: "Our help desk chat is currently offline for testing. Check back soon!" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // System prompt that defines Moosy's personality, knowledge and guardrails
    const systemPrompt = `You are Moosy, the stuffed moose CEO of Moosify. You are playful, kind, silly, and cheerful. Keep answers short (under two sentences). Never say you are a real animal.
Knowledge: Help users buy phones, donuts, flights, rockets, cell plans, and support. Product catalog: OPhone Pro ($499), Rainbow Sprinkle Box ($18), Moosy VIP Support ($49), Quick Help Ticket ($5).
Guardrails: Do not process real payments, do not ask for passwords, do not pretend orders are real, treat checkout as a demo.`;

    const userMessage = payload.message || "";

    const providers = [
      {
        name: "Cerebras",
        url: "https://api.cerebras.cloud/v1/chat/completions",
        model: "llama3.1-8b",
        key: env.CEREBRAS_API_KEY
      },
      {
        name: "Groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama3.1-8b-instant",
        key: env.GROQ_API_KEY
      },
    ];

    for (const p of providers) {
      try {
        // Build the messages array, preserving any prior conversation history
        const messages = [{ role: "system", content: systemPrompt }];
        if (Array.isArray(payload.history) && payload.history.length) {
          messages.push(...payload.history);
        }
        messages.push({ role: "user", content: userMessage });
        const body = {
          model: p.model,
          messages,
          temperature: 0.7
        };

        const resp = await fetch(p.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${p.key}`
          },
          body: JSON.stringify(body)
        });

        if (resp.status === 429) {
          // Rate‑limit – try next provider immediately
          continue;
        }
        if (!resp.ok) {
          // Any non‑OK response – fall back
          continue;
        }

        const data = await resp.json();
        let reply = "";
        if (data.choices && data.choices[0]) {
          reply = data.choices[0].message?.content ?? data.choices[0].message ?? data.output_text ?? "";
        } else if (data.output) {
          reply = data.output;
        }
        if (reply) {
          return new Response(JSON.stringify({ reply: reply.trim() }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      } catch (e) {
        // Network or other error – try the next provider
        continue;
      }
    }

    // All providers exhausted
    return new Response(JSON.stringify({ error: "All LLM providers failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
