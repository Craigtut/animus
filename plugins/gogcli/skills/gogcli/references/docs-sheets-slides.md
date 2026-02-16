# Docs, Sheets & Slides — Full Reference

## Google Docs

### Reading

```bash
gog docs info <docId> --json           # Document metadata
gog docs cat <docId> --max-bytes 10000 # Read content as text
gog docs cat <docId> --tab "Notes"     # Read specific tab
gog docs cat <docId> --all-tabs        # Read all tabs
gog docs list-tabs <docId> --json      # List available tabs
```

### Creating

```bash
gog docs create "My Document"
gog docs create "My Doc" --file ./content.md    # Initialize from markdown
gog docs copy <docId> "My Doc Copy"             # Copy existing
```

### Updating

```bash
# Replace all content with markdown
gog docs write <docId> --replace --markdown --file ./doc.md

# Alternative update syntax
gog docs update <docId> --format markdown --content-file ./doc.md

# Find and replace text
gog docs find-replace <docId> "old text" "new text"
```

### Exporting

```bash
gog docs export <docId> --format pdf --out ./doc.pdf
gog docs export <docId> --format docx --out ./doc.docx
gog docs export <docId> --format txt --out ./doc.txt
```

---

## Google Sheets

### Reading

```bash
# Read cell range
gog sheets get <spreadsheetId> 'Sheet1!A1:B10' --json

# Spreadsheet metadata (sheet names, properties)
gog sheets metadata <spreadsheetId> --json

# Read cell notes
gog sheets notes <spreadsheetId> 'Sheet1!A1:B10' --json
```

### Writing

```bash
# Pipe-separated columns, comma-separated rows
gog sheets update <spreadsheetId> 'A1' 'val1|val2,val3|val4'

# JSON array format (more precise)
gog sheets update <spreadsheetId> 'A1' --values-json '[["a","b"],["c","d"]]'

# Copy validation from existing row (preserves dropdowns, data validation)
gog sheets update <spreadsheetId> 'Sheet1!A1:C1' 'new|row|data' --copy-validation-from 'Sheet1!A2:C2'
```

### Appending

```bash
# Append to next empty row
gog sheets append <spreadsheetId> 'Sheet1!A:C' 'new|row|data'
gog sheets append <spreadsheetId> 'Sheet1!A:C' 'new|row|data' --copy-validation-from 'Sheet1!A2:C2'
```

### Clearing

```bash
gog sheets clear <spreadsheetId> 'Sheet1!A1:B10'
```

### Formatting

```bash
gog sheets format <spreadsheetId> 'Sheet1!A1:B2' \
  --format-json '{"textFormat":{"bold":true}}' \
  --format-fields 'userEnteredFormat.textFormat.bold'
```

### Structural Changes

```bash
# Insert rows
gog sheets insert <spreadsheetId> "Sheet1" rows 2 --count 3

# Insert columns after position
gog sheets insert <spreadsheetId> "Sheet1" cols 3 --after
```

### Creating & Copying

```bash
gog sheets create "My Spreadsheet" --sheets "Sheet1,Sheet2"
gog sheets copy <spreadsheetId> "My Sheet Copy"
```

### Exporting

```bash
gog sheets export <spreadsheetId> --format pdf --out ./sheet.pdf
gog sheets export <spreadsheetId> --format xlsx --out ./sheet.xlsx
```

---

## Google Slides

### Info & Listing

```bash
gog slides info <presentationId> --json
gog slides list-slides <presentationId> --json
```

### Creating

```bash
gog slides create "My Deck"
gog slides create-from-markdown "My Deck" --content-file ./slides.md
gog slides copy <presentationId> "My Deck Copy"
```

### Adding & Updating Slides

```bash
# Add slide from image
gog slides add-slide <presentationId> ./slide.png --notes "Speaker notes"

# Update speaker notes
gog slides update-notes <presentationId> <slideId> --notes "Updated notes"

# Replace slide content
gog slides replace-slide <presentationId> <slideId> ./new-slide.png --notes "New notes"
```

### Exporting

```bash
gog slides export <presentationId> --format pdf --out ./deck.pdf
gog slides export <presentationId> --format pptx --out ./deck.pptx
```
