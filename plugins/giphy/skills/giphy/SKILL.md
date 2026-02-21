---
name: giphy
description: >
  Search and send GIFs using the Giphy API. Use when expressing reactions,
  emotions, humor, or when the user asks for a GIF. Triggers include "send me
  a gif", "gif of", "react with", or any request for animated visual expression.
allowed-tools: Bash
---

# Giphy - GIF Search and Delivery

Search Giphy's massive library of GIFs and send them as visual reactions or expressions.

**Requires**: Credential `giphy.GIPHY_API_KEY` (configure in Settings > Plugins)

## When to Use

Use this skill proactively when:
- Expressing a reaction or emotion that a GIF would capture well
- The user asks for a GIF of something specific
- Adding humor or visual flair to a conversation
- Celebrating successes, commiserating failures, or punctuating moments

## Searching and Sending a GIF

Use `run_with_credentials` to search for and download a GIF:

```
run_with_credentials({
  command: "node plugins/giphy/skills/giphy/scripts/search-gif.js --query \"excited celebration\" --output ./gifs",
  credentialRef: "giphy.GIPHY_API_KEY",
  envVar: "GIPHY_API_KEY"
})
```

Then send it using `send_media`:

```
send_media({
  files: [{ path: "/path/to/downloaded.gif" }],
  caption: "My reaction right now"
})
```

### Required Arguments

- `--query "search terms"` - What to search for (e.g., "happy dance", "mind blown", "thank you")

### Optional Arguments

- `--output DIR` - Output directory (default: `./gifs`)
- `--rating RATING` - Content rating filter: `g`, `pg`, `pg-13`, `r` (default: `pg`)
- `--random` - Pick a random result from top 10 instead of the first result

## Search Tips

- **Be specific**: "excited puppy" beats "happy"
- **Use emotions**: "frustrated", "relieved", "confused"
- **Pop culture works**: "mic drop", "deal with it", "this is fine"
- **Actions are good**: "dancing", "facepalm", "thumbs up"

## Output

The script downloads the GIF and prints the file path to stdout:

```
/Users/craigtut/Code/animus/gifs/giphy-xT9IgG50Fb7Mi.gif
```

## Error Handling

- Missing `GIPHY_API_KEY`: Script exits with clear error message
- No results found: Reports "No GIFs found for query: ..."
- Network errors: Reports the error and suggests checking connectivity
- Rate limit (100/hour): Reports limit reached, suggests waiting

## Examples

**Celebration reaction:**
```
run_with_credentials({
  command: "node plugins/giphy/skills/giphy/scripts/search-gif.js --query \"celebration dance\" --random",
  credentialRef: "giphy.GIPHY_API_KEY",
  envVar: "GIPHY_API_KEY"
})
```

**Specific emotion:**
```
run_with_credentials({
  command: "node plugins/giphy/skills/giphy/scripts/search-gif.js --query \"mind blown\"",
  credentialRef: "giphy.GIPHY_API_KEY",
  envVar: "GIPHY_API_KEY"
})
```
