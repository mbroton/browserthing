import assert from 'node:assert/strict';
import http, { type IncomingMessage } from 'node:http';
import net from 'node:net';
import { Duplex } from 'node:stream';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import { SessionGateway } from './gateway.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const secondSessionId = '22222222-2222-4222-8222-222222222222';

test('relays text and binary frames and tracks the session map', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());

    const client = await connect(fixture.gatewayUrl, sessionId);
    await waitFor(() => fixture.gateway.activeConnectionCount === 1);
    assert.deepEqual(fixture.gateway.activeSessionIds, [sessionId]);
    assert.equal(fixture.gateway.activeConnectionCount, 1);

    const textMessage = nextMessage(client);
    client.send('hello');
    assert.deepEqual(await textMessage, { data: Buffer.from('hello'), isBinary: false });

    const binaryMessage = nextMessage(client);
    client.send(Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(await binaryMessage, {
        data: Buffer.from([0, 1, 2, 255]),
        isBinary: true,
    });

    client.close(1000, 'done');
    await waitForClose(client);
    await waitFor(() => fixture.gateway.activeConnectionCount === 0);
    assert.deepEqual(fixture.gateway.activeSessionIds, []);
});

test('rejects missing, invalid, and duplicate session IDs', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());

    assert.equal(await refusedStatus(fixture.gatewayUrl), 400);
    assert.equal(await refusedStatus(fixture.gatewayUrl, 'not-a-uuid'), 400);

    const first = await connect(fixture.gatewayUrl, sessionId);
    assert.equal(await refusedStatus(fixture.gatewayUrl, sessionId), 409);
    first.close();
    await waitForClose(first);
});

test('forwards only Playwright headers and User-Agent', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());

    const client = await connect(fixture.gatewayUrl, sessionId, {
        Authorization: 'Bearer secret',
        Cookie: 'secret=cookie',
        'User-Agent': 'Playwright/1.62.1',
        'x-playwright-proxy': 'enabled',
        'x-unrelated': 'drop-me',
    });
    const request = await fixture.nextUpstreamRequest();

    assert.equal(request.headers['user-agent'], 'Playwright/1.62.1');
    assert.equal(request.headers['x-playwright-proxy'], 'enabled');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers['x-unrelated'], undefined);

    client.close();
    await waitForClose(client);
});

test('a client close closes the browser-side socket', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());

    const client = await connect(fixture.gatewayUrl, sessionId);
    const upstream = await fixture.nextUpstreamSocket();
    const upstreamClosed = waitForClose(upstream);

    client.close(1000, 'client done');
    await waitForClose(client);
    const close = await upstreamClosed;
    assert.equal(close.code, 1000);
    assert.equal(close.reason.toString(), 'client done');
    assert.equal(fixture.gateway.activeConnectionCount, 0);
});

test('a late close event cannot remove a replacement session with the same ID', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const firstClient = await connect(fixture.gatewayUrl, sessionId);
    const internals = fixture.gateway as unknown as {
        sessions: Map<string, { client: WebSocket; upstream: WebSocket }>;
    };
    const firstSession = internals.sessions.get(sessionId);
    assert.ok(firstSession);
    const delayedCloseListeners = firstSession.client.rawListeners('close');
    firstSession.client.removeAllListeners('close');

    fixture.gateway.closeSession(sessionId);
    await waitForClose(firstClient);
    const secondClient = await connect(fixture.gatewayUrl, sessionId);
    t.after(() => secondClient.terminate());
    const secondMessage = nextMessage(secondClient);

    for (const listener of delayedCloseListeners) {
        listener.call(firstSession.client, 1000, Buffer.from('late close'));
    }
    secondClient.send('still open');

    assert.equal(fixture.gateway.activeConnectionCount, 1);
    assert.deepEqual(fixture.gateway.activeSessionIds, [sessionId]);
    assert.deepEqual(await secondMessage, { data: Buffer.from('still open'), isBinary: false });
});

test('does not drop a frame sent as soon as the client opens', async t => {
    const fixture = await createFixture(200);
    t.after(() => fixture.close());

    const upstreamMessage = fixture.nextUpstreamMessage();
    const client = new WebSocket(fixture.gatewayUrl, {
        headers: { 'x-pwd-session-id': sessionId },
    });
    client.once('open', () => client.send('first frame'));
    t.after(() => client.terminate());

    assert.deepEqual(await bounded(upstreamMessage, 2_000), {
        data: Buffer.from('first frame'),
        isBinary: false,
    });
});

test('shutdown resolves with a live session', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const client = await connect(fixture.gatewayUrl, sessionId);
    await waitFor(() => fixture.gateway.activeConnectionCount === 1);

    await bounded(fixture.gateway.shutdown(), 500);
    await waitForClose(client);
});

test('resetting rejected upgrades does not emit an uncaught exception', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    t.after(() => process.off('uncaughtException', onUncaught));

    for (let attempt = 0; attempt < 5; attempt += 1) {
        await resetRejectedUpgrade(fixture.gatewayUrl);
    }
    await delay(30);

    assert.deepEqual(uncaught, []);
});

test('removes a pending session ID after a malformed handshake', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());

    await sendMalformedUpgrade(fixture.gatewayUrl, sessionId);
    const client = await connect(fixture.gatewayUrl, sessionId);
    client.close();
    await waitForClose(client);
});

test('shutting down takes precedence over duplicate session rejection', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const internals = fixture.gateway as unknown as {
        shuttingDown: boolean;
        pendingSessions: Map<string, unknown>;
        handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
    };
    internals.shuttingDown = true;
    internals.pendingSessions.set(sessionId, { clientSocket: { destroyed: true }, upstream: { terminate() {} } });
    let response = '';
    const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
            response += chunk.toString();
            callback();
        },
    });

    internals.handleUpgrade(
        { headers: { 'x-pwd-session-id': sessionId } } as unknown as IncomingMessage,
        socket,
        Buffer.alloc(0),
    );

    assert.match(response, /^HTTP\/1\.1 503 /);
});

test('emits sessionOpen once for each accepted session', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const opened: string[] = [];
    fixture.gateway.on('sessionOpen', id => opened.push(id));

    assert.equal(await refusedStatus(fixture.gatewayUrl, 'not-a-uuid'), 400);
    const first = await connect(fixture.gatewayUrl, sessionId);
    assert.equal(await refusedStatus(fixture.gatewayUrl, sessionId), 409);
    const second = await connect(fixture.gatewayUrl, secondSessionId);
    await waitFor(() => opened.length === 2);

    assert.deepEqual(opened, [sessionId, secondSessionId]);
    first.terminate();
    second.terminate();
});

test('a replaced browser endpoint keeps its sessions until they close', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const oldEndpoint = fixture.browserEndpoint;
    const newEndpoint = `${oldEndpoint}/replacement`;
    const oldClient = await connect(fixture.gatewayUrl, sessionId);
    await fixture.nextUpstreamRequest();

    fixture.gateway.setBrowserEndpoint(newEndpoint);
    const newClient = await connect(fixture.gatewayUrl, secondSessionId);
    t.after(() => newClient.terminate());
    assert.equal((await fixture.nextUpstreamRequest()).url, '/replacement');

    let oldIdle = false;
    const oldIdlePromise = fixture.gateway.whenEndpointIdle(oldEndpoint).then(() => {
        oldIdle = true;
    });
    const oldEcho = nextMessage(oldClient);
    oldClient.send('still served');
    assert.deepEqual(await oldEcho, { data: Buffer.from('still served'), isBinary: false });
    assert.equal(oldIdle, false);

    oldClient.close(1000, 'done');
    await bounded(oldIdlePromise, 500);
    assert.deepEqual(fixture.gateway.activeSessionIds, [secondSessionId]);

    let newIdle = false;
    void fixture.gateway.whenEndpointIdle(newEndpoint).then(() => {
        newIdle = true;
    });
    await delay(20);
    assert.equal(newIdle, false);
});

test('an endpoint is not idle while a dial to it is still connecting', async t => {
    const fixture = await createFixture(100);
    t.after(() => fixture.close());
    const oldEndpoint = fixture.browserEndpoint;
    const dialing = connect(fixture.gatewayUrl, sessionId);
    await fixture.nextUpstreamRequest();

    fixture.gateway.setBrowserEndpoint(`${oldEndpoint}/replacement`);
    let oldIdle = false;
    const oldIdlePromise = fixture.gateway.whenEndpointIdle(oldEndpoint).then(() => {
        oldIdle = true;
    });
    const client = await dialing;
    assert.equal(oldIdle, false);

    client.close();
    await bounded(oldIdlePromise, 500);
});

test('closing the sessions of an endpoint leaves other endpoints open', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const oldEndpoint = fixture.browserEndpoint;
    const oldClient = await connect(fixture.gatewayUrl, sessionId);
    fixture.gateway.setBrowserEndpoint(`${oldEndpoint}/replacement`);
    const newClient = await connect(fixture.gatewayUrl, secondSessionId);
    t.after(() => newClient.terminate());
    await waitFor(() => fixture.gateway.activeConnectionCount === 2);
    const oldClosed = waitForClose(oldClient);

    fixture.gateway.closeEndpointSessions(oldEndpoint, 1001, 'worker is recycling');

    const close = await bounded(oldClosed, 500);
    assert.equal(close.code, 1001);
    assert.equal(close.reason.toString(), 'worker is recycling');
    await bounded(fixture.gateway.whenEndpointIdle(oldEndpoint), 500);
    assert.deepEqual(fixture.gateway.activeSessionIds, [secondSessionId]);
    const newEcho = nextMessage(newClient);
    newClient.send('new browser');
    assert.deepEqual(await newEcho, { data: Buffer.from('new browser'), isBinary: false });
});

async function createFixture(upstreamHandshakeDelayMs = 0): Promise<{
    gateway: SessionGateway;
    gatewayUrl: string;
    browserEndpoint: string;
    nextUpstreamRequest: () => Promise<IncomingMessage>;
    nextUpstreamSocket: () => Promise<WebSocket>;
    nextUpstreamMessage: () => Promise<{ data: Buffer; isBinary: boolean }>;
    close: () => Promise<void>;
}> {
    const browserServer = http.createServer();
    const browser = new WebSocketServer({ noServer: true });
    browserServer.on('upgrade', (request, socket, head) => {
        setTimeout(() => browser.handleUpgrade(request, socket, head, client => {
            browser.emit('connection', client, request);
        }), upstreamHandshakeDelayMs);
    });
    await listen(browserServer);
    const browserAddress = browserServer.address();
    if (!browserAddress || typeof browserAddress === 'string') {
        throw new Error('fake browser did not use a TCP port');
    }

    const requests: IncomingMessage[] = [];
    const requestWaiters: Array<(request: IncomingMessage) => void> = [];
    const sockets: WebSocket[] = [];
    const socketWaiters: Array<(socket: WebSocket) => void> = [];
    const messages: Array<{ data: Buffer; isBinary: boolean }> = [];
    const messageWaiters: Array<(message: { data: Buffer; isBinary: boolean }) => void> = [];
    browser.on('connection', (socket, request) => {
        const requestWaiter = requestWaiters.shift();
        if (requestWaiter) {
            requestWaiter(request);
        } else {
            requests.push(request);
        }
        const socketWaiter = socketWaiters.shift();
        if (socketWaiter) {
            socketWaiter(socket);
        } else {
            sockets.push(socket);
        }
        socket.on('message', (data, isBinary) => {
            const message = { data: Buffer.from(data as Buffer), isBinary };
            const waiter = messageWaiters.shift();
            if (waiter) {
                waiter(message);
            } else {
                messages.push(message);
            }
            socket.send(data, { binary: isBinary });
        });
    });

    const browserEndpoint = `ws://127.0.0.1:${browserAddress.port}`;
    const gateway = new SessionGateway(browserEndpoint, 0, '127.0.0.1');
    await gateway.start();

    let closePromise: Promise<void> | null = null;
    return {
        gateway,
        gatewayUrl: `ws://127.0.0.1:${gateway.listeningPort}`,
        browserEndpoint,
        nextUpstreamRequest: () => {
            const request = requests.shift();
            return request ? Promise.resolve(request) : new Promise(resolve => requestWaiters.push(resolve));
        },
        nextUpstreamSocket: () => {
            const socket = sockets.shift();
            return socket ? Promise.resolve(socket) : new Promise(resolve => socketWaiters.push(resolve));
        },
        nextUpstreamMessage: () => {
            const message = messages.shift();
            return message ? Promise.resolve(message) : new Promise(resolve => messageWaiters.push(resolve));
        },
        close: () => {
            closePromise ??= (async () => {
                await gateway.shutdown();
                for (const socket of browser.clients) {
                    socket.terminate();
                }
                await new Promise<void>(resolve => browser.close(() => resolve()));
                await new Promise<void>(resolve => browserServer.close(() => resolve()));
            })();
            return closePromise;
        },
    };
}

function connect(url: string, id: string, headers: Record<string, string> = {}): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, {
            headers: { ...headers, 'x-pwd-session-id': id },
        });
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

function refusedStatus(url: string, id?: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, {
            headers: id ? { 'x-pwd-session-id': id } : {},
        });
        socket.once('unexpected-response', (_request, response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        socket.once('open', () => reject(new Error('WebSocket upgrade was accepted')));
        socket.on('error', () => undefined);
    });
}

function nextMessage(socket: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
    return new Promise((resolve, reject) => {
        socket.once('message', (data, isBinary) => resolve({ data: Buffer.from(data as Buffer), isBinary }));
        socket.once('error', reject);
    });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: Buffer }> {
    if (socket.readyState === WebSocket.CLOSED) {
        return Promise.resolve({ code: 1006, reason: Buffer.alloc(0) });
    }
    return new Promise(resolve => {
        socket.once('close', (code, reason) => resolve({ code, reason }));
    });
}

function listen(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function resetRejectedUpgrade(url: string): Promise<void> {
    const parsed = new URL(url);
    const socket = net.createConnection(Number(parsed.port), parsed.hostname);
    socket.on('error', () => undefined);
    await new Promise<void>(resolve => socket.once('connect', resolve));
    socket.write(
        'GET / HTTP/1.1\r\n' +
        `Host: ${parsed.host}\r\n` +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'x-pwd-session-id: invalid\r\n\r\n',
    );
    await delay(1);
    socket.resetAndDestroy();
}

async function sendMalformedUpgrade(url: string, id: string): Promise<void> {
    const parsed = new URL(url);
    const socket = net.createConnection(Number(parsed.port), parsed.hostname);
    socket.on('error', () => undefined);
    await new Promise<void>(resolve => socket.once('connect', resolve));
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    const response = new Promise<void>(resolve => {
        socket.once('data', () => resolve());
        socket.once('close', () => resolve());
    });
    socket.write(
        'GET / HTTP/1.1\r\n' +
        `Host: ${parsed.host}\r\n` +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        'Sec-WebSocket-Key: invalid\r\n' +
        `x-pwd-session-id: ${id}\r\n\r\n`,
    );
    await bounded(response, 500);
    socket.destroy();
    await closed;
}

function delay(delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
        operation,
        delay(timeoutMs).then((): never => {
            throw new Error(`operation did not finish within ${timeoutMs}ms`);
        }),
    ]);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error('condition was not met before timeout');
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
