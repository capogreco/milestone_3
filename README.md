# Academic Document Template

A markdown-based workflow for generating academic PDF documents with bibliography support, automated builds, and citation management.

## Quick Start

1. Edit `metadata.yaml` with your document details (title, author, institution, etc.)
2. Write your content in `document.md`
3. Add bibliography entries to `bibliography.bib` (export from Zotero or add manually)
4. Run `make pdf` to generate the PDF

## Setup

### Required Dependencies

1. **Pandoc**: `brew install pandoc` (macOS) or equivalent
2. **LaTeX**: `brew install --cask mactex` (macOS) or equivalent
3. **Deno** (optional, for citation picker and file watcher): `brew install deno`
4. **fzf** (optional, for citation picker): `brew install fzf`

### Optional Tools

- **entr** (for `make watch`): `brew install entr`

## Building the PDF

### Basic Build

```bash
make pdf
```

Or manually:

```bash
pandoc document.md -o document.pdf --bibliography=bibliography.bib --csl=apa.csl --pdf-engine=xelatex --metadata-file=metadata.yaml
```

### Other Make Commands

```bash
make clean    # Remove generated PDF
make open     # Build and open PDF (macOS)
make watch    # Watch for changes and auto-rebuild (requires entr)
```

## File Structure

- `document.md` - Your main document content (markdown)
- `metadata.yaml` - Document metadata and configuration
- `bibliography.bib` - Bibliography entries (BibTeX format)
- `Makefile` - Build automation
- `cite.ts` - Citation picker script (Deno)
- `watch.ts` - File watcher script (Deno)
- `deno.json` - Deno task configuration
- `*.csl` - Citation style files (APA, Chicago variants)
- `document.pdf` - Generated output

## Managing Bibliography

### From Zotero

1. In Zotero, select the items you want to cite
2. Right-click and choose "Export Items..."
3. Select "BibTeX" format
4. Save as `bibliography.bib` (overwrite the template file)

### Manual Entry

Add BibTeX entries directly to `bibliography.bib`:

```bibtex
@article{author2024,
  title = {Article Title},
  author = {Author, First and Second, Author},
  journal = {Journal Name},
  year = {2024},
  volume = {1},
  pages = {1--10}
}
```

## Citation Picker (Deno Task)

Quickly insert citations using fuzzy search:

```bash
deno task cite
```

### Features

- Fuzzy search by author, year, title, or citation key
- Multi-select with Tab
- Select all with Ctrl-A
- Add locators (e.g., "p. 42")
- Copies Pandoc citation syntax to clipboard

### Usage

1. Run `deno task cite`
2. Search and select citation(s)
3. Optionally add a locator (e.g., `p. 42`)
4. Paste the clipboard content into your markdown

### Citation Examples

- Single: `[@key]` or `[@key, p. 42]`
- Multiple: `[@key1; @key2]`
- Multiple with locator: `[@key1, p. 10; @key2, p. 10]`

## File Watcher (Deno Task)

Auto-rebuild PDF when markdown changes:

```bash
deno task watch
```

Features:
- Builds PDF on file save
- Supports Skim PDF auto-refresh (macOS)
- Displays build status in terminal

## Document Configuration

Edit `metadata.yaml` to customize:

- Document metadata (title, author, date, abstract, keywords)
- PDF formatting (margins, fonts, line spacing)
- Section numbering style
- Bibliography and citation style
- LaTeX customizations

### Available Citation Styles

- `apa.csl` - APA (default)
- `chicago-note-bibliography.csl` - Chicago notes
- `chicago-notes-bibliography.csl` - Chicago notes (variant)
- `chicago-shortened-notes-bibliography.csl` - Chicago shortened notes

To change styles, edit the `csl` field in `metadata.yaml`.

## Paragraph Style

By default, paragraphs are indented (1.5em) with no space between them, except the first paragraph after a section heading is not indented (classic academic style).

To change this, edit the `header-includes` section in `metadata.yaml`.

## Citations in Markdown

Use Pandoc citation syntax:

```markdown
According to @author2024, this is true.

This is a fact [@author2024].

This is a fact with a page number [@author2024, p. 42].

Multiple sources [@author2024; @another2023].
```

## References Section

Add this at the end of your markdown to generate the bibliography:

```markdown
# References

::: {#refs}
:::
```

## Tips

1. Use `deno task watch` during writing for live PDF updates
2. Use `deno task cite` for quick citation insertion
3. Keep your Zotero library organized and export regularly
4. Check `document.pdf` with a PDF viewer that auto-refreshes (e.g., Skim on macOS)
5. Use `make clean` if you need to force a fresh build

## Troubleshooting

### PDF Generation Fails

- Ensure Pandoc and LaTeX are installed
- Check that all files referenced in `metadata.yaml` exist
- Review error messages for missing packages or syntax errors

### Citation Picker Not Working

- Install Deno: `brew install deno`
- Install fzf: `brew install fzf`
- Ensure `bibliography.bib` exists and has valid BibTeX entries

### File Watcher Not Working

- Install Deno: `brew install deno`
- Check that `document.md` exists
- Ensure Makefile is present and `make pdf` works manually
