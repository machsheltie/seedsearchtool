# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Seed Scout** — a single-page web app that searches 26 seed company websites simultaneously for a given seed variety, using Claude AI with the `web_search` tool to check availability, price, and quantity. Results can be exported to CSV or logged to a specific Google Sheet.

## Development & Deployment

There is no build step. The project is a static site deployed on Netlify.

**Local development:**
```bash
# Install Netlify CLI if not already installed
npm install -g netlify-cli

# Run locally (serves index.html and the proxy function together)
netlify dev
```

**Deploy to production:**
```bash
netlify deploy --prod
```

The live site is at `https://seedsearchtool.netlify.app`.

## Architecture

Everything lives in two files:

- **`index.html`** — The entire frontend: HTML structure, all CSS (using CSS custom properties for the earthy color palette), and all JavaScript. No frameworks, no bundler, no npm dependencies.
- **`netlify/proxy.js`** — A Netlify serverless function at `/.netlify/functions/proxy`. Its sole purpose is to forward requests to the Anthropic API (`/v1/messages`), passing through the user's API key from the `x-api-key` request header. CORS is locked to `https://seedsearchtool.netlify.app`.

## Key Constants (in index.html)

| Constant | Purpose |
|---|---|
| `CLIENT_ID` | Google OAuth 2.0 client ID (Google Identity Services) |
| `SHEET_ID` | Hardcoded Google Sheet ID for logging results |
| `SITES` | Array of 26 seed company objects `{name, domain}` |

## How the Search Works

1. User enters a seed variety name and clicks "Scout It".
2. `startSearch()` renders placeholder cards for all 26 sites.
3. Sites are queried in **batches of 4** concurrently via `callClaude()`.
4. `callClaude()` posts to `/.netlify/functions/proxy`, which relays to Anthropic's API using model `claude-haiku-4-5-20251001` with the `web_search_20250305` tool.
5. The agentic loop runs up to 6 turns per site: Claude searches the web, then responds with a JSON object `{found, productName, price, quantity, url, notes}`.
6. On completion, if Google Sheets is connected, results are auto-logged.

## API Key Handling

The user's Anthropic API key is entered in the UI settings panel, sent in the `x-api-key` header to the proxy function, and never persisted anywhere (no localStorage, no server storage). The proxy forwards it directly to Anthropic.

## Google Sheets Integration

Uses Google Identity Services (GIS) token client for OAuth2. The OAuth flow requests the `https://www.googleapis.com/auth/spreadsheets` scope. The target sheet and tab name are configurable in the UI, but `SHEET_ID` is hardcoded in `index.html`.
