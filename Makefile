# Document Build System

# Build configuration
BIBLIOGRAPHY = bibliography.bib
CSL = apa.csl
METADATA = metadata.yaml

# Auto-discover .md files in the project root. README.md and other meta
# files are excluded by name; everything else builds to a same-named .pdf.
SOURCES := $(wildcard *.md)
EXCLUDE := README.md CHANGELOG.md CONTRIBUTING.md LICENSE.md
DOCS := $(filter-out $(EXCLUDE), $(SOURCES))
PDFS := $(DOCS:.md=.pdf)

PANDOC_FLAGS = \
	--bibliography=$(BIBLIOGRAPHY) \
	--csl=$(CSL) \
	--pdf-engine=xelatex \
	--number-sections \
	--toc \
	--citeproc \
	--lua-filter=epigraph.lua \
	--metadata-file=$(METADATA)

# Default target: build every discovered document
all: $(PDFS)

# Backwards-compat alias
pdf: all

# Generic pattern rule: any .md becomes its same-named .pdf
%.pdf: %.md $(BIBLIOGRAPHY) $(CSL) $(METADATA) epigraph.lua
	pandoc $< -o $@ $(PANDOC_FLAGS) 2>/dev/null || \
	pandoc $< -o $@ $(PANDOC_FLAGS)

# Clean only generated PDFs (leaves source/reference PDFs untouched)
clean:
	rm -f $(PDFS)

# Open the first generated PDF (macOS)
open: all
	@first_pdf=$$(echo $(PDFS) | awk '{print $$1}'); \
	open "$$first_pdf"

# Watch for changes and rebuild (requires entr: brew install entr)
watch:
	echo $(DOCS) $(BIBLIOGRAPHY) $(METADATA) epigraph.lua | tr ' ' '\n' | entr make all

.PHONY: all pdf clean open watch
