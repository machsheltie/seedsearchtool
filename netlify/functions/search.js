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

  // Search URL overrides for sites with non-standard search paths
  const searchOverrides = {
    "rareseeds.com":         `https://www.rareseeds.com/catalogsearch/result/?q=`,
    "fedcoseeds.com":        `https://www.fedcoseeds.com/seeds/search?q=`,
    "davidsgardenseeds.com": `https://www.davidsgardenseeds.com/catalogsearch/result/?q=`,
    "johnnyseed.com":        `https://www.johnnyseed.com/search?q=`,
    "parkseed.com":          `https://parkseed.com/search?q=`,
    "burpee.com":            `https://www.burpee.com/search?q=`,
    "harrisseeds.com":       `https://www.harrisseeds.com/storefront/c-1-all-products.aspx?keywords=`,
    "victoryseeds.com":      `https://www.victoryseeds.com/catalog/search.php?search_query=`,
    "tomatofest.com":        `https://tomatofest.com/search?q=`,
    "tomatogrowers.com":     `https://www.tomatogrowers.com/search?q=`,
    "seedsavers.org":        `https://www.seedsavers.org/search?q=`,
    "vermontbean.com":       `https://www.vermontbean.com/search?q=`,
    "seedsnsuch.com":        `https://www.seedsnsuch.com/search?q=`,
    "tradewindsfruit.com":   `https://www.tradewindsfruit.com/search?q=`,
  };

  const firstWord = seedName.split(" ")[0].toLowerCase();

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

    // Jina fallback for non-Shopify sites
    try {
      const base = searchOverrides[site.domain] || `https://${site.domain}/search?q=`;
      const jinaUrl = `https://r.jina.ai/${base}${encodeURIComponent(seedName)}`;
      const res = await fetch(jinaUrl, {
        headers: { "Accept": "text/plain", "X-No-Cache": "true" },
        signal: AbortSignal.timeout(6000)
      });
      const text = await res.text();
      const textLower = text.toLowerCase();
      const nameIdx = textLower.indexOf(firstWord, 1500);
      let content;
      if (nameIdx > 0) {
        content = text.slice(Math.max(0, nameIdx - 100), nameIdx + 3000);
      } else {
        content = text.slice(2000, 5000);
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
