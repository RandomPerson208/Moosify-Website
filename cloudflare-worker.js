// Cloudflare Worker for Moosify chat with multi‑provider failover
// Exported module for Workers runtime (ESM)

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

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
      {
        name: "Together",
        url: "https://api.together.xyz/v1/chat/completions",
        model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        key: env.TOGETHER_API_KEY
      }
    ];

    for (const p of providers) {
      try {
        const body = {
          model: p.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
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
