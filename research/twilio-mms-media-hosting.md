# Twilio MMS Media Hosting Research

> Research date: 2026-02-15

## Problem

Twilio's MMS API requires a **publicly accessible URL** for media attachments. There's no way to pass binary data or base64 directly. Animus is a self-hosted app and we don't want to expose the backend server to the internet just to serve images.

## How Twilio MediaUrl Works

When you send an MMS via `messages.create()`, you pass one or more `MediaUrl` values. **Twilio's servers fetch the media from those URLs** — it's a pull model, not a push/upload.

```javascript
client.messages.create({
  body: 'Here is an image',
  from: '+1xxxxxxx',
  to: '+1xxxxxxx',
  mediaUrl: ['https://example.com/image.png'],
});
```

### Constraints

| Constraint | Detail |
|---|---|
| URL accessibility | Must be public HTTPS with valid CA cert |
| Size limit | 5 MB total per message (body + all media) |
| Attachments | Up to 10 MediaUrl per message |
| Supported formats | jpeg, png, gif (fully optimized); pdf, mp4, etc. (accepted but not optimized) |
| Fetch timeout | ~26 seconds |
| Data URIs | **Not supported** |
| Base64 in API | **Not supported** — no parameter for binary data |

## Twilio-Native Options (All Inadequate)

### Twilio Assets
Each upload triggers a full Build + Deploy cycle (10-30s). Designed for static assets, not dynamic per-message media. Too slow and heavy.

### Media Content Service (MCS)
Accepts binary uploads, but **only works with Twilio Conversations** (the chat product), not Programmable Messaging (SMS/MMS). Not applicable.

### Content Templates
Still requires a public URL. Doesn't solve the problem.

## External Hosting Options

### Tier 1: Recommended

#### Cloudflare R2

Free forever: 10 GB storage, 1M Class A ops, 10M Class B ops/month. Zero egress fees. S3-compatible API with presigned URL support.

| Pros | Cons |
|---|---|
| Free forever (not a trial) | Requires Cloudflare account |
| Zero egress — Twilio fetches cost nothing | Requires payment method even for free tier |
| Presigned URLs auto-expire, no cleanup | 3 credentials to configure (account ID, access key, secret) |
| S3-compatible (`@aws-sdk/client-s3`) | More setup steps than simpler services |
| CDN-backed, fast worldwide | |
| Object lifecycle rules for extra cleanup | |

**UX cost**: High. User must create Cloudflare account, enable R2, create bucket, generate API token, configure 3 credentials. This is the power-user option.

#### ImgBB

Free, one API key, built-in auto-delete.

| Pros | Cons |
|---|---|
| Simplest integration (~15 lines of code) | No SLA, third-party service |
| One API key to configure | ~1,250 uploads/day limit |
| Built-in auto-delete (60s to 180 days) | Less "serious" than cloud storage |
| Accepts base64 directly | Could change terms or go down |
| No cloud provider account needed | |

**UX cost**: Low. Sign up, copy one API key, paste it in. Done.

### Tier 2: Good but More Friction

| Service | Free Tier | Egress Fees | Notes |
|---|---|---|---|
| AWS S3 | 5 GB (12 months only) | $0.09/GB | Industry standard, presigned URLs. Free tier expires. |
| Backblaze B2 | 10 GB forever | $0.01/GB (free via Cloudflare) | S3-compatible, cheap, smaller ecosystem. |
| Cloudinary | 25 GB bandwidth/month | Included | Generous free tier, overkill for just hosting images. |

### Tier 3: Usable but Risky

| Service | Notes |
|---|---|
| Imgur | Free, but no auto-delete. ToS may not allow bot usage. |
| 0x0.st | No account needed, 30-day retention. No SLA, could disappear. |
| tmpfiles.org | 60-minute retention. Returns redirect URL, not direct link. |

## Approaches Ruled Out

### Tunnels (ngrok, Cloudflare Tunnel)
Fine for development (Twilio recommends ngrok for dev). **Not suitable for production** — exposes the backend to the internet, which is exactly what we're trying to avoid. ngrok paid tier is $8/month for stable URLs.

### Data URIs / Base64
Twilio does not accept `data:` URIs or binary data in any API parameter for Programmable Messaging. Confirmed not supported.

### Twilio Assets for Dynamic Media
Build + Deploy cycle per image is 10-30 seconds. Not viable for on-demand image sending.

## What Production Apps Do

The standard pattern:

1. Generate image on server
2. Upload to object storage (S3, R2, etc.)
3. Generate presigned URL with short expiration (5-15 min)
4. Pass URL as `MediaUrl` to Twilio
5. Twilio fetches within seconds
6. URL auto-expires — no cleanup, no persistent public exposure

AWS and Twilio both have example repos and blog posts showing this exact architecture.

## Recommendation for Animus

**Make media hosting pluggable and optional.** If no provider is configured, MMS sends without media (or warns). Abstract behind an interface:

```typescript
interface MediaHostingProvider {
  upload(buffer: Buffer, contentType: string, expiresInSeconds?: number): Promise<string>;
  delete?(url: string): Promise<void>;
}
```

**Default/easy option: ImgBB** — one API key, works immediately. Lowest friction for getting started.

**Power-user option: Cloudflare R2** (or any S3-compatible) — for users who want full control, zero egress, and enterprise-grade reliability.

This way the getting-started experience is "paste one API key" and the interface makes adding more providers trivial later.
