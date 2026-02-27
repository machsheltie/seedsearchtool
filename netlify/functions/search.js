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

  const snippets = await Promise.all(sites.map(async (site) => {
    // Try Shopify JSON first — it's instant and works for any Shopify store
    // If the site isn't Shopify or returns nothing, fall through to Jina
    try {
      const shopifyUrl = `https://${site.domain}/search.json?q=${encodeURIComponent(seedName)}&type=product`;
      const res = await fetch(shopifyUrl, { signal: AbortSignal.timeout(3000) });
      if (res.ok && res.headers.get("content-type")?.includes("json")) {
        const json = await res.json();
        const products = (json.results || []).slice(0, 6);
        if (products.length > 0) {
          const lines = products.map(p =>
            `- ${p.title} | $${p.price} | https://${site.domain}${p.url}`
          ).join("\n");
          return `### ${site.name} (${site.domain})\n${lines}`;
        }
      }
    } catch(e) { /* not Shopify — fall through to Jina */ }

    // DuckDuckGo site-search fallback — bypasses Cloudflare blocks and JS-rendered site search
    try {
      const ddgUrl = `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encodeURIComponent(seedName + ' site:' + site.domain)}`;
      const res = await fetch(ddgUrl, {
        headers: { "Accept": "text/plain", "X-No-Cache": "true" },
        signal: AbortSignal.timeout(9000)
      });
      const text = await res.text();
      const textLower = text.toLowerCase();
      // Anchor on the domain name in organic results (skips DDG title/header/ads at top)
      const domainIdx = textLower.indexOf(site.domain.toLowerCase(), 500);
      let content;
      if (domainIdx > 0) {
        content = text.slice(Math.max(0, domainIdx - 400), domainIdx + 2000);
      } else {
        content = `No results found for "${seedName}" on ${site.domain}`;
      }
      return `### ${site.name} (${site.domain})\n${content}`;
    } catch(e) {
      return `### ${site.name} (${site.domain})\n(no results)`;
    }
  }));

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: `You are a seed availability parser. Extract product info from search results. Respond ONLY with a JSON array — no prose, no markdown, no code fences.`,
      messages: [{
        role: "user",
        content: `Seed variety: "${seedName}"

Search results per company:

${snippets.join("\n\n")}

Respond with ONLY a JSON array with exactly ${sites.length} objects in the same order as the ### sections:
[{"domain":"example.com","found":true,"productName":"exact name or null","price":"$X.XX or null","quantity":"e.g. 50 seeds or null","url":"product URL if visible or null","notes":null}]
Use found:true only when the results clearly show this variety listed for sale.`
      }]
    })
  });

  const data = await claudeRes.json();
  return {
    statusCode: claudeRes.status,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
};
