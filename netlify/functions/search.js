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

  // Search URL overrides for sites that don't use the standard /search?q= pattern
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
  };

  // Fetch each site's own search results page via Jina Reader (free, server-side)
  const snippets = await Promise.all(sites.map(async (site) => {
    try {
      const base = searchOverrides[site.domain] || `https://${site.domain}/search?q=`;
      const searchUrl = base + encodeURIComponent(seedName);
      const jinaUrl = `https://r.jina.ai/${searchUrl}`;
      const res = await fetch(jinaUrl, {
        headers: { "Accept": "text/plain", "X-No-Cache": "true" },
        signal: AbortSignal.timeout(9000)
      });
      const text = await res.text();
      // Find first product price ($X.XX) — skips nav text like "Free Shipping over $75"
      const priceMatch = text.match(/\$\d+\.\d{2}/);
      const priceIdx = priceMatch ? text.indexOf(priceMatch[0]) : -1;
      let content;
      if (priceIdx > 500) {
        // Extract a window around the first product price to capture name + nearby listings
        content = text.slice(Math.max(0, priceIdx - 400), priceIdx + 2500);
      } else if (priceIdx >= 0) {
        content = text.slice(0, 3000);
      } else {
        // No price found — grab mid-page to catch "no results" messages
        content = text.slice(2000, 4500);
      }
      return `### ${site.name} (${site.domain})\n${content}`;
    } catch(e) {
      return `### ${site.name} (${site.domain})\n(no results)`;
    }
  }));

  // Single Claude call to parse all snippets — no web_search tool needed
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
      system: `You are a seed availability parser. Extract product info from web search snippets. Respond ONLY with a JSON array — no prose, no markdown, no code fences.`,
      messages: [{
        role: "user",
        content: `Seed variety: "${seedName}"

Search result snippets per company:

${snippets.join("\n\n")}

Respond with ONLY a JSON array with exactly ${sites.length} objects in the same order as the ### sections:
[{"domain":"example.com","found":true,"productName":"exact name or null","price":"$X.XX or null","quantity":"e.g. 50 seeds or null","url":"product URL if visible or null","notes":null}]
Use found:true only when the snippet clearly shows this variety listed for sale.`
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
