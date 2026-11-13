import { chromium, type Browser } from 'playwright-core';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8080';
const wsEndpoint = process.env.WS_ENDPOINT ?? apiUrl.replace(/^http/, 'ws');
const expectation = process.env.EXPECT ?? 'blocked';

if (expectation !== 'blocked' && expectation !== 'open') {
    throw new Error('EXPECT must be blocked or open');
}

const privateMarker = 'fixture-private-site-content';
const publicMarker = 'fixture-public-site-content';
const gatewayMarker = 'WebSocket upgrade required';

interface Case {
    name: string;
    internal: boolean;
    run(browser: Browser): Promise<string>;
    reached?: (result: string) => boolean;
}

function notRefusedByGuard(result: string): boolean {
    return !result.includes('ERR_SOCKS_CONNECTION_FAILED');
}

function navigation(url: string): (browser: Browser) => Promise<string> {
    return async browser => {
        const page = await browser.newPage();
        try {
            await page.goto(url, { timeout: 15_000 });
            return await page.content();
        } finally {
            await page.close();
        }
    };
}

const cases: Case[] = [
    { name: 'loopback IP', internal: true, run: navigation('http://127.0.0.1:3131/') },
    { name: 'localhost', internal: true, run: navigation('http://localhost:3131/') },
    {
        name: 'IPv6 loopback',
        internal: true,
        run: navigation('http://[::1]:3131/'),
        reached: notRefusedByGuard,
    },
    { name: 'private IP', internal: true, run: navigation('http://10.213.0.10/') },
    { name: 'hostname that resolves to a private IP', internal: true, run: navigation('http://private-site/') },
    {
        name: 'public URL that redirects to an internal address',
        internal: true,
        run: navigation('http://public-site/redirect?to=http://private-site/'),
    },
    {
        name: 'BrowserThing server API',
        internal: true,
        run: navigation('http://server:8080/v1/workers'),
        reached: notRefusedByGuard,
    },
    {
        name: 'iframe in setContent HTML',
        internal: true,
        run: async browser => {
            const page = await browser.newPage();
            try {
                await page.setContent('<iframe src="http://private-site/"></iframe>', { timeout: 15_000 });
                const frame = page.frames().find(candidate => candidate !== page.mainFrame());
                return frame ? await frame.content() : '';
            } finally {
                await page.close();
            }
        },
    },
    {
        name: 'context.request',
        internal: true,
        run: async browser => {
            const context = await browser.newContext();
            try {
                return await (await context.request.get('http://private-site/', { timeout: 15_000 })).text();
            } finally {
                await context.close();
            }
        },
    },
    {
        name: 'route.fetch()',
        internal: true,
        run: async browser => {
            const page = await browser.newPage();
            try {
                await page.route('http://public-site/fetched', async route => {
                    try {
                        await route.fulfill({ response: await route.fetch({ url: 'http://private-site/', timeout: 15_000 }) });
                    } catch (error) {
                        await route.fulfill({ status: 502, body: String(error) });
                    }
                });
                await page.goto('http://public-site/fetched', { timeout: 15_000 });
                return await page.content();
            } finally {
                await page.close();
            }
        },
    },
    {
        name: 'WebRTC UDP candidates',
        internal: true,
        run: async browser => {
            const page = await browser.newPage();
            try {
                await page.goto('http://public-site/', { timeout: 15_000 });
                const candidates = await page.evaluate<string[]>(`(async () => {
                    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:100.128.0.10:3478' }] });
                    const found = [];
                    connection.onicecandidate = event => {
                        if (event.candidate?.candidate) {
                            found.push(event.candidate.candidate);
                        }
                    };
                    connection.createDataChannel('probe');
                    await connection.setLocalDescription(await connection.createOffer());
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    connection.close();
                    return found;
                })()`);
                return candidates.some(candidate => / udp /i.test(candidate)) ? `UDP candidate: ${candidates[0]}` : '';
            } finally {
                await page.close();
            }
        },
        reached: result => result !== '',
    },
    { name: 'public IP', internal: false, run: navigation('http://100.128.0.10/') },
    { name: 'public hostname', internal: false, run: navigation('http://public-site/') },
];

function loaded(testCase: Case, result: string): boolean {
    if (testCase.reached) {
        return testCase.reached(result);
    }
    if (!testCase.internal) {
        return result.includes(publicMarker);
    }
    return [privateMarker, gatewayMarker].some(marker => result.includes(marker));
}

interface WorkerRow {
    status: string;
    last_heartbeat: string;
    lifetime_sessions: number;
}

async function availableWorkers(): Promise<WorkerRow[]> {
    const response = await fetch(`${apiUrl}/v1/workers`);
    if (!response.ok) {
        throw new Error(`GET /v1/workers returned ${response.status}`);
    }
    return ((await response.json()) as WorkerRow[]).filter(worker => worker.status === 'available');
}

async function waitForOneWorker(ready: (worker: WorkerRow) => boolean = () => true): Promise<WorkerRow> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        const workers = await availableWorkers().catch(() => []);
        if (workers.length === 1 && ready(workers[0]!)) {
            return workers[0]!;
        }
        await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error('expected one available worker');
}

const failures: string[] = [];

async function runCases(selected: Case[], label = ''): Promise<void> {
    const browser = await chromium.connect(wsEndpoint, { timeout: 30_000 });
    try {
        for (const testCase of selected) {
            let result: string;
            try {
                result = await testCase.run(browser);
            } catch (error) {
                result = error instanceof Error ? error.message.split('\n')[0]! : String(error);
            }
            const wasLoaded = loaded(testCase, result);
            const expected = !testCase.internal || expectation === 'open';
            const verdict = wasLoaded === expected ? 'ok' : 'FAIL';
            const name = `${testCase.name}${label}`;
            console.log(`${verdict}  ${name}: ${wasLoaded ? 'reached' : 'blocked'} (${result.slice(0, 120).replace(/\s+/g, ' ')})`);
            if (wasLoaded !== expected) {
                failures.push(name);
            }
        }
    } finally {
        await browser.close();
    }
}

const before = await waitForOneWorker();
await runCases(cases);

const after = await waitForOneWorker();
if (Date.parse(after.last_heartbeat) <= Date.parse(before.last_heartbeat)) {
    failures.push('worker heartbeats');
    console.log(`FAIL  worker heartbeats: last_heartbeat did not advance (${before.last_heartbeat})`);
} else {
    console.log(`ok  worker heartbeats: ${before.last_heartbeat} -> ${after.last_heartbeat}`);
}

const budgetSession = await chromium.connect(wsEndpoint, { timeout: 30_000 });
await budgetSession.close();
await waitForOneWorker(worker => worker.lifetime_sessions === 0);
console.log('ok  worker recycled its browser');
await runCases(
    cases.filter(testCase => ['private IP', 'IPv6 loopback', 'public hostname'].includes(testCase.name)),
    ' after recycle',
);

if (failures.length > 0) {
    console.error(`${failures.length} egress checks failed: ${failures.join(', ')}`);
    process.exitCode = 1;
} else {
    console.log(`All egress checks passed (EXPECT=${expectation}).`);
}
