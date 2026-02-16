# Drive — Full Reference

## Listing Files

```bash
gog drive ls --max 20 --json
gog drive ls --parent <folderId> --max 20 --json
gog drive ls --no-all-drives --json   # Only "My Drive" (exclude shared drives)
```

## Searching Files

```bash
# Text search
gog drive search "invoice" --max 20 --json
gog drive search "quarterly report" --max 10 --json

# Raw Google Drive query syntax
gog drive search "mimeType = 'application/pdf'" --raw-query --json
gog drive search "modifiedTime > '2025-01-01T00:00:00'" --raw-query --json
gog drive search "name contains 'budget' and mimeType = 'application/vnd.google-apps.spreadsheet'" --raw-query --json

# Exclude shared drives
gog drive search "invoice" --no-all-drives --json
```

## File Info

```bash
gog drive get <fileId> --json    # Full metadata
gog drive url <fileId>           # Get web URL
```

## Uploading

```bash
# Upload to root
gog drive upload ./file.pdf

# Upload to specific folder
gog drive upload ./file.pdf --parent <folderId>

# Replace existing file (preserves sharing, comments)
gog drive upload ./updated.pdf --replace <fileId>

# Upload and convert to Google format
gog drive upload ./report.docx --convert              # Auto-detect
gog drive upload ./chart.png --convert-to sheet        # Force type
gog drive upload ./report.docx --convert --name report # Custom name
```

## Downloading

```bash
# Download as-is
gog drive download <fileId> --out ./downloaded.bin

# Export Google Docs to other formats
gog drive download <fileId> --format pdf --out ./exported.pdf
gog drive download <fileId> --format docx --out ./doc.docx
gog drive download <fileId> --format pptx --out ./slides.pptx
gog drive download <fileId> --format xlsx --out ./sheet.xlsx
```

## Folders

```bash
gog drive mkdir "New Folder"
gog drive mkdir "Subfolder" --parent <parentFolderId>
```

## Moving & Renaming

```bash
gog drive rename <fileId> "New Name"
gog drive move <fileId> --parent <destinationFolderId>
```

## Copying

```bash
gog drive copy <fileId> "Copy Name"
```

## Deleting

```bash
gog drive delete <fileId>              # Move to trash
gog drive delete <fileId> --permanent  # Permanently delete
```

## Permissions & Sharing

```bash
# View permissions
gog drive permissions <fileId> --json

# Share with a user
gog drive share <fileId> --to user --email user@example.com --role reader
gog drive share <fileId> --to user --email user@example.com --role writer

# Share with a domain
gog drive share <fileId> --to domain --domain example.com --role reader

# Remove sharing
gog drive unshare <fileId> --permission-id <permissionId>
```

## Shared Drives

```bash
gog drive drives --max 100 --json
```

## Tips

- File IDs from Google URLs: `docs.google.com/document/d/<fileId>/edit`
- Use `--raw-query` for advanced Drive API queries
- `--convert` on upload turns Office docs into Google native format
- `--format` on download exports Google native format to Office/PDF
