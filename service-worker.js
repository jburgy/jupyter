// Adapted from https://github.com/jupyterlite/jupyterlite/blob/main/packages/server/src/service-worker.ts
// see https://github.com/jupyterlite/jupyterlite/discussions/1752#discussioncomment-14625318

/**
 * The name of the cache
 */
const CACHE = 'precache';

/**
 * Communication channel with the main thread
 */
const broadcast = new BroadcastChannel('/sw-api.v1');

/**
 * Whether to enable the cache
 */
let enableCache = false;

/**
 * Install event listeners
 */
self.addEventListener('install', onInstall);
self.addEventListener('activate', onActivate);
self.addEventListener('fetch', onFetch);

// Event handlers

/**
 * Handle installation with the cache
 * 
 * @param {ExtendableEvent} event
 * @returns {void}
 */
function onInstall(event) {
    void self.skipWaiting();
    event.waitUntil(cacheAll());
}

/**
 * Handle activation.
 *
 * @param {ExtendableEvent} event
 * @returns {void}
 */
function onActivate(event) {
    // check if we should enable the cache
    const searchParams = new URL(location.href).searchParams;
    enableCache = searchParams.get('enableCache') === 'true';
    event.waitUntil(self.clients.claim());
}

/**
 * Handle fetching a single resource.
 * 
 * @param {FetchEvent} event
 * @returns {Promise<void>}
 */
async function onFetch(event) {
    const { request } = event;

    const url = new URL(event.request.url);
    if (url.pathname === '/api/service-worker-heartbeat') {
        event.respondWith(new Response('ok'));
        return;
    }

    const responsePromise = /** type {Promise<Response> | null} */
        shouldBroadcast(url)
            ? broadcastOne(request, url)
            : !shouldDrop(request, url)
                ? maybeFromCache(event)
                : null;

    if (responsePromise) {
        event.respondWith(responsePromise);
    }
}

// utilities

/** 
 * Get a cached response, and update cache. 
 * 
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function maybeFromCache(event) {
    const { request } = event;

    let response = /** type {Promise<Response> | null} */ null;
    if (!enableCache) {
        response = await fetch(request);
        if (shouldAddHeaders(response.url))
            response = withHeaders(response);
        return response;
    }

    response = await fromCache(request);

    if (response) {
        event.waitUntil(refetch(request));
    } else {
        response = await fetch(request);
        if (shouldAddHeaders(response.url))
            response = withHeaders(response);
        event.waitUntil(updateCache(request, response.clone()));
    }

    return response;
}

/**
 * Restore a response from the cache based on the request.
 * 
 * @param {Request} request
 * @returns {Promise<Response | null>}
 */
async function fromCache(request) {
    const cache = await openCache();
    const response = await cache.match(request);

    if (!response || response.status === 404) {
        return null;
    }

    return response;
}

/**
 * This is where we call the server to get the newest version of the
 * file to use the next time we show view
 * 
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function refetch(request) {
    const fromServer = await fetch(request);
    await updateCache(request, fromServer);
    return fromServer;
}

/**
 * @param {Response} response
 * @returns {Response}
 */
function withHeaders(response) {
    const headers = new Headers(response.headers);
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");

    console.log("service-worker.js modified headers for", response.url);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
    });
}

/**
 * Whether a given URL should be broadcast
 * 
 * @param {URL} url
 * @returns {boolean}
 */
function shouldBroadcast(url) {
    return (
        url.origin === location.origin &&
        (url.pathname.includes('/api/drive') || url.pathname.includes('/api/stdin/'))
    );
}

/**
 * Whether the fallback behavior should be used
 * 
 * @param {Request} request
 * @param {URL} url
 * @returns {boolean}
 */
function shouldDrop(request, url) {
    return (
        request.method !== 'GET' ||
        url.origin.match(/^http/) === null ||
        url.pathname.includes('/api/')
    );
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function shouldAddHeaders(url) {
    return /widget.mjs$/.test(url);
}

/**
 * Forward request to main using the broadcast channel
 * 
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function broadcastOne(request, url) {
    const message = await request.json();
    const promise = /** type {Promise<Response>} */ new Promise((resolve) => {
        /** @param {MessageEvent} event */
        const messageHandler = (event) => {
            const data = event.data;
            if (data.browsingContextId !== message.browsingContextId) {
                // bail if the message is not for us
                return;
            }
            const response = data.response;
            resolve(new Response(JSON.stringify(response)));
            broadcast.removeEventListener('message', messageHandler);
        };

        broadcast.addEventListener('message', messageHandler);
    });

    // Add URL pathname to message
    message.pathname = url.pathname;
    broadcast.postMessage(message);

    return await promise;
}

/**
 * 
 * @returns Promise<Cache>
 */
async function openCache() {
    return caches.open(CACHE);
}

/**
 * Cache a request/response pair.
 * @param {Request} request
 * @param {Response} response
 */
async function updateCache(request, response) {
    const cache = await openCache();
    return cache.put(request, response);
}

/**
 * Add all to the cache
 *
 * this is where we should (try to) add all relevant files
 */
async function cacheAll() {
    const cache = await openCache();
    return await cache.addAll([]);
}