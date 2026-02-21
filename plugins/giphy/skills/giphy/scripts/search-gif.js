#!/usr/bin/env node
/**
 * search-gif.js - Search Giphy and download a GIF
 *
 * Usage:
 *   node search-gif.js --query "happy dance" [--output ./gifs] [--rating pg] [--random]
 *
 * Environment:
 *   GIPHY_API_KEY - Required. Giphy API key (injected via run_with_credentials)
 *
 * Output:
 *   Prints the absolute path to the downloaded GIF file on success.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    query: null,
    output: './gifs',
    rating: 'pg',
    random: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--query':
        options.query = args[++i];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--rating':
        options.rating = args[++i];
        break;
      case '--random':
        options.random = true;
        break;
    }
  }

  return options;
}

// Make HTTPS request and return JSON
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Download file from URL
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    // Handle both http and https
    const protocol = url.startsWith('https') ? https : require('http');

    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {}); // Clean up partial file
      reject(err);
    });
  });
}

async function main() {
  // Check for API key
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    console.error('Error: GIPHY_API_KEY environment variable is required.');
    console.error('Configure it in Settings > Plugins > Giphy');
    process.exit(1);
  }

  // Parse arguments
  const options = parseArgs();

  if (!options.query) {
    console.error('Error: --query is required');
    console.error('Usage: node search-gif.js --query "search terms" [--output ./gifs] [--rating pg] [--random]');
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.resolve(options.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build search URL
  const encodedQuery = encodeURIComponent(options.query);
  const limit = options.random ? 10 : 1;
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodedQuery}&limit=${limit}&rating=${options.rating}`;

  try {
    // Search Giphy
    const response = await fetchJson(url);

    // Check for API errors
    if (response.meta && response.meta.status !== 200) {
      if (response.meta.status === 403) {
        console.error('Error: API key is invalid or banned. Please check your Giphy API key.');
      } else if (response.meta.status === 429) {
        console.error('Error: Rate limit exceeded (100 requests/hour). Please wait before trying again.');
      } else {
        console.error(`Error: Giphy API error - ${response.meta.msg}`);
      }
      process.exit(1);
    }

    // Check for results
    if (!response.data || response.data.length === 0) {
      console.error(`No GIFs found for query: "${options.query}"`);
      process.exit(1);
    }

    // Pick a GIF (random or first)
    const gifIndex = options.random ? Math.floor(Math.random() * response.data.length) : 0;
    const gif = response.data[gifIndex];

    // Get the original GIF URL (full quality)
    // Giphy provides multiple formats - we want the original GIF
    const gifUrl = gif.images.original.url;
    const gifId = gif.id;

    // Download the GIF
    const filename = `giphy-${gifId}.gif`;
    const destPath = path.join(outputDir, filename);

    await downloadFile(gifUrl, destPath);

    // Output the absolute path
    console.log(path.resolve(destPath));

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
