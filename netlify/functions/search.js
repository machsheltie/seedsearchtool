exports.handler = async function(event) {
  const ALLOWED_ORIGIN = "https://seedsearchtool.netlify.app";
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  const apiKey = event.headers["x-api-key"];
  if (!apiKey) return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Missing API key" } }) };

  const { seedName, sites } = JSON.parse(event.body);

  // Search each site concurrently using Claude's built-in web_search tool
  const results = await Promise.all(sites.map(site => searchSite(apiKey, seedName, site)));

  // Return in the same envelope shape the frontend already parses
  return {
    statusCode: 200,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(results) }]
    })
  };
};

async function searchSite(apiKey, seedName, site) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        system: "You are a seed availability checker. Always respond with ONLY a JSON object — no prose, no markdown fences.",
        messages: [{
          role: "user",
          content: `Search ${site.domain} for "${seedName}" seeds. Is this exact variety listed for sale on their website right now? Find the product name, price, quantity per packet, and the direct product page URL.

Respond with ONLY this JSON (no other text):
{"domain":"${site.domain}","found":true,"productName":"exact name","price":"$X.XX","quantity":"e.g. 50 seeds","url":"https://...","notes":null}

Use found:true only if you confirm this variety is currently listed for sale on ${site.domain}. If not found, use found:false and null for all other fields.`
        }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    // web_search_20250305 is server-side: returns stop_reason "end_turn" in one call
    const text = (data.content || []).find(b => b.type === "text")?.text || "";
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  } catch(err) { /* fall through to default */ }

  return { domain: site.domain, found: false, productName: null, price: null, quantity: null, url: null, notes: null };
}
