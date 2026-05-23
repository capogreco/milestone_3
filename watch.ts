#!/usr/bin/env deno run --allow-read --allow-run

type WatchTarget = {
  relativePath: string;
  buildCommand: string[];
  outputPdf: string;
};

// Meta files to exclude from PDF generation — kept in sync with the
// EXCLUDE list in the Makefile.
const EXCLUDED_NAMES = new Set<string>([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE.md",
]);

async function discoverMarkdownTargets(): Promise<WatchTarget[]> {
  const targets: WatchTarget[] = [];
  for await (const entry of Deno.readDir(".")) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const base = entry.name.slice(0, -".md".length);
    targets.push({
      relativePath: `./${entry.name}`,
      buildCommand: ["make", `${base}.pdf`],
      outputPdf: `${base}.pdf`,
    });
  }
  return targets;
}

// Shared files that should trigger a rebuild of *all* targets when modified.
// Filtered to those that actually exist on disk before passing to watchFs.
const EXTRA_WATCH_CANDIDATES = [
  "./metadata.yaml",
  "./bibliography.bib",
  "./epigraph.lua",
];

async function existing(paths: string[]): Promise<string[]> {
  const present: string[] = [];
  for (const p of paths) {
    try {
      await Deno.stat(p);
      present.push(p);
    } catch {
      // file not present in this project; skip
    }
  }
  return present;
}

const WATCH_TARGETS = await discoverMarkdownTargets();
const EXTRA_WATCH_PATHS = await existing(EXTRA_WATCH_CANDIDATES);

if (WATCH_TARGETS.length === 0) {
  console.log("⚠️  No .md files found in project root (after exclusions).");
  console.log("    Excluded names: " + [...EXCLUDED_NAMES].join(", "));
  Deno.exit(0);
}

console.log("🔄 Starting file watcher for Markdown sources:");
for (const target of WATCH_TARGETS) {
  console.log(`- ${target.relativePath} -> ${target.outputPdf}`);
}
for (const extra of EXTRA_WATCH_PATHS) {
  console.log(`- ${extra} (rebuilds all)`);
}
console.log("📝 Will regenerate PDFs on file changes...\n");

async function buildPdf(target: WatchTarget) {
  console.log(`🔨 Building PDF for ${target.relativePath}...`);

  try {
    const process = new Deno.Command(target.buildCommand[0], {
      args: target.buildCommand.slice(1),
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout: _stdout, stderr } = await process.output();

    if (code === 0) {
      console.log(`✅ ${target.outputPdf} generated successfully!`);

      // Touch file for Skim auto-refresh
      try {
        const touchProcess = new Deno.Command("touch", {
          args: [target.outputPdf],
        });
        await touchProcess.output();
        console.log("🔄 PDF updated for Skim");
      } catch (_refreshError) {
        console.log("⚠️  Could not update PDF timestamp");
      }
    } else {
      console.error("❌ PDF generation failed:");
      console.error(new TextDecoder().decode(stderr));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("❌ Error running build command:", msg);
  }
  console.log("");
}

// Build initial PDFs
for (const target of WATCH_TARGETS) {
  await buildPdf(target);
}

// Watch for file changes
const watchPaths = [
  ...WATCH_TARGETS.map((target) => target.relativePath),
  ...EXTRA_WATCH_PATHS,
];
const watcher = Deno.watchFs(watchPaths);

function pathMatches(eventPath: string, watched: string): boolean {
  return eventPath.includes(watched.replace("./", ""));
}

for await (const event of watcher) {
  console.log(`📊 Event: ${event.kind}, Paths: ${event.paths}`);

  if (event.kind === "modify") {
    const sharedTouched = EXTRA_WATCH_PATHS.some((extra) =>
      event.paths.some((p) => pathMatches(p, extra))
    );

    for (const target of WATCH_TARGETS) {
      const targetTouched = event.paths.some((p) => pathMatches(p, target.relativePath));
      if (targetTouched || sharedTouched) {
        const trigger = targetTouched ? target.relativePath : "shared file";
        console.log(`📄 ${trigger} changed, rebuilding ${target.outputPdf}...`);
        await buildPdf(target);
      }
    }
  }
}
