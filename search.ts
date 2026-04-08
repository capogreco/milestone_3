#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

// search.ts — CLI tool for searching academic and informal sources
// Usage:
//   deno task search scholar "distributed synthesis"
//   deno task search openalex "critical posthumanism sound"
//   deno task search lines "norns webrtc"
//   deno task search web "createCanvas podcast distributed audio"

const USAGE = `Usage: search <source> <query> [options]

Sources:
  scholar     Semantic Scholar API
  openalex    OpenAlex API
  scopus      Scopus (Elsevier) API — requires SCOPUS_API_KEY in .env
  lines       llllllll.co (Lines forum)
  web         General web search (via DuckDuckGo)

Zotero:
  zotero add <DOI or URL>       Add item to Zotero library by DOI
  zotero search <query>         Search your Zotero library
  zotero pdf <key>              Download PDF attachment to pdf/ folder
  zotero pdf --all              Download all available PDFs to pdf/ folder
  zotero export [--collection=NAME]  Export library/collection as BibTeX
  zotero collections            List your Zotero collections

Options:
  --limit=N       Number of results (default: 10)
  --year=YYYY-    Filter by year range, e.g. --year=2020- or --year=2018-2023
  --sort=cited    Sort by citation count (scholar/openalex only)
  --open          Only show open access results (scholar/openalex only)
`;

// ── Helpers ──────────────────────────────────────────────────────────

function parseArgs(args: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const a of args) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? "true";
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }
function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function cyan(s: string) { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }

function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

function divider() {
  console.log(dim("─".repeat(72)));
}

function parseYearRange(yr: string): { min?: number; max?: number } {
  const m = yr.match(/^(\d{4})?-(\d{4})?$/);
  if (!m) return {};
  return {
    min: m[1] ? parseInt(m[1]) : undefined,
    max: m[2] ? parseInt(m[2]) : undefined,
  };
}

// ── Semantic Scholar ─────────────────────────────────────────────────

interface ScholarResult {
  title: string;
  authors: { name: string }[];
  year: number | null;
  abstract: string | null;
  citationCount: number;
  externalIds: { DOI?: string } | null;
  isOpenAccess: boolean;
  url: string;
}

async function searchScholar(query: string, flags: Record<string, string>) {
  const limit = parseInt(flags.limit ?? "10");
  const fields = "title,authors,year,abstract,citationCount,externalIds,isOpenAccess,url";
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields,
  });

  if (flags.year) {
    const { min, max } = parseYearRange(flags.year);
    if (min) params.set("year", max ? `${min}-${max}` : `${min}-`);
  }

  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;
  let res = await fetch(url, {
    headers: { "User-Agent": "research-cli/1.0 (mailto:research@assembly.fm)" },
  });
  // Retry once on rate limit after a short wait
  if (res.status === 429) {
    console.log(dim("Rate limited — waiting 3s and retrying…"));
    await new Promise(r => setTimeout(r, 3000));
    res = await fetch(url, {
      headers: { "User-Agent": "research-cli/1.0 (mailto:research@assembly.fm)" },
    });
  }
  if (!res.ok) {
    console.error(`Semantic Scholar error: ${res.status} ${res.statusText}`);
    return;
  }
  const data = await res.json();
  const papers: ScholarResult[] = data.data ?? [];

  if (!papers.length) {
    console.log("No results found.");
    return;
  }

  // Sort by citations if requested
  if (flags.sort === "cited") {
    papers.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
  }

  console.log(bold(`\nSemantic Scholar — ${papers.length} results for "${query}"\n`));

  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    if (flags.open === "true" && !p.isOpenAccess) continue;

    const doi = p.externalIds?.DOI;
    const authors = p.authors?.map(a => a.name).join(", ") ?? "Unknown";
    const year = p.year ?? "n.d.";

    divider();
    console.log(`${cyan(`[${i + 1}]`)} ${bold(p.title)}`);
    console.log(`    ${authors} ${dim(`(${year})`)}`);
    console.log(`    ${dim("Citations:")} ${p.citationCount}${p.isOpenAccess ? green("  ● Open Access") : ""}`);
    if (doi) console.log(`    ${dim("DOI:")} https://doi.org/${doi}`);
    if (p.url) console.log(`    ${dim("URL:")} ${p.url}`);
    if (p.abstract) {
      console.log(`    ${dim("Abstract:")} ${truncate(p.abstract)}`);
    }
  }
  divider();
  console.log(dim(`\nTip: drop DOI links into Zotero to import.`));
}

// ── OpenAlex ─────────────────────────────────────────────────────────

interface OpenAlexWork {
  title: string;
  authorships: { author: { display_name: string } }[];
  publication_year: number | null;
  doi: string | null;
  open_access: { is_oa: boolean; oa_url: string | null };
  cited_by_count: number;
  abstract_inverted_index: Record<string, number[]> | null;
  id: string;
}

function reconstructAbstract(inverted: Record<string, number[]>): string {
  const entries: [string, number][] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) {
      entries.push([word, pos]);
    }
  }
  entries.sort((a, b) => a[1] - b[1]);
  return entries.map(e => e[0]).join(" ");
}

async function searchOpenAlex(query: string, flags: Record<string, string>) {
  const limit = parseInt(flags.limit ?? "10");
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    mailto: "research@assembly.fm",
  });

  if (flags.year) {
    const { min, max } = parseYearRange(flags.year);
    const filter: string[] = [];
    if (min) filter.push(`publication_year:>${min - 1}`);
    if (max) filter.push(`publication_year:<${max + 1}`);
    if (filter.length) params.set("filter", filter.join(","));
  }

  if (flags.open === "true") {
    const existing = params.get("filter");
    const oaFilter = "open_access.is_oa:true";
    params.set("filter", existing ? `${existing},${oaFilter}` : oaFilter);
  }

  if (flags.sort === "cited") {
    params.set("sort", "cited_by_count:desc");
  }

  const url = `https://api.openalex.org/works?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`OpenAlex error: ${res.status} ${res.statusText}`);
    return;
  }
  const data = await res.json();
  const works: OpenAlexWork[] = data.results ?? [];

  if (!works.length) {
    console.log("No results found.");
    return;
  }

  console.log(bold(`\nOpenAlex — ${works.length} results for "${query}"\n`));

  for (let i = 0; i < works.length; i++) {
    const w = works[i];
    const authors = w.authorships?.map(a => a.author.display_name).join(", ") ?? "Unknown";
    const year = w.publication_year ?? "n.d.";
    const doi = w.doi?.replace("https://doi.org/", "");

    divider();
    console.log(`${cyan(`[${i + 1}]`)} ${bold(w.title ?? "Untitled")}`);
    console.log(`    ${authors} ${dim(`(${year})`)}`);
    console.log(`    ${dim("Citations:")} ${w.cited_by_count}${w.open_access?.is_oa ? green("  ● Open Access") : ""}`);
    if (doi) console.log(`    ${dim("DOI:")} https://doi.org/${doi}`);
    if (w.open_access?.oa_url) console.log(`    ${dim("OA URL:")} ${w.open_access.oa_url}`);
    if (w.abstract_inverted_index) {
      const abstract = reconstructAbstract(w.abstract_inverted_index);
      console.log(`    ${dim("Abstract:")} ${truncate(abstract)}`);
    }
  }
  divider();
  console.log(dim(`\nTip: drop DOI links into Zotero to import.`));
}

// ── Scopus (Elsevier) ────────────────────────────────────────────────

async function loadEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  try {
    const text = await Deno.readTextFile(".env");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    // no .env file
  }
  return env;
}

interface ScopusEntry {
  "dc:title": string;
  "dc:creator": string;
  "prism:coverDate": string;
  "prism:doi"?: string;
  "citedby-count": string;
  "prism:publicationName"?: string;
  "dc:description"?: string;
  "prism:aggregationType"?: string;
  "openaccess"?: string;
  link: { "@ref": string; "@href": string }[];
}

async function searchScopus(query: string, flags: Record<string, string>) {
  const dotenv = await loadEnv();
  const apiKey = Deno.env.get("SCOPUS_API_KEY") ?? dotenv["SCOPUS_API_KEY"];
  if (!apiKey) {
    console.error("SCOPUS_API_KEY not found. Set it in .env or as an environment variable.");
    return;
  }

  const limit = parseInt(flags.limit ?? "10");
  const params = new URLSearchParams({
    query: `TITLE-ABS-KEY(${query})`,
    count: String(limit),
    apiKey,
  });

  if (flags.year) {
    const { min, max } = parseYearRange(flags.year);
    if (min && max) {
      params.set("date", `${min}-${max}`);
    } else if (min) {
      params.set("date", `${min}-${new Date().getFullYear()}`);
    }
  }

  if (flags.sort === "cited") {
    params.set("sort", "-citedby-count");
  }

  const url = `https://api.elsevier.com/content/search/scopus?${params}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-ELS-APIKey": apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Scopus error: ${res.status} ${res.statusText}`);
    if (res.status === 401 || res.status === 403) {
      console.error("Check your API key and that your RMIT affiliation is recognised.");
    }
    return;
  }

  const data = await res.json();
  const results: ScopusEntry[] = data["search-results"]?.entry ?? [];

  if (!results.length || results[0]?.["error"]) {
    console.log("No results found.");
    return;
  }

  console.log(bold(`\nScopus — ${results.length} results for "${query}"\n`));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const title = r["dc:title"] ?? "Untitled";
    const author = r["dc:creator"] ?? "Unknown";
    const date = r["prism:coverDate"]?.slice(0, 4) ?? "n.d.";
    const doi = r["prism:doi"];
    const citations = r["citedby-count"] ?? "0";
    const journal = r["prism:publicationName"];
    const isOA = r["openaccess"] === "1";
    const scopusLink = r.link?.find(l => l["@ref"] === "scopus")?.["@href"];

    if (flags.open === "true" && !isOA) continue;

    divider();
    console.log(`${cyan(`[${i + 1}]`)} ${bold(title)}`);
    console.log(`    ${author} ${dim(`(${date})`)}`);
    if (journal) console.log(`    ${dim("In:")} ${journal}`);
    console.log(`    ${dim("Citations:")} ${citations}${isOA ? green("  ● Open Access") : ""}`);
    if (doi) console.log(`    ${dim("DOI:")} https://doi.org/${doi}`);
    if (scopusLink) console.log(`    ${dim("Scopus:")} ${scopusLink}`);
  }
  divider();
  console.log(dim(`\nTip: drop DOI links into Zotero to import.`));
}

// ── Lines (llllllll.co) ──────────────────────────────────────────────

interface DiscoursePost {
  id: number;
  topic_id: number;
  blurb: string;
  username: string;
  created_at: string;
}

interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  created_at: string;
  posts_count: number;
  like_count: number;
}

async function searchLines(query: string, flags: Record<string, string>) {
  const params = new URLSearchParams({ q: query });
  const url = `https://llllllll.co/search.json?${params}`;

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) {
    console.error(`Lines forum error: ${res.status} ${res.statusText}`);
    return;
  }
  const data = await res.json();
  const topics: DiscourseTopic[] = data.topics ?? [];
  const posts: DiscoursePost[] = data.posts ?? [];

  const limit = parseInt(flags.limit ?? "10");

  if (!topics.length && !posts.length) {
    console.log("No results found.");
    return;
  }

  console.log(bold(`\nllllllll.co (Lines) — results for "${query}"\n`));

  if (topics.length) {
    console.log(yellow("Topics:"));
    for (let i = 0; i < Math.min(topics.length, limit); i++) {
      const t = topics[i];
      const date = t.created_at?.slice(0, 10) ?? "";
      divider();
      console.log(`${cyan(`[${i + 1}]`)} ${bold(t.title)}`);
      console.log(`    ${dim("Date:")} ${date}  ${dim("Posts:")} ${t.posts_count}  ${dim("Likes:")} ${t.like_count}`);
      console.log(`    ${dim("URL:")} https://llllllll.co/t/${t.slug}/${t.id}`);
    }
  }

  if (posts.length) {
    console.log(yellow("\nPost excerpts:"));
    for (let i = 0; i < Math.min(posts.length, limit); i++) {
      const p = posts[i];
      const date = p.created_at?.slice(0, 10) ?? "";
      divider();
      console.log(`${cyan(`[${i + 1}]`)} ${dim("by")} ${p.username} ${dim(`(${date})`)}`);
      // Strip HTML tags from blurb
      const clean = p.blurb?.replace(/<[^>]*>/g, "") ?? "";
      console.log(`    ${truncate(clean)}`);
      console.log(`    ${dim("URL:")} https://llllllll.co/t/_/${p.topic_id}`);
    }
  }
  divider();
}

// ── Web Search (DuckDuckGo HTML) ─────────────────────────────────────

async function searchWeb(query: string, flags: Record<string, string>) {
  // Use DuckDuckGo lite as a basic web search
  const params = new URLSearchParams({ q: query });
  const url = `https://html.duckduckgo.com/html/?${params}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; research-cli/1.0)",
    },
  });
  if (!res.ok) {
    console.error(`Web search error: ${res.status} ${res.statusText}`);
    return;
  }
  const html = await res.text();
  const limit = parseInt(flags.limit ?? "10");

  // Extract results from DuckDuckGo HTML lite
  const results: { title: string; url: string; snippet: string }[] = [];
  const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match;
  while ((match = resultPattern.exec(html)) !== null && results.length < limit) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]*>/g, "").trim();
    const snippet = match[3].replace(/<[^>]*>/g, "").trim();
    // DDG lite wraps URLs in a redirect — extract the actual URL
    const uddg = new URL(rawUrl, "https://duckduckgo.com").searchParams.get("uddg");
    results.push({ title, url: uddg ?? rawUrl, snippet });
  }

  if (!results.length) {
    console.log("No results found (DDG may be rate-limiting). Try again in a moment.");
    return;
  }

  console.log(bold(`\nWeb search — ${results.length} results for "${query}"\n`));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    divider();
    console.log(`${cyan(`[${i + 1}]`)} ${bold(r.title)}`);
    console.log(`    ${dim("URL:")} ${r.url}`);
    if (r.snippet) console.log(`    ${truncate(r.snippet)}`);
  }
  divider();
}

// ── Zotero ───────────────────────────────────────────────────────────

async function getZoteroCredentials(): Promise<{ apiKey: string; base: string }> {
  const dotenv = await loadEnv();
  const apiKey = Deno.env.get("ZOTERO_API_KEY") ?? dotenv["ZOTERO_API_KEY"];
  const groupId = Deno.env.get("ZOTERO_GROUP_ID") ?? dotenv["ZOTERO_GROUP_ID"];
  const userId = Deno.env.get("ZOTERO_USER_ID") ?? dotenv["ZOTERO_USER_ID"];
  if (!apiKey) {
    throw new Error("ZOTERO_API_KEY must be set in .env");
  }
  // Prefer group library if configured, otherwise fall back to personal
  const base = groupId
    ? `https://api.zotero.org/groups/${groupId}`
    : `https://api.zotero.org/users/${userId}`;
  return { apiKey, base };
}

function zoteroHeaders(apiKey: string) {
  return {
    "Zotero-API-Key": apiKey,
    "Content-Type": "application/json",
  };
}

async function zoteroAdd(identifier: string) {
  const { apiKey, base } = await getZoteroCredentials();

  // Step 1: Use Zotero's translation server to resolve the DOI/URL to Zotero item JSON
  // We'll use the public translation server
  const isDOI = /^10\.\d{4,}/.test(identifier);
  const searchUrl = isDOI ? `https://doi.org/${identifier}` : identifier;

  console.log(dim(`Resolving ${isDOI ? "DOI" : "URL"}: ${searchUrl}…`));

  const translateRes = await fetch("https://translate.manubot.org/web", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: searchUrl,
  });

  if (!translateRes.ok) {
    // Fallback: try Zotero's own search endpoint to add by DOI
    console.log(dim("Translation server failed, trying direct Zotero search…"));

    // Create item via Zotero's /items endpoint using saved search
    const searchRes = await fetch(
      `https://api.zotero.org/search?q=${encodeURIComponent(identifier)}`,
      { headers: zoteroHeaders(apiKey) }
    );
    if (!searchRes.ok) {
      console.error("Could not resolve identifier. Try pasting the DOI URL directly into Zotero.");
      return;
    }
  }

  let items;
  try {
    items = await translateRes.json();
  } catch {
    console.error("Could not parse translation response. Try pasting the DOI into Zotero directly.");
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error("No items resolved from that identifier.");
    return;
  }

  // Step 2: Post item(s) to Zotero library
  // Clean up items for Zotero API - need to set itemType and remove some fields
  const zoteroItems = items.map((item: Record<string, unknown>) => {
    // Remove fields that the translation server adds but Zotero API doesn't want
    const cleaned = { ...item };
    delete cleaned.attachments;
    delete cleaned.notes;
    delete cleaned.seeAlso;
    delete cleaned.complete;
    delete cleaned.itemID;
    delete cleaned.id;
    return cleaned;
  });

  const postRes = await fetch(
    `${base}/items`,
    {
      method: "POST",
      headers: zoteroHeaders(apiKey),
      body: JSON.stringify(zoteroItems),
    }
  );

  if (!postRes.ok) {
    const body = await postRes.text();
    console.error(`Zotero API error: ${postRes.status} ${postRes.statusText}`);
    console.error(body.slice(0, 500));
    return;
  }

  const result = await postRes.json();
  const successful = result.successful ?? {};
  const failed = result.failed ?? {};

  if (Object.keys(successful).length > 0) {
    for (const key of Object.keys(successful)) {
      const item = successful[key];
      const data = item.data ?? {};
      console.log(green("✓") + ` Added to Zotero: ${bold(data.title ?? "Untitled")}`);
      console.log(`    ${dim("Key:")} ${data.key}  ${dim("Type:")} ${data.itemType}`);
      if (data.DOI) console.log(`    ${dim("DOI:")} ${data.DOI}`);
    }
  }

  if (Object.keys(failed).length > 0) {
    for (const key of Object.keys(failed)) {
      const err = failed[key];
      console.error(`${bold("✗")} Failed: ${err.message ?? JSON.stringify(err)}`);
    }
  }
}

async function zoteroSearch(query: string, flags: Record<string, string>) {
  const { apiKey, base } = await getZoteroCredentials();
  const limit = parseInt(flags.limit ?? "20");

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    sort: "date",
    direction: "desc",
  });

  const res = await fetch(
    `${base}/items?${params}`,
    { headers: zoteroHeaders(apiKey) }
  );

  if (!res.ok) {
    console.error(`Zotero search error: ${res.status} ${res.statusText}`);
    return;
  }

  const items = await res.json();

  if (!items.length) {
    console.log("No items found in your Zotero library.");
    return;
  }

  console.log(bold(`\nZotero library — ${items.length} results for "${query}"\n`));

  for (let i = 0; i < items.length; i++) {
    const d = items[i].data;
    if (!d || d.itemType === "attachment" || d.itemType === "note") continue;

    const authors = d.creators?.map((c: { lastName?: string; name?: string }) =>
      c.lastName ?? c.name ?? "Unknown"
    ).join(", ") ?? "Unknown";
    const year = d.date?.match(/\d{4}/)?.[0] ?? "n.d.";

    divider();
    console.log(`${cyan(`[${i + 1}]`)} ${bold(d.title ?? "Untitled")}`);
    console.log(`    ${authors} ${dim(`(${year})`)}`);
    console.log(`    ${dim("Type:")} ${d.itemType}  ${dim("Key:")} ${items[i].key}`);
    if (d.DOI) console.log(`    ${dim("DOI:")} ${d.DOI}`);
    if (d.url) console.log(`    ${dim("URL:")} ${d.url}`);
  }
  divider();
}

async function zoteroCollections() {
  const { apiKey, base } = await getZoteroCredentials();

  const res = await fetch(
    `${base}/collections`,
    { headers: zoteroHeaders(apiKey) }
  );

  if (!res.ok) {
    console.error(`Zotero error: ${res.status} ${res.statusText}`);
    return;
  }

  const collections = await res.json();

  if (!collections.length) {
    console.log("No collections found.");
    return;
  }

  console.log(bold("\nZotero collections:\n"));
  for (const c of collections) {
    const d = c.data;
    console.log(`  ${cyan(d.key)}  ${bold(d.name)}  ${dim(`(${d.numItems} items)`)}`);
  }
  console.log("");
}

async function zoteroExport(flags: Record<string, string>) {
  const { apiKey, base } = await getZoteroCredentials();

  let url: string;
  if (flags.collection) {
    // First find the collection key by name
    const colRes = await fetch(
      `${base}/collections`,
      { headers: zoteroHeaders(apiKey) }
    );
    const collections = await colRes.json();
    const match = collections.find((c: { data: { name: string } }) =>
      c.data.name.toLowerCase().includes(flags.collection.toLowerCase())
    );
    if (!match) {
      console.error(`Collection "${flags.collection}" not found.`);
      console.log("Available collections:");
      for (const c of collections) console.log(`  - ${c.data.name}`);
      return;
    }
    url = `${base}/collections/${match.key}/items?format=bibtex&limit=100`;
    console.log(dim(`Exporting collection: ${match.data.name}`));
  } else {
    url = `${base}/items?format=bibtex&limit=100`;
    console.log(dim("Exporting entire library…"));
  }

  const res = await fetch(url, {
    headers: { "Zotero-API-Key": apiKey },
  });

  if (!res.ok) {
    console.error(`Zotero export error: ${res.status} ${res.statusText}`);
    return;
  }

  const bibtex = await res.text();
  console.log(bibtex);
}

function sanitiseFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]*>/g, "")           // strip HTML tags
    .replace(/[^a-z0-9\s_-]/g, "")     // remove special chars
    .replace(/\s+/g, "_")              // spaces to underscores
    .slice(0, 80);                     // reasonable length
}

async function zoteroPdf(itemKey: string, flags: Record<string, string>) {
  const { apiKey, base } = await getZoteroCredentials();
  const pdfDir = "pdf";

  // Ensure pdf/ directory exists
  try { await Deno.mkdir(pdfDir, { recursive: true }); } catch { /* exists */ }

  if (flags.all === "true") {
    // Download all PDFs — fetch only PDF attachments directly
    console.log(dim("Fetching PDF attachments from library…"));

    let start = 0;
    const batchSize = 50;
    let totalDownloaded = 0;
    let totalSkipped = 0;

    while (true) {
      const res = await fetch(
        `${base}/items?itemType=attachment&limit=${batchSize}&start=${start}`,
        { headers: zoteroHeaders(apiKey) }
      );
      if (!res.ok) {
        console.error(`Zotero error: ${res.status}`);
        return;
      }
      const attachments = await res.json();
      if (!attachments.length) break;

      for (const att of attachments) {
        const ad = att.data;
        if (ad?.contentType !== "application/pdf" || !ad.parentItem) continue;

        // Fetch parent item for naming
        const parentRes = await fetch(
          `${base}/items/${ad.parentItem}`,
          { headers: zoteroHeaders(apiKey) }
        );
        if (!parentRes.ok) continue;
        const parent = await parentRes.json();
        const pd = parent.data;

        const creators = (pd.creators as { lastName?: string; name?: string }[]) ?? [];
        const firstAuthor = creators[0]?.lastName ?? creators[0]?.name ?? "unknown";
        const year = ((pd.date as string) ?? "").match(/\d{4}/)?.[0] ?? "nd";
        const title = sanitiseFilename((pd.title as string) ?? "untitled");
        const filename = `${sanitiseFilename(firstAuthor)}_${year}_${title}.pdf`;
        const filepath = `${pdfDir}/${filename}`;

        // Check if already exists
        try {
          await Deno.stat(filepath);
          console.log(dim(`  Skip (exists): ${filename}`));
          totalSkipped++;
          continue;
        } catch { /* doesn't exist */ }

        // Download
        const fileRes = await fetch(
          `${base}/items/${att.key}/file`,
          { headers: { "Zotero-API-Key": apiKey } }
        );
        if (!fileRes.ok) { totalSkipped++; continue; }

        const bytes = new Uint8Array(await fileRes.arrayBuffer());
        await Deno.writeFile(filepath, bytes);
        console.log(green("✓") + ` ${filename} ${dim(`(${(bytes.length / 1024).toFixed(0)}KB)`)}`);
        totalDownloaded++;
      }

      start += batchSize;
      if (attachments.length < batchSize) break;
    }

    console.log(`\n${green("Done.")} Downloaded: ${totalDownloaded}, Skipped: ${totalSkipped}`);
    return;
  }

  // Single item mode
  // First get the item metadata for a sensible filename
  const itemRes = await fetch(
    `${base}/items/${itemKey}`,
    { headers: zoteroHeaders(apiKey) }
  );
  if (!itemRes.ok) {
    console.error(`Item not found: ${itemKey}`);
    return;
  }
  const item = await itemRes.json();
  const d = item.data;

  const result = await downloadPdfForItem(apiKey, base, itemKey, d, pdfDir);
  if (result === "none") {
    console.log("No PDF attachment found for this item.");
    console.log(dim("Grab it via Zotero Firefox connector + RMIT proxy, then try again."));
  }
}

async function downloadPdfForItem(
  apiKey: string,
  base: string,
  itemKey: string,
  itemData: Record<string, unknown>,
  pdfDir: string,
): Promise<"downloaded" | "skipped" | "none"> {
  // Get child items (attachments)
  const childRes = await fetch(
    `${base}/items/${itemKey}/children`,
    { headers: zoteroHeaders(apiKey) }
  );
  if (!childRes.ok) return "none";
  const children = await childRes.json();

  // Find PDF attachment
  const pdfAttachment = children.find(
    (c: { data: { contentType?: string; itemType?: string } }) =>
      c.data?.contentType === "application/pdf" ||
      (c.data?.itemType === "attachment" && c.data?.filename?.endsWith(".pdf"))
  );

  if (!pdfAttachment) return "none";

  // Build sensible filename from item metadata
  const creators = (itemData.creators as { lastName?: string; name?: string }[]) ?? [];
  const firstAuthor = creators[0]?.lastName ?? creators[0]?.name ?? "unknown";
  const year = ((itemData.date as string) ?? "").match(/\d{4}/)?.[0] ?? "nd";
  const title = sanitiseFilename((itemData.title as string) ?? "untitled");
  const filename = `${sanitiseFilename(firstAuthor)}_${year}_${title}.pdf`;
  const filepath = `${pdfDir}/${filename}`;

  // Check if already downloaded
  try {
    await Deno.stat(filepath);
    console.log(dim(`  Skip (exists): ${filename}`));
    return "skipped";
  } catch { /* doesn't exist, proceed */ }

  // Download the file content
  const fileRes = await fetch(
    `${base}/items/${pdfAttachment.key}/file`,
    { headers: { "Zotero-API-Key": apiKey } }
  );

  if (!fileRes.ok) {
    console.log(dim(`  No file content available for: ${itemData.title}`));
    return "none";
  }

  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  await Deno.writeFile(filepath, bytes);
  console.log(green("✓") + ` ${filename} ${dim(`(${(bytes.length / 1024).toFixed(0)}KB)`)}`);
  return "downloaded";
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(Deno.args);
  const source = positional[0];
  const query = positional.slice(1).join(" ");

  // Handle Zotero subcommands separately (different arg structure)
  if (source === "zotero") {
    const subcommand = positional[1];
    const arg = positional.slice(2).join(" ");

    switch (subcommand) {
      case "add":
        if (!arg) { console.error("Usage: search zotero add <DOI or URL>"); Deno.exit(1); }
        await zoteroAdd(arg);
        return;
      case "search":
        if (!arg) { console.error("Usage: search zotero search <query>"); Deno.exit(1); }
        await zoteroSearch(arg, flags);
        return;
      case "pdf":
        await zoteroPdf(arg, flags);
        return;
      case "export":
        await zoteroExport(flags);
        return;
      case "collections":
        await zoteroCollections();
        return;
      default:
        console.error(`Unknown zotero subcommand: ${subcommand}`);
        console.log("Subcommands: add, search, pdf, export, collections");
        Deno.exit(1);
    }
  }

  if (!source || !query) {
    console.log(USAGE);
    Deno.exit(1);
  }

  switch (source) {
    case "scholar":
      await searchScholar(query, flags);
      break;
    case "openalex":
      await searchOpenAlex(query, flags);
      break;
    case "scopus":
      await searchScopus(query, flags);
      break;
    case "lines":
      await searchLines(query, flags);
      break;
    case "web":
      await searchWeb(query, flags);
      break;
    default:
      console.error(`Unknown source: ${source}`);
      console.log(USAGE);
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
