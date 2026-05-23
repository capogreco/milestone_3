-- epigraph.lua
-- Pandoc Lua filter: convert `::: epigraph` divs to \epigraph{}{} LaTeX macros.
-- Must run *after* citeproc so [@key] citations inside the div are already
-- rendered as text before the macro arguments are built.
--
-- Markdown usage:
--   ::: epigraph
--   The quote text, possibly with *emphasis* or other markdown.
--
--   --- @authorKey [p. 42]
--   :::
--
-- The last paragraph in the div is treated as the attribution; everything
-- prior is the quote. The blank line between quote and attribution is
-- required — this is the same convention as markdown blockquote attribution.
-- A div with a single paragraph is treated as a quote with no attribution.
--
-- For non-LaTeX outputs the div is passed through unchanged so HTML/EPUB
-- builds can style `.epigraph` with CSS.

local function inlines_to_latex(inlines)
  local doc = pandoc.Pandoc({ pandoc.Plain(inlines) })
  local rendered = pandoc.write(doc, "latex")
  return (rendered:gsub("%s+$", ""))
end

local function block_to_latex_inlines(block)
  if block.t == "Para" or block.t == "Plain" then
    return inlines_to_latex(block.content)
  end
  return pandoc.utils.stringify(block)
end

function Div(elem)
  if not elem.classes:includes("epigraph") then return nil end
  if FORMAT ~= "latex" then return nil end

  local blocks = elem.content
  if #blocks == 0 then return elem end

  local quote_blocks = {}
  local attribution_block = nil

  if #blocks >= 2 then
    for i = 1, #blocks - 1 do
      table.insert(quote_blocks, blocks[i])
    end
    attribution_block = blocks[#blocks]
  else
    quote_blocks = blocks
  end

  local quote_parts = {}
  for _, blk in ipairs(quote_blocks) do
    table.insert(quote_parts, block_to_latex_inlines(blk))
  end
  local quote_latex = table.concat(quote_parts, "\\par ")

  local attr_latex = ""
  if attribution_block then
    attr_latex = block_to_latex_inlines(attribution_block)
  end

  return pandoc.RawBlock("latex",
    "\\epigraph{" .. quote_latex .. "}{" .. attr_latex .. "}")
end
