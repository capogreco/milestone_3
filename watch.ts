#!/usr/bin/env deno run --allow-read --allow-run

type WatchTarget = {
  relativePath: string;
  buildCommand: string[];
  outputPdf: string;
};

const WATCH_TARGETS: WatchTarget[] = [
  {
    relativePath: "./document.md",
    buildCommand: ["make", "pdf"],
    outputPdf: "document.pdf",
  },
];

// Shared files that should trigger a rebuild of all targets when modified.
const EXTRA_WATCH_PATHS = [
  "./metadata.yaml",
  "./bibliography.bib",
];

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

    const { code, stdout, stderr } = await process.output();

    if (code === 0) {
      console.log(`✅ ${target.outputPdf} generated successfully!`);

      // Touch file for Skim auto-refresh
      try {
        const touchProcess = new Deno.Command("touch", {
          args: [target.outputPdf],
        });
        await touchProcess.output();
        console.log("🔄 PDF updated for Skim");
      } catch (refreshError) {
        console.log("⚠️  Could not update PDF timestamp");
      }
    } else {
      console.error("❌ PDF generation failed:");
      console.error(new TextDecoder().decode(stderr));
    }
  } catch (error) {
    console.error("❌ Error running build command:", error.message);
  }
  console.log("");
}

// Build initial PDF
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
