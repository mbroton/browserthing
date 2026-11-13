import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';
import { ZodError } from 'zod';
import { parseConfig } from './config.js';

const requiredEnvironment = {
    SERVER_URL: 'http://localhost:8080',
};

test('uses worker defaults', () => {
    const config = parseConfig(requiredEnvironment);

    assert.deepEqual(config, {
        controlPlane: { serverUrl: 'http://localhost:8080' },
        browser: { type: 'chromium', headless: true, args: [], blockPrivateNetworks: false },
        gateway: {
            port: 3131,
            privateHostname: os.hostname(),
            maxSlots: 5,
        },
        lifecycle: {
            heartbeatIntervalMs: 5_000,
            drainTimeoutMs: 300_000,
        },
        logging: { level: 'info', format: 'json' },
    });
});

test('requires SERVER_URL', () => {
    assert.throws(() => parseConfig({}), ZodError);
});

test('rejects invalid values', () => {
    assert.throws(() => parseConfig({
        SERVER_URL: 'ws://localhost:8080',
        MAX_SLOTS: '0',
        HEARTBEAT_INTERVAL: '0',
    }), (error: unknown) => {
        assert.ok(error instanceof ZodError);
        assert.ok(error.issues.some(issue => issue.path[0] === 'SERVER_URL'));
        assert.ok(error.issues.some(issue => issue.path[0] === 'MAX_SLOTS'));
        assert.ok(error.issues.some(issue => issue.path[0] === 'HEARTBEAT_INTERVAL'));
        return true;
    });
});

test('uses PRIVATE_HOSTNAME when set', () => {
    const config = parseConfig({
        ...requiredEnvironment,
        PRIVATE_HOSTNAME: 'worker-1',
    });

    assert.equal(config.gateway.privateHostname, 'worker-1');
});

test('accepts the server MAX_SLOTS limit and rejects larger values', () => {
    assert.equal(parseConfig({ ...requiredEnvironment, MAX_SLOTS: '1024' }).gateway.maxSlots, 1024);
    assert.throws(() => parseConfig({ ...requiredEnvironment, MAX_SLOTS: '1025' }), ZodError);
});

test('treats an empty WORKER_API_KEY as unset', () => {
    assert.deepEqual(
        parseConfig({ ...requiredEnvironment, WORKER_API_KEY: '' }).controlPlane,
        { serverUrl: requiredEnvironment.SERVER_URL },
    );
});

test('parses boolean strings and rejects other boolean forms', () => {
    assert.equal(parseConfig({ ...requiredEnvironment, HEADLESS: 'false' }).browser.headless, false);
    assert.equal(parseConfig({ ...requiredEnvironment, HEADLESS: 'true' }).browser.headless, true);
    assert.throws(() => parseConfig({ ...requiredEnvironment, HEADLESS: '1' }), ZodError);
});

test('parses BROWSER_ARGS as a JSON array of strings', () => {
    assert.deepEqual(
        parseConfig({
            ...requiredEnvironment,
            BROWSER_ARGS: '["--disable-blink-features=AutomationControlled", "--lang=de-DE"]',
        }).browser.args,
        ['--disable-blink-features=AutomationControlled', '--lang=de-DE'],
    );
    assert.deepEqual(parseConfig({ ...requiredEnvironment, BROWSER_ARGS: '' }).browser.args, []);
    assert.deepEqual(parseConfig({ ...requiredEnvironment, BROWSER_ARGS: '[]' }).browser.args, []);
});

test('rejects BROWSER_ARGS that is not a JSON array of strings', () => {
    for (const value of ['--lang=de-DE', '"--lang=de-DE"', '{"lang":"de-DE"}', '["--lang=de-DE", 1]', '[null]']) {
        assert.throws(() => parseConfig({ ...requiredEnvironment, BROWSER_ARGS: value }), (error: unknown) => {
            assert.ok(error instanceof ZodError);
            assert.deepEqual(error.issues.map(issue => [issue.path[0], issue.message]), [
                ['BROWSER_ARGS', 'BROWSER_ARGS must be a JSON array of strings'],
            ]);
            return true;
        }, value);
    }
});

test('refuses BROWSER_ARGS that turn off the browser sandbox', () => {
    for (const flag of [
        '--no-sandbox',
        '-no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-namespace-sandbox',
        '--disable-seccomp-filter-sandbox',
        '--disable-gpu-sandbox',
        '--no-sandbox=1',
    ]) {
        assert.throws(
            () => parseConfig({ ...requiredEnvironment, BROWSER_ARGS: JSON.stringify(['--lang=de-DE', flag]) }),
            (error: unknown) => {
                assert.ok(error instanceof ZodError);
                assert.deepEqual(error.issues.map(issue => [issue.path[0], issue.message]), [
                    ['BROWSER_ARGS', `BROWSER_ARGS must not turn off the browser sandbox: ${flag}`],
                ]);
                return true;
            },
            flag,
        );
    }
});

test('blocks private networks only when BLOCK_PRIVATE_NETWORKS is true', () => {
    assert.equal(parseConfig(requiredEnvironment).browser.blockPrivateNetworks, false);
    assert.equal(parseConfig({ ...requiredEnvironment, BLOCK_PRIVATE_NETWORKS: 'true' }).browser.blockPrivateNetworks, true);
    assert.throws(() => parseConfig({ ...requiredEnvironment, BLOCK_PRIVATE_NETWORKS: 'yes' }), ZodError);
});

test('refuses BLOCK_PRIVATE_NETWORKS for Firefox and WebKit', () => {
    for (const browser of ['firefox', 'webkit']) {
        assert.throws(() => parseConfig({
            ...requiredEnvironment,
            BROWSER_TYPE: browser,
            BLOCK_PRIVATE_NETWORKS: 'true',
        }), (error: unknown) => {
            assert.ok(error instanceof ZodError);
            assert.ok(error.issues.some(issue => issue.path[0] === 'BLOCK_PRIVATE_NETWORKS'));
            return true;
        });
    }
});

test('refuses BROWSER_ARGS that change the proxy or WebRTC policy with BLOCK_PRIVATE_NETWORKS', () => {
    for (const flag of [
        '--proxy-server=http://proxy:3128',
        '--proxy-pac-url=http://proxy/pac',
        '--proxy-bypass-list=*',
        '--proxy-auto-detect',
        '--no-proxy-server',
        '--force-webrtc-ip-handling-policy=default',
    ]) {
        const environment = { ...requiredEnvironment, BROWSER_ARGS: JSON.stringify(['--lang=de-DE', flag]) };
        assert.deepEqual(parseConfig(environment).browser.args, ['--lang=de-DE', flag]);
        assert.throws(() => parseConfig({ ...environment, BLOCK_PRIVATE_NETWORKS: 'true' }), (error: unknown) => {
            assert.ok(error instanceof ZodError);
            assert.deepEqual(error.issues.map(issue => issue.path[0]), ['BROWSER_ARGS']);
            return true;
        }, flag);
    }
    assert.deepEqual(
        parseConfig({ ...requiredEnvironment, BROWSER_ARGS: '["--lang=de-DE"]', BLOCK_PRIVATE_NETWORKS: 'true' }).browser.args,
        ['--lang=de-DE'],
    );
});
