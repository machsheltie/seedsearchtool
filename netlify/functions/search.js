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

  // Fetch DuckDuckGo search results via Jina Reader for each site in parallel (free)
  const snippets = await Promise.all(sites.map(async (site) => {
    try {
      const query = encodeURIComponent(`"${seedName}" site:${site.domain}`);
      const jinaUrl = `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${query}`;
      const res = await fetch(jinaUrl, {
        headers: { "Accept": "text/plain", "X-No-Cache": "true" },
        signal: AbortSignal.timeout(9000)
      });
      const text = await res.text();
      return `### ${site.name} (${site.domain})\n${text.slice(0, 800)}`;
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
      max_tokens: 1000,
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
