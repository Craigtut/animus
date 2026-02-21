---
name: remotion
description: Programmatic video creation using Remotion. Render React compositions to MP4, GIF, and more.
---

# Remotion — Programmatic Video Creation

Render React compositions to video files using Remotion's CLI. Videos are "functions of images over time" — you write compositions as React components and control animations frame-by-frame.

## Prerequisites

Before using this skill, verify dependencies are installed:

```bash
node scripts/check-deps.js
```

This checks for:
- Node.js 18+ (required)
- Remotion packages installed in target project
- Chrome Headless Shell (auto-downloads if missing)

### Installing Remotion in a Project

For a new project:
```bash
npx create-video@latest my-video
cd my-video
npm install
```

For an existing project:
```bash
npm install --save-exact remotion @remotion/cli @remotion/bundler @remotion/renderer
npx remotion browser ensure
```

## Quick Render

Render a composition to video:

```bash
node plugins/remotion/scripts/render.js \
  --project /path/to/remotion-project \
  --composition MyVideo \
  --output ./output/video.mp4
```

### Required Arguments

- `--project PATH` — Path to the Remotion project directory (must contain a valid entry point)
- `--composition ID` — The composition ID to render (defined in your Root.tsx)
- `--output PATH` — Output file path (e.g., `./output/video.mp4`)

### Optional Arguments

| Flag | Description | Default |
|------|-------------|---------|
| `--width N` | Output width in pixels | Composition default |
| `--height N` | Output height in pixels | Composition default |
| `--fps N` | Frames per second | Composition default |
| `--codec CODEC` | Video codec | `h264` |
| `--props JSON` | Input props as JSON string | `{}` |
| `--crf N` | Quality (0-51, lower = better) | 18 |

### Supported Codecs

| Codec | Extension | Use Case |
|-------|-----------|----------|
| `h264` | `.mp4` | Universal compatibility (default) |
| `h265` | `.mp4` | Smaller files, newer devices |
| `vp8` | `.webm` | Web video |
| `vp9` | `.webm` | High quality web video |
| `prores` | `.mov` | Professional editing |
| `gif` | `.gif` | Animated GIFs |

## Examples

### Basic render
```bash
node plugins/remotion/scripts/render.js \
  --project ~/Videos/my-video \
  --composition HelloWorld \
  --output ./hello.mp4
```

### Custom dimensions and quality
```bash
node plugins/remotion/scripts/render.js \
  --project ~/Videos/my-video \
  --composition Intro \
  --output ./intro-hq.mp4 \
  --width 1920 \
  --height 1080 \
  --fps 60 \
  --crf 15
```

### With input props
```bash
node plugins/remotion/scripts/render.js \
  --project ~/Videos/my-video \
  --composition TitleCard \
  --output ./title.mp4 \
  --props '{"title": "Episode 1", "subtitle": "The Beginning"}'
```

### Create a GIF
```bash
node plugins/remotion/scripts/render.js \
  --project ~/Videos/my-video \
  --composition Reaction \
  --output ./reaction.gif \
  --codec gif \
  --width 480 \
  --fps 15
```

## Project Structure

A Remotion project needs this minimal structure:

```
my-video/
├── src/
│   ├── index.ts          # Entry point (calls registerRoot)
│   ├── Root.tsx          # Registers compositions
│   └── MyComposition.tsx # Your video component
├── package.json
└── remotion.config.ts    # Optional configuration
```

### Root.tsx Example

```tsx
import { Composition } from 'remotion';
import { MyComposition } from './MyComposition';

export const RemotionRoot = () => {
  return (
    <Composition
      id="MyVideo"
      component={MyComposition}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: 'Hello World' }}
    />
  );
};
```

## Output

On success, the script prints the output file path:
```
Video rendered to: ./output/video.mp4
```

## Error Handling

- **Missing project**: Reports if project path doesn't exist or lacks entry point
- **Unknown composition**: Lists available compositions if ID not found
- **Dependency missing**: Suggests installation commands
- **Render failure**: Displays Remotion's error message with context
