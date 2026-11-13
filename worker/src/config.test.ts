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
        browser: { type: 'chromium', headless: true, args: [] },
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
