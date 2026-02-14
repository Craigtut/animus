/**
 * API Channel Adapter (OpenAI + Ollama Compatible)
 *
 * Exposes Animus as an OpenAI and Ollama compatible REST API.
 * Routes:
 *   OpenAI: /openai/v1/models, /openai/v1/chat/completions
 *   Ollama: /ollama/api/tags, /ollama/api/chat, /ollama/api/generate
 *
 * Supports both streaming (SSE/NDJSON) and non-streaming responses.
 * Uses a pending-reply pattern to bridge reportIncoming() -> send().
 */
import { timingSafeEqual } from 'node:crypto';
// ============================================================================
// Helpers
// ============================================================================
/**
 * Extract the last user message from an OpenAI-format messages array.
 * Handles both string content and multimodal content arrays.
 */
function extractLastUserMessage(messages) {
    if (!Array.isArray(messages))
        return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg['role'] === 'user') {
            const content = msg['content'];
            if (typeof content === 'string')
                return content;
            if (Array.isArray(content)) {
                return content
                    .filter((c) => c['type'] === 'text')
                    .map((c) => c['text'])
                    .join('\n');
            }
        }
    }
    return '';
}
// ============================================================================
// Adapter Factory
// ============================================================================
export default function createAdapter(ctx) {
    const apiKey = ctx.config['apiKey'];
    const enableOllama = ctx.config['enableOllama'] ?? true;
    const enableOpenai = ctx.config['enableOpenai'] ?? true;
    const REPLY_TIMEOUT_MS = 120_000;
    // Pending replies: maps requestId -> resolver.
    // When reportIncoming is called, it stores a promise.
    // When send() is called, it resolves the oldest pending reply (FIFO).
    const pendingReplies = new Map();
    let requestCounter = 0;
    function waitForReply(requestId) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingReplies.delete(requestId);
                reject(new Error('Reply timeout'));
            }, REPLY_TIMEOUT_MS);
            pendingReplies.set(requestId, { resolve, timer });
        });
    }
    function validateApiKey(request) {
        if (!apiKey)
            return true; // No key configured = open access
        const authHeader = request.headers['authorization'];
        if (!authHeader)
            return false;
        // Support both "Bearer <key>" and just "<key>"
        const token = authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : authHeader;
        // Use timing-safe comparison to prevent timing attacks
        try {
            const tokenBuf = Buffer.from(token, 'utf-8');
            const keyBuf = Buffer.from(apiKey, 'utf-8');
            if (tokenBuf.length !== keyBuf.length)
                return false;
            return timingSafeEqual(tokenBuf, keyBuf);
        }
        catch {
            return false;
        }
    }
    return {
        async start() {
            // ================================================================
            // OpenAI-compatible endpoints
            // ================================================================
            if (enableOpenai) {
                // GET /openai/v1/models
                ctx.registerRoute({
                    method: 'GET',
                    path: '/openai/v1/models',
                    handler: async (_request) => {
                        return {
                            status: 200,
                            body: {
                                object: 'list',
                                data: [
                                    {
                                        id: 'animus',
                                        object: 'model',
                                        created: Math.floor(Date.now() / 1000),
                                        owned_by: 'animus',
                                    },
                                ],
                            },
                        };
                    },
                });
                // POST /openai/v1/chat/completions
                ctx.registerRoute({
                    method: 'POST',
                    path: '/openai/v1/chat/completions',
                    handler: async (request) => {
                        if (!validateApiKey(request)) {
                            return {
                                status: 401,
                                body: {
                                    error: {
                                        message: 'Invalid API key',
                                        type: 'invalid_request_error',
                                    },
                                },
                            };
                        }
                        const body = request.body;
                        const messages = body['messages'] ?? [];
                        const stream = body['stream'] === true;
                        const content = extractLastUserMessage(messages);
                        if (!content) {
                            return {
                                status: 400,
                                body: {
                                    error: {
                                        message: 'No user message found',
                                        type: 'invalid_request_error',
                                    },
                                },
                            };
                        }
                        const requestId = `api-${++requestCounter}-${Date.now()}`;
                        const completionId = `chatcmpl-${Date.now()}`;
                        // Report to engine and wait for reply
                        const replyPromise = waitForReply(requestId);
                        ctx.reportIncoming({
                            identifier: 'api-default',
                            content,
                            conversationId: requestId,
                            metadata: { requestId, format: 'openai', stream },
                        });
                        try {
                            const replyContent = await replyPromise;
                            if (stream) {
                                return {
                                    status: 200,
                                    headers: {
                                        'content-type': 'text/event-stream',
                                        'cache-control': 'no-cache',
                                        connection: 'keep-alive',
                                    },
                                    stream: (async function* () {
                                        // First chunk with role
                                        yield `data: ${JSON.stringify({
                                            id: completionId,
                                            object: 'chat.completion.chunk',
                                            created: Math.floor(Date.now() / 1000),
                                            model: 'animus',
                                            choices: [
                                                {
                                                    index: 0,
                                                    delta: { role: 'assistant', content: '' },
                                                    finish_reason: null,
                                                },
                                            ],
                                        })}\n\n`;
                                        // Content chunk (full content as one chunk for now)
                                        yield `data: ${JSON.stringify({
                                            id: completionId,
                                            object: 'chat.completion.chunk',
                                            created: Math.floor(Date.now() / 1000),
                                            model: 'animus',
                                            choices: [
                                                {
                                                    index: 0,
                                                    delta: { content: replyContent },
                                                    finish_reason: null,
                                                },
                                            ],
                                        })}\n\n`;
                                        // Final chunk
                                        yield `data: ${JSON.stringify({
                                            id: completionId,
                                            object: 'chat.completion.chunk',
                                            created: Math.floor(Date.now() / 1000),
                                            model: 'animus',
                                            choices: [
                                                {
                                                    index: 0,
                                                    delta: {},
                                                    finish_reason: 'stop',
                                                },
                                            ],
                                        })}\n\n`;
                                        yield 'data: [DONE]\n\n';
                                    })(),
                                };
                            }
                            // Non-streaming response
                            return {
                                status: 200,
                                body: {
                                    id: completionId,
                                    object: 'chat.completion',
                                    created: Math.floor(Date.now() / 1000),
                                    model: 'animus',
                                    choices: [
                                        {
                                            index: 0,
                                            message: { role: 'assistant', content: replyContent },
                                            finish_reason: 'stop',
                                        },
                                    ],
                                    usage: {
                                        prompt_tokens: 0,
                                        completion_tokens: 0,
                                        total_tokens: 0,
                                    },
                                },
                            };
                        }
                        catch (err) {
                            return {
                                status: 500,
                                body: {
                                    error: {
                                        message: `Failed to get response: ${err}`,
                                        type: 'server_error',
                                    },
                                },
                            };
                        }
                    },
                });
            }
            // ================================================================
            // Ollama-compatible endpoints
            // ================================================================
            if (enableOllama) {
                // GET /ollama/api/tags
                ctx.registerRoute({
                    method: 'GET',
                    path: '/ollama/api/tags',
                    handler: async (_request) => {
                        return {
                            status: 200,
                            body: {
                                models: [
                                    {
                                        name: 'animus',
                                        model: 'animus',
                                        modified_at: new Date().toISOString(),
                                        size: 0,
                                        digest: '',
                                        details: {
                                            parent_model: '',
                                            format: 'gguf',
                                            family: 'animus',
                                            parameter_size: 'unknown',
                                            quantization_level: 'none',
                                        },
                                    },
                                ],
                            },
                        };
                    },
                });
                // POST /ollama/api/chat
                ctx.registerRoute({
                    method: 'POST',
                    path: '/ollama/api/chat',
                    handler: async (request) => {
                        const body = request.body;
                        const messages = body['messages'] ?? [];
                        const stream = body['stream'] !== false; // Ollama defaults to streaming
                        const content = extractLastUserMessage(messages);
                        if (!content) {
                            return { status: 400, body: { error: 'No user message found' } };
                        }
                        const requestId = `ollama-${++requestCounter}-${Date.now()}`;
                        const replyPromise = waitForReply(requestId);
                        ctx.reportIncoming({
                            identifier: 'api-default',
                            content,
                            conversationId: requestId,
                            metadata: { requestId, format: 'ollama', stream },
                        });
                        try {
                            const replyContent = await replyPromise;
                            if (stream) {
                                return {
                                    status: 200,
                                    headers: { 'content-type': 'application/x-ndjson' },
                                    stream: (async function* () {
                                        // Content chunk
                                        yield (JSON.stringify({
                                            model: 'animus',
                                            created_at: new Date().toISOString(),
                                            message: {
                                                role: 'assistant',
                                                content: replyContent,
                                            },
                                            done: false,
                                        }) + '\n');
                                        // Final chunk
                                        yield (JSON.stringify({
                                            model: 'animus',
                                            created_at: new Date().toISOString(),
                                            message: { role: 'assistant', content: '' },
                                            done: true,
                                            total_duration: 0,
                                            eval_count: 0,
                                        }) + '\n');
                                    })(),
                                };
                            }
                            // Non-streaming
                            return {
                                status: 200,
                                body: {
                                    model: 'animus',
                                    created_at: new Date().toISOString(),
                                    message: { role: 'assistant', content: replyContent },
                                    done: true,
                                    total_duration: 0,
                                    eval_count: 0,
                                },
                            };
                        }
                        catch (err) {
                            return { status: 500, body: { error: String(err) } };
                        }
                    },
                });
                // POST /ollama/api/generate (legacy)
                ctx.registerRoute({
                    method: 'POST',
                    path: '/ollama/api/generate',
                    handler: async (request) => {
                        const body = request.body;
                        const prompt = body['prompt'] ?? '';
                        const stream = body['stream'] !== false;
                        if (!prompt) {
                            return { status: 400, body: { error: 'No prompt provided' } };
                        }
                        const requestId = `ollama-gen-${++requestCounter}-${Date.now()}`;
                        const replyPromise = waitForReply(requestId);
                        ctx.reportIncoming({
                            identifier: 'api-default',
                            content: prompt,
                            conversationId: requestId,
                            metadata: { requestId, format: 'ollama-generate', stream },
                        });
                        try {
                            const replyContent = await replyPromise;
                            if (stream) {
                                return {
                                    status: 200,
                                    headers: { 'content-type': 'application/x-ndjson' },
                                    stream: (async function* () {
                                        yield (JSON.stringify({
                                            model: 'animus',
                                            created_at: new Date().toISOString(),
                                            response: replyContent,
                                            done: false,
                                        }) + '\n');
                                        yield (JSON.stringify({
                                            model: 'animus',
                                            created_at: new Date().toISOString(),
                                            response: '',
                                            done: true,
                                        }) + '\n');
                                    })(),
                                };
                            }
                            return {
                                status: 200,
                                body: {
                                    model: 'animus',
                                    created_at: new Date().toISOString(),
                                    response: replyContent,
                                    done: true,
                                },
                            };
                        }
                        catch (err) {
                            return { status: 500, body: { error: String(err) } };
                        }
                    },
                });
            }
            ctx.log.info(`API adapter started (OpenAI: ${enableOpenai}, Ollama: ${enableOllama})`);
        },
        async stop() {
            // Resolve all pending replies with empty string rather than reject
            for (const [id, pending] of pendingReplies) {
                clearTimeout(pending.timer);
                pending.resolve('');
            }
            pendingReplies.clear();
            ctx.log.info('API adapter stopped');
        },
        async send(_contactId, content, _metadata) {
            // Resolve the oldest pending reply (FIFO).
            // The engine calls send() when the mind produces a reply for this channel.
            const firstEntry = pendingReplies.entries().next();
            if (!firstEntry.done) {
                const [id, pending] = firstEntry.value;
                clearTimeout(pending.timer);
                pending.resolve(content);
                pendingReplies.delete(id);
                ctx.log.debug(`Resolved pending API reply: ${id}`);
            }
            else {
                ctx.log.warn('No pending API request for reply');
            }
        },
    };
}
