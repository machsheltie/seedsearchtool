exports.handler = async function(event) {
  const ALLOWED_ORIGIN = "https://seedsearchtool.netlify.app";

  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method not allowed" };
  }

  const apiKey = event.headers["x-api-key"];
  if (!apiKey) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: { message: "Missing API key" } }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: event.body,
    });

    const data = await response.text();
    return { statusCode: response.status, headers: { ...headers, "Content-Type": "application/json" }, body: data };

  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: { message: e.message } }) };
  }
};
