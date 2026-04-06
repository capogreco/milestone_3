#!/usr/bin/env -S deno run --allow-read --allow-run

// Simple Pandoc citation picker for Zed
// - Reads bibliography path from metadata.yaml (string or list)
// - Lists .bib entries via fzf with multi-select
// - Prompts for an optional shared locator (applied per citation)
// - Copies a Pandoc-style snippet (e.g., [@key1; @key2, p. 10]) to clipboard

type Entry = {
  key: string;
  title?: string;
  author?: string;
  year?: string;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (_) {
    return false;
  }
}

async function readBibliographyFromMetadata(metaPath = "metadata.yaml"): Promise<string[]> {
  if (!(await fileExists(metaPath))) {
    throw new Error(`metadata file not found: ${metaPath}`);
  }
  const text = await Deno.readTextFile(metaPath);

  // Very small YAML reader for just the 'bibliography' key
  // Supports either: bibliography: file.bib OR a list under it
  const lines = text.split(/\r?\n/);
  let found = false;
  let inlineValue: string | null = null;
  const listValues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!found) {
      const m = line.match(/^\s*bibliography\s*:\s*(.*)\s*$/i);
      if (m) {
        found = true;
        const val = (m[1] ?? "").trim();
        if (val && !val.startsWith("[")) {
          // Inline scalar value
          inlineValue = val.replace(/^['"]|['"]$/g, "");
          break;
        } else if (!val) {
          // Expect block list on following indented lines starting with '- '
          let j = i + 1;
          while (j < lines.length) {
            const l = lines[j];
            if (/^\s*-\s+/.test(l)) {
              const item = l.replace(/^\s*-\s+/, "").trim();
              if (item) listValues.push(item.replace(/^['"]|['"]$/g, ""));
              j++;
              continue;
            }
            if (/^\s*\S/.test(l)) {
              // next top-level key
              break;
            }
            j++;
          }
          break;
        }
      }
    }
  }

  if (!found) {
    throw new Error("'bibliography' key not found in metadata.yaml");
  }
  if (inlineValue) return [inlineValue];
  if (listValues.length) return listValues;
  throw new Error("Could not resolve bibliography path(s) from metadata.yaml");
}

function extractField(body: string, name: string): string | undefined {
  // Naive field extractor: name = { ... } or name = " ... "
  // Handles single-line or multi-line until balanced closing brace/quote (best-effort)
  const re = new RegExp(`\\b${name}\\s*=\\s*(\\{[\\s\\S]*?\\}|\"[\\s\\S]*?\")`, "i");
  const m = body.match(re);
  if (!m) return undefined;
  let val = m[1].trim();
  if (val.startsWith("{")) val = val.slice(1, -1);
  if (val.startsWith('"')) val = val.slice(1, -1);
  // collapse whitespace
  return val.replace(/\s+/g, " ").trim();
}

function parseBibTex(content: string): Entry[] {
  const entries: Entry[] = [];
  // Split by @<type>{<key>, ...}
  const parts = content.split(/\n@/); // keep it simple; first part may be preamble
  for (let idx = 1; idx < parts.length; idx++) {
    const chunk = parts[idx];
    const atChunk = "@" + chunk; // restore
    const headMatch = atChunk.match(/^@\w+\s*\{\s*([^,\s]+)\s*,/);
    if (!headMatch) continue;
    const key = headMatch[1].trim();
    // body starts after first comma following the key
    const commaIndex = atChunk.indexOf(",", headMatch[0].length - 1);
    const body = commaIndex >= 0 ? atChunk.slice(commaIndex + 1) : atChunk;

    const title = extractField(body, "title");
    const year = extractField(body, "year");
    let author = extractField(body, "author");
    if (author) {
      // Take first author surname if possible
      const first = author.split(/\s+and\s+/i)[0] ?? author;
      // Remove braces around names
      const clean = first.replace(/[{}]/g, "").trim();
      
      // Handle "Last, First" format (common in BibTeX)
      if (clean.includes(",")) {
        const parts = clean.split(",");
        author = parts[0].trim();
      } else {
        // Fallback: take last token for "First Last" format
        const tokens = clean.split(/\s+/);
        if (tokens.length) author = tokens[tokens.length - 1];
      }
    }

    entries.push({ key, title, author, year });
  }
  return entries;
}

function formatChoice(e: Entry): string {
  // TSV: key \t Label \t Title
  const labelParts = [e.author, e.year].filter(Boolean).join(" ");
  const label = labelParts || e.key;
  const title = e.title ?? "";
  return `${e.key}\t${label}\t${title}`;
}

async function ensureFzfAvailable() {
  try {
    const p = new Deno.Command("fzf", { args: ["--version"], stdout: "piped", stderr: "piped" });
    const { code } = await p.output();
    if (code !== 0) throw new Error();
  } catch {
    throw new Error("fzf not found. Install via: brew install fzf");
  }
}

async function pickWithFzf(lines: string[]): Promise<string[]> {
  const p = new Deno.Command("fzf", {
    args: [
      "-m", // multi-select
      "--ansi",
      "--delimiter",
      "\t",
      "--with-nth",
      "2,3",
      "--height",
      "80%",
      "--reverse",
      "--prompt",
      "Cite > ",
      "--bind",
      "ctrl-a:select-all+accept",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = p.spawn();
  const encoder = new TextEncoder();
  const writer = child.stdin?.getWriter();
  if (!writer) throw new Error("failed to open fzf stdin writer");
  await writer.write(encoder.encode(lines.join("\n")));
  await writer.close();
  const { code, stdout } = await child.output();
  if (code !== 0) return [];
  const out = new TextDecoder().decode(stdout).trim();
  if (!out) return [];
  return out.split(/\r?\n/);
}

async function copyToClipboard(text: string) {
  const p = new Deno.Command("pbcopy", { stdin: "piped" });
  const child = p.spawn();
  const encoder = new TextEncoder();
  const writer = child.stdin?.getWriter();
  if (!writer) throw new Error("failed to open clipboard stdin writer");
  await writer.write(encoder.encode(text));
  await writer.close();
  await child.status;
}

function buildCitation(keys: string[], sharedLocator?: string): string {
  if (!keys.length) return "";
  const parts = keys.map((k) => {
    if (sharedLocator && sharedLocator.trim()) {
      return `@${k}, ${sharedLocator.trim()}`;
    }
    return `@${k}`;
  });
  return `[${parts.join("; ")}]`;
}

async function main() {
  try {
    const bibs = await readBibliographyFromMetadata();
    const existing: string[] = [];
    for (const p of bibs) {
      if (await fileExists(p)) existing.push(p);
    }
    if (!existing.length) {
      throw new Error(`No bibliography files found from metadata.yaml (looked for: ${bibs.join(", ")})`);
    }

    await ensureFzfAvailable();

    const allEntries: Entry[] = [];
    for (const path of existing) {
      const content = await Deno.readTextFile(path);
      allEntries.push(...parseBibTex(content));
    }
    // de-duplicate by key
    const seen = new Set<string>();
    const entries = allEntries.filter(e => {
      if (seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    });
    if (!entries.length) {
      throw new Error("No entries parsed from bibliography.");
    }

    const choices = entries.map(formatChoice);
    const selected = await pickWithFzf(choices);
    if (!selected.length) {
      console.error("No selection.");
      Deno.exit(1);
    }

    const keys = selected.map((line) => line.split("\t")[0]);

    let locator: string | undefined = undefined;
    if (keys.length > 1) {
      locator = prompt("Optional shared locator for all (e.g., p. 42, chap. 3). Leave blank for none:") ?? undefined;
      if (locator) locator = locator.trim();
    } else {
      locator = prompt("Optional locator (e.g., p. 42). Leave blank for none:") ?? undefined;
      if (locator) locator = locator.trim();
    }

    const snippet = buildCitation(keys, locator);
    if (!snippet) {
      console.error("Empty citation snippet.");
      Deno.exit(1);
    }

    await copyToClipboard(snippet);
    console.log("Copied to clipboard:\n" + snippet);
  } catch (err) {
    console.error("Error:", err.message ?? String(err));
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
