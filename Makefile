# Document Build System

# Variables
SOURCE = document.md
OUTPUT = document.pdf
BIBLIOGRAPHY = bibliography.bib
CSL = apa.csl
METADATA = metadata.yaml

PANDOC_FLAGS = \
	--bibliography=$(BIBLIOGRAPHY) \
	--csl=$(CSL) \
	--pdf-engine=xelatex \
	--number-sections \
	--toc \
	--citeproc \
	--metadata-file=$(METADATA)

# Default target
all: pdf

# Generate PDF with bibliography
pdf: $(OUTPUT)

$(OUTPUT): $(SOURCE) $(BIBLIOGRAPHY) $(CSL) $(METADATA)
	pandoc $(SOURCE) -o $(OUTPUT) $(PANDOC_FLAGS) 2>/dev/null || \
	pandoc $(SOURCE) -o $(OUTPUT) $(PANDOC_FLAGS)

# Clean generated files
clean:
	rm -f $(OUTPUT)

# Open the generated PDF (macOS)
open: pdf
	open $(OUTPUT)

# Watch for changes and rebuild (requires entr: brew install entr)
watch:
	echo $(SOURCE) $(BIBLIOGRAPHY) | tr ' ' '\n' | entr make all

.PHONY: all pdf clean open watch
