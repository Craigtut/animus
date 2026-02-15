---
name: nano-banana-pro
description: Generate and edit images using Google's Nano Banana Pro (Gemini 3 Pro Image).
---

# Nano Banana Pro — Image Generation & Editing

Generate images from text descriptions or edit existing images using Google's Gemini 3 Pro Image model.

**Requires**: Credential `nano-banana-pro.GEMINI_API_KEY` (configure in Settings > Plugins)

## When to Use

Use this skill proactively whenever the conversation involves:
- Creating images
- Generating mockups, illustrations, or concept art
- Making placeholder images for designs
- Creating marketing materials or social media graphics
- Generating diagrams, icons, or visual assets
- Editing or modifying existing images (color changes, style transfers, adding/removing elements)

## Text-to-Image Generation

Generate a new image from a text prompt using `run_with_credentials`:

```
run_with_credentials({
  command: "node plugins/nano-banana-pro/scripts/generate-image.js --prompt \"A serene mountain lake at sunset with purple clouds reflecting on still water\" --aspect-ratio 16:9 --resolution 2K --output ./generated-images",
  credentialRef: "nano-banana-pro.GEMINI_API_KEY",
  envVar: "GEMINI_API_KEY"
})
```

### Required Arguments

- `--prompt "description"` — Text description of the image to generate. Be specific and descriptive.

### Optional Arguments

- `--aspect-ratio RATIO` — Image aspect ratio (default: `1:1`). Options: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`
- `--resolution RES` — Output resolution (default: `2K`). Options: `1K`, `2K`, `4K`
- `--output DIR` — Output directory (default: `./generated-images`)
- `--filename NAME` — Custom filename without extension (auto-generated timestamp if omitted)

## Image-to-Image Editing

Edit an existing image with a text prompt:

```
run_with_credentials({
  command: "node plugins/nano-banana-pro/scripts/generate-image.js --prompt \"Make the sky a deep purple and add northern lights\" --input ./photos/landscape.png --output ./edited-images",
  credentialRef: "nano-banana-pro.GEMINI_API_KEY",
  envVar: "GEMINI_API_KEY"
})
```

### Required Arguments

- `--prompt "instructions"` — Description of the edits to apply
- `--input PATH` — Path to the source image file (PNG, JPEG, WebP)

### Optional Arguments

Same as text-to-image (`--resolution`, `--output`, `--filename`). Note: `--aspect-ratio` is ignored for image-to-image since the input image determines the ratio.

## Prompt Crafting Tips

- **Be specific**: "A golden retriever sitting in a sunlit meadow" beats "a dog"
- **Include style**: "...in watercolor style" or "...photorealistic" or "...flat vector illustration"
- **Describe lighting**: "soft morning light", "dramatic backlighting", "neon glow"
- **Mention composition**: "close-up portrait", "wide aerial view", "centered symmetrical"
- **For edits**: Be precise about what to change — "change the red car to blue" rather than "modify the car"

## Aspect Ratio Guide

| Ratio | Use Case |
|-------|----------|
| `16:9` | Hero images, banners, desktop wallpapers, presentations |
| `1:1` | Social media posts, profile pictures, thumbnails, icons |
| `9:16` | Mobile wallpapers, stories, vertical banners |
| `4:3` | Blog post images, product photos, standard displays |
| `3:4` | Portrait photos, book covers, posters |

## Resolution Guide

| Resolution | Best For |
|------------|----------|
| `1K` | Fast prototyping, thumbnails, quick iterations |
| `2K` | General use, web images, social media (recommended default) |
| `4K` | Production assets, print materials, high-quality finals |

## Output

The script saves the generated PNG to the output directory and prints the full file path to stdout. Example output:

```
Image saved to: ./generated-images/nano-banana-pro-20260214-143022.png
```

## Error Handling

- Missing `GEMINI_API_KEY`: Script exits with a clear error message
- Invalid input file: Reports file not found or unsupported format
- API errors: Displays the error message from the Gemini API
- Rate limits: Reports the rate limit and suggests waiting
