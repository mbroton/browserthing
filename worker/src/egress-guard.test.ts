import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import test from 'node:test';
import { isBlockedAddress, startEgressGuard, type BlockedConnection, type EgressGuard } from './egress-guard.js';

const blockedAddresses = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::8.8.8.8',
    '100::1',
    '2001::1',
    '2001:db8::1',
    '2002:a00:1::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    'localhost',
    '',
];

const allowedAddresses = [
    '1.1.1.1',
    '8.8.8.8',
    '11.0.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '192.167.255.255',
    '192.169.0.1',
    '223.255.255.255',
    '::ffff:8.8.8.8',
    '64:ff9b::8.8.8.8',
    '64:ff9b::808:808',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
];

test('blocks loopback, private, link-local, shared, multicast, and reserved addresses', () => {
    for (const address of blockedAddresses) {
        assert.equal(isBlockedAddress(address), true, address);
    }
});

test('allows public addresses', () => {
    for (const address of allowedAddresses) {
        assert.equal(isBlockedAddress(address), false, address);
    }
});

test('refuses a blocked IPv4 target with the ruleset reply and does not connect', async t => {
    const target = await startEchoServer(t);
    const guard = await startGuard(t);

    const result = await socksConnect(guard.port, ipv4Target('127.0.0.1', target.port));

    assert.deepEqual(result.reply, [0x05, 0x02]);
    assert.equal(target.connections, 0);
});

test('refuses a blocked IPv6 target', async t => {
    const guard = await startGuard(t);

    const result = await socksConnect(guard.port, ipv6Target([0, 0, 0, 0, 0, 0, 0, 1], 80));

    assert.deepEqual(result.reply, [0x05, 0x02]);
});

test('refuses localhost', async t => {
    const target = await startEchoServer(t);
    const guard = await startGuard(t);

    const result = await socksConnect(guard.port, domainTarget('localhost', target.port));

    assert.deepEqual(result.reply, [0x05, 0x02]);
    assert.equal(target.connections, 0);
});

test('refuses a hostname that resolves to a private address and reports it', async t => {
    const blocked: BlockedConnection[] = [];
    const guard = await startGuard(t, {
        lookup: fixedLookup({ 'internal.example': [{ address: '10.0.0.5', family: 4 }] }),
        onBlocked: connection => blocked.push(connection),
    });

    const result = await socksConnect(guard.port, domainTarget('internal.example', 443));

    assert.deepEqual(result.reply, [0x05, 0x02]);
    assert.deepEqual(blocked, [{ host: 'internal.example', port: 443, addresses: ['10.0.0.5'] }]);
});

test('connects only to the resolved address that passed the check', async t => {
    const target = await startEchoServer(t);
    const guard = await startGuard(t, {
        isBlocked: address => address.startsWith('10.'),
        lookup: fixedLookup({
            'mixed.example': [
                { address: '10.0.0.5', family: 4 },
                { address: '127.0.0.1', family: 4 },
            ],
        }),
    });

    const result = await socksConnect(guard.port, domainTarget('mixed.example', target.port), 'ping');

    assert.deepEqual(result.reply, [0x05, 0x00]);
    assert.equal(await result.readText(4), 'ping');
    assert.equal(target.connections, 1);
});

test('relays data, including data sent with the request', async t => {
    const target = await startEchoServer(t);
    const guard = await startGuard(t, { isBlocked: () => false });

    const result = await socksConnect(guard.port, ipv4Target('127.0.0.1', target.port), 'early');

    assert.deepEqual(result.reply, [0x05, 0x00]);
    assert.equal(await result.readText(5), 'early');
    result.socket.write('late');
    assert.equal(await result.readText(4), 'late');
});

test('refuses BIND and UDP ASSOCIATE', async t => {
    const guard = await startGuard(t, { isBlocked: () => false });

    for (const command of [0x02, 0x03]) {
        const result = await socksConnect(guard.port, ipv4Target('127.0.0.1', 80, command));
        assert.deepEqual(result.reply, [0x05, 0x07], `command ${command}`);
    }
});

test('refuses clients that do not offer the no-authentication method', async t => {
    const guard = await startGuard(t);
    const socket = connect(guard.port, '127.0.0.1');
    t.after(() => socket.destroy());

    socket.write(Buffer.from([0x05, 0x01, 0x02]));

    assert.deepEqual(Array.from(await readBytes(socket, 2)), [0x05, 0xff]);
});

test('close stops open relays', async t => {
    const target = await startEchoServer(t);
    const guard = await startEgressGuard({ isBlocked: () => false });
    const result = await socksConnect(guard.port, ipv4Target('127.0.0.1', target.port));
    assert.deepEqual(result.reply, [0x05, 0x00]);
    const closed = new Promise(resolve => result.socket.once('close', resolve));

    await guard.close();

    await closed;
});

type GuardOptions = Parameters<typeof startEgressGuard>[0];

async function startGuard(t: test.TestContext, options?: GuardOptions): Promise<EgressGuard> {
    const guard = await startEgressGuard(options);
    t.after(() => guard.close());
    return guard;
}

function fixedLookup(records: Record<string, LookupAddress[]>): NonNullable<NonNullable<GuardOptions>['lookup']> {
    return ((hostname: string, _options: unknown, callback: (error: Error | null, addresses: LookupAddress[]) => void) => {
        const addresses = records[hostname];
        if (addresses) {
            callback(null, addresses);
        } else {
            callback(Object.assign(new Error(`not found: ${hostname}`), { code: 'ENOTFOUND' }), []);
        }
    }) as never;
}

interface EchoServer {
    port: number;
    connections: number;
}

async function startEchoServer(t: test.TestContext): Promise<EchoServer> {
    const sockets = new Set<Socket>();
    const state: EchoServer = { port: 0, connections: 0 };
    const server: Server = createServer(socket => {
        state.connections += 1;
        sockets.add(socket);
        socket.on('error', () => undefined);
        socket.pipe(socket);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    state.port = (server.address() as AddressInfo).port;
    t.after(() => {
        for (const socket of sockets) {
            socket.destroy();
        }
        return new Promise<void>(resolve => server.close(() => resolve()));
    });
    return state;
}

function ipv4Target(address: string, port: number, command = 0x01): Buffer {
    return Buffer.from([0x05, command, 0x00, 0x01, ...address.split('.').map(Number), port >> 8, port & 0xff]);
}

function ipv6Target(groups: number[], port: number): Buffer {
    const bytes = groups.flatMap(group => [group >> 8, group & 0xff]);
    return Buffer.from([0x05, 0x01, 0x00, 0x04, ...bytes, port >> 8, port & 0xff]);
}

function domainTarget(hostname: string, port: number): Buffer {
    const name = Buffer.from(hostname);
    return Buffer.from([0x05, 0x01, 0x00, 0x03, name.length, ...name, port >> 8, port & 0xff]);
}

interface SocksResult {
    socket: Socket;
    reply: number[];
    readText(length: number): Promise<string>;
}

async function socksConnect(port: number, request: Buffer, payload = ''): Promise<SocksResult> {
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => undefined);
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), request, Buffer.from(payload)]));
    assert.deepEqual(Array.from(await readBytes(socket, 2)), [0x05, 0x00]);
    const reply = await readBytes(socket, 10);
    return {
        socket,
        reply: Array.from(reply.subarray(0, 2)),
        readText: async length => (await readBytes(socket, length)).toString(),
    };
}

const pending = new WeakMap<Socket, Buffer>();

function readBytes(socket: Socket, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        let buffer = pending.get(socket) ?? Buffer.alloc(0);
        const finish = (): boolean => {
            if (buffer.length < length) {
                return false;
            }
            socket.off('data', onData);
            socket.off('close', onClose);
            socket.pause();
            pending.set(socket, buffer.subarray(length));
            resolve(buffer.subarray(0, length));
            return true;
        };
        const onData = (chunk: Buffer): void => {
            buffer = Buffer.concat([buffer, chunk]);
            finish();
        };
        const onClose = (): void => reject(new Error(`socket closed after ${buffer.length} of ${length} bytes`));
        if (!finish()) {
            socket.on('data', onData);
            socket.once('close', onClose);
            socket.resume();
        }
    });
}
