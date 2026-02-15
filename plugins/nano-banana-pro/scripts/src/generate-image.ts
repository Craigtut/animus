import { GoogleGenAI } from "@google/genai";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, basename } from "node:path";

// --- CLI Argument Parsing ---

interface Args {
  prompt: string;
  input?: string;
  aspectRatio: string;
  resolution: string;
  output: string;
  filename?: string;
  help: boolean;
}

function printUsage(): void {
  console.log(`
Nano Banana Pro — Image Generation & Editing
Uses Google's Gemini 3 Pro Image model.

Usage:
  node generate-image.js --prompt "description" [options]

Required:
  --prompt TEXT          Text description or edit instructions

Options:
  --input PATH          Source image for image-to-image editing
  --aspect-ratio RATIO  Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4 (default: 1:1)
  --resolution RES      Resolution: 1K, 2K, 4K (default: 2K)
  --output DIR          Output directory (default: ./generated-images)
  --filename NAME       Custom filename without extension
  --help                Show this help message

Environment:
  GEMINI_API_KEY        Required. Google Gemini API key.

Examples:
  # Text-to-image
  node generate-image.js --prompt "A sunset over mountains" --aspect-ratio 16:9

  # Image-to-image editing
  node generate-image.js --prompt "Make the sky purple" --input photo.png
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    prompt: "",
    aspectRatio: "1:1",
    resolution: "2K",
    output: "./generated-images",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--prompt":
        args.prompt = next ?? "";
        i++;
        break;
      case "--input":
        args.input = next;
        i++;
        break;
      case "--aspect-ratio":
        args.aspectRatio = next ?? "1:1";
        i++;
        break;
      case "--resolution":
        args.resolution = next ?? "2K";
        i++;
        break;
      case "--output":
        args.output = next ?? "./generated-images";
        i++;
        break;
      case "--filename":
        args.filename = next;
        i++;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
}

// --- Validation ---

const VALID_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const VALID_RESOLUTIONS = ["1K", "2K", "4K"];
const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "image/png";
  }
}

function generateFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `nano-banana-pro-${date}-${time}`;
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Validate API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable is not set.");
    console.error("Get a key at: https://aistudio.google.com/apikey");
    process.exit(1);
  }

  // Validate prompt
  if (!args.prompt) {
    console.error("Error: --prompt is required.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  // Validate aspect ratio
  if (!VALID_ASPECT_RATIOS.includes(args.aspectRatio)) {
    console.error(`Error: Invalid aspect ratio "${args.aspectRatio}".`);
    console.error(`Valid options: ${VALID_ASPECT_RATIOS.join(", ")}`);
    process.exit(1);
  }

  // Validate resolution
  if (!VALID_RESOLUTIONS.includes(args.resolution)) {
    console.error(`Error: Invalid resolution "${args.resolution}".`);
    console.error(`Valid options: ${VALID_RESOLUTIONS.join(", ")}`);
    process.exit(1);
  }

  // Validate input file if provided
  if (args.input) {
    const inputPath = resolve(args.input);
    if (!existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }
    const ext = extname(inputPath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
      console.error(`Error: Unsupported image format "${ext}".`);
      console.error(`Supported formats: ${SUPPORTED_IMAGE_EXTENSIONS.join(", ")}`);
      process.exit(1);
    }
  }

  // Ensure output directory exists
  const outputDir = resolve(args.output);
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // Initialize Gemini client
  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-pro-image-preview";

  try {
    let contents: any[];

    if (args.input) {
      // Image-to-image: read input file and send alongside prompt
      const inputPath = resolve(args.input);
      const imageData = await readFile(inputPath);
      const base64 = imageData.toString("base64");
      const mimeType = getMimeType(inputPath);

      console.log(`Editing image: ${basename(inputPath)}`);
      console.log(`Prompt: ${args.prompt}`);

      contents = [
        {
          inlineData: {
            mimeType,
            data: base64,
          },
        },
        { text: args.prompt },
      ];
    } else {
      // Text-to-image: prompt only
      console.log(`Generating image...`);
      console.log(`Prompt: ${args.prompt}`);
      console.log(`Aspect ratio: ${args.aspectRatio}, Resolution: ${args.resolution}`);

      contents = [{ text: args.prompt }];
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        responseModalities: ["image", "text"],
        imageConfig: {
          aspectRatio: args.aspectRatio,
          outputResolution: args.resolution,
        },
      },
    });

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      console.error("Error: No response received from the model.");
      process.exit(1);
    }

    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    if (!imagePart?.inlineData) {
      // Check if there's a text response explaining why no image was generated
      const textPart = parts.find((p: any) => p.text);
      if (textPart?.text) {
        console.error(`Model response (no image generated): ${textPart.text}`);
      } else {
        console.error("Error: No image was generated. Try a different prompt.");
      }
      process.exit(1);
    }

    // Save image
    const filename = args.filename ?? generateFilename();
    const outputPath = resolve(outputDir, `${filename}.png`);
    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    await writeFile(outputPath, imageBuffer);

    console.log(`Image saved to: ${outputPath}`);

    // Print any accompanying text
    const textPart = parts.find((p: any) => p.text);
    if (textPart?.text) {
      console.log(`Model notes: ${textPart.text}`);
    }
  } catch (error: any) {
    if (error?.status === 429) {
      console.error("Error: Rate limit exceeded. Please wait a moment and try again.");
    } else if (error?.status === 403) {
      console.error("Error: API key is invalid or does not have access to the Gemini 3 Pro Image model.");
    } else if (error?.message) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error: An unexpected error occurred.", error);
    }
    process.exit(1);
  }
}

main();
