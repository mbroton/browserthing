import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, connect, createServer, isIP, type Socket } from 'node:net';
import { pipeline } from 'node:stream';
import type { BrowserServer } from 'playwright-core';

const blockedSubnets: Array<[string, number, 'ipv4' | 'ipv6']> = [
    ['0.0.0.0', 8, 'ipv4'],
    ['10.0.0.0', 8, 'ipv4'],
    ['100.64.0.0', 10, 'ipv4'],
    ['127.0.0.0', 8, 'ipv4'],
    ['169.254.0.0', 16, 'ipv4'],
    ['172.16.0.0', 12, 'ipv4'],
    ['192.0.0.0', 24, 'ipv4'],
    ['192.0.2.0', 24, 'ipv4'],
    ['192.88.99.0', 24, 'ipv4'],
    ['192.168.0.0', 16, 'ipv4'],
    ['198.18.0.0', 15, 'ipv4'],
    ['198.51.100.0', 24, 'ipv4'],
    ['203.0.113.0', 24, 'ipv4'],
    ['224.0.0.0', 4, 'ipv4'],
    ['240.0.0.0', 4, 'ipv4'],
    ['::', 96, 'ipv6'],
    ['64:ff9b:1::', 48, 'ipv6'],
    ['100::', 64, 'ipv6'],
    ['2001::', 32, 'ipv6'],
    ['2001:db8::', 32, 'ipv6'],
    ['2002::', 16, 'ipv6'],
    ['fc00::', 7, 'ipv6'],
    ['fe80::', 10, 'ipv6'],
    ['fec0::', 10, 'ipv6'],
    ['ff00::', 8, 'ipv6'],
];

const blockList = new BlockList();
for (const [network, prefix, family] of blockedSubnets) {
    blockList.addSubnet(network, prefix, family);
}

const nat64Prefix = new BlockList();
nat64Prefix.addSubnet('64:ff9b::', 96, 'ipv6');

/**
 * Chromium sends WebRTC UDP directly, not through a SOCKS proxy. This
 * policy makes WebRTC use only connections that go through the proxy.
 */
export const egressGuardChromiumArgs = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];

/**
 * Returns true for loopback, private, link-local, shared (CGNAT), multicast,
 * and reserved addresses. IPv4-mapped (::ffff:a.b.c.d) and NAT64
 * (64:ff9b::a.b.c.d) forms use the rule of the embedded IPv4 address.
 * A value that is not an IP address is blocked.
 */
export function isBlockedAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) {
        return blockList.check(address, 'ipv4');
    }
    if (family === 6) {
        if (blockList.check(address, 'ipv6')) {
            return true;
        }
        if (nat64Prefix.check(address, 'ipv6')) {
            return isBlockedAddress(nat64EmbeddedIPv4(address));
        }
        return false;
    }
    return true;
}

function nat64EmbeddedIPv4(address: string): string {
    const groups = address.split(':');
    const last = groups[groups.length - 1]!;
    if (last.includes('.')) {
        return last;
    }
    const high = Number.parseInt(groups[groups.length - 2] || '0', 16);
    const low = Number.parseInt(last || '0', 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

export interface BlockedConnection {
    host: string;
    port: number;
    addresses: string[];
}

export interface EgressGuardOptions {
    isBlocked?: (address: string) => boolean;
    lookup?: typeof dnsLookup;
    onBlocked?: (connection: BlockedConnection) => void;
}

export interface EgressGuard {
    readonly port: number;
    close(): Promise<void>;
}

const reply = {
    succeeded: 0x00,
    generalFailure: 0x01,
    notAllowed: 0x02,
    networkUnreachable: 0x03,
    hostUnreachable: 0x04,
    connectionRefused: 0x05,
    ttlExpired: 0x06,
    commandNotSupported: 0x07,
    addressTypeNotSupported: 0x08,
} as const;

class BlockedTargetError extends Error {
    constructor(readonly addresses: string[]) {
        super('target address is not allowed');
    }
}

interface ConnectRequest {
    host: string;
    port: number;
    length: number;
}

/**
 * Starts a SOCKS5 server on 127.0.0.1 that accepts only CONNECT. It resolves
 * each target itself, refuses blocked addresses with "connection not allowed
 * by ruleset", and connects only to the addresses that it checked.
 */
export async function startEgressGuard(options: EgressGuardOptions = {}): Promise<EgressGuard> {
    const isBlocked = options.isBlocked ?? isBlockedAddress;
    const lookup = options.lookup ?? dnsLookup;
    const sockets = new Set<Socket>();

    const guardedLookup = (
        hostname: string,
        lookupOptions: LookupOptions,
        callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ): void => {
        lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
            if (error) {
                callback(error, []);
                return;
            }
            const allowed = addresses.filter(entry => !isBlocked(entry.address));
            if (allowed.length === 0) {
                callback(new BlockedTargetError(addresses.map(entry => entry.address)), []);
            } else if (lookupOptions.all) {
                callback(null, allowed);
            } else {
                callback(null, allowed[0]!.address, allowed[0]!.family);
            }
        });
    };

    const relay = (client: Socket, request: ConnectRequest, rest: Buffer): void => {
        const refuse = (code: number): void => {
            client.end(replyPacket(code));
        };
        if (isIP(request.host) && isBlocked(request.host)) {
            options.onBlocked?.({ host: request.host, port: request.port, addresses: [request.host] });
            refuse(reply.notAllowed);
            return;
        }
        const upstream = connect({ host: request.host, port: request.port, lookup: guardedLookup, noDelay: true });
        sockets.add(upstream);
        upstream.once('close', () => sockets.delete(upstream));
        client.once('close', () => upstream.destroy());
        upstream.once('error', error => {
            if (error instanceof BlockedTargetError) {
                options.onBlocked?.({ host: request.host, port: request.port, addresses: error.addresses });
            }
            refuse(errorReply(error));
        });
        upstream.once('connect', () => {
            upstream.removeAllListeners('error');
            client.write(replyPacket(reply.succeeded));
            if (rest.length > 0) {
                upstream.write(rest);
            }
            pipeline(client, upstream, () => undefined);
            pipeline(upstream, client, () => undefined);
        });
    };

    const server = createServer(client => {
        sockets.add(client);
        client.once('close', () => sockets.delete(client));
        client.on('error', () => client.destroy());
        client.setNoDelay(true);
        let buffer = Buffer.alloc(0);
        let greeted = false;

        const onData = (chunk: Buffer): void => {
            buffer = Buffer.concat([buffer, chunk]);
            if (!greeted) {
                if (buffer.length < 2) {
                    return;
                }
                const methodCount = buffer[1]!;
                if (buffer[0] !== 0x05) {
                    client.destroy();
                    return;
                }
                if (buffer.length < 2 + methodCount) {
                    return;
                }
                if (!buffer.subarray(2, 2 + methodCount).includes(0x00)) {
                    client.end(Buffer.from([0x05, 0xff]));
                    return;
                }
                client.write(Buffer.from([0x05, 0x00]));
                buffer = buffer.subarray(2 + methodCount);
                greeted = true;
            }
            const parsed = parseRequest(buffer);
            if (parsed === null) {
                return;
            }
            client.off('data', onData);
            client.pause();
            if (typeof parsed === 'number') {
                client.end(replyPacket(parsed));
                return;
            }
            relay(client, parsed, buffer.subarray(parsed.length));
        };
        client.on('data', onData);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    if (address === null || typeof address === 'string') {
        server.close();
        throw new Error('egress guard has no TCP address');
    }

    return {
        port: address.port,
        close: () => new Promise<void>(resolve => {
            server.close(() => resolve());
            for (const socket of sockets) {
                socket.destroy();
            }
        }),
    };
}

function parseRequest(buffer: Buffer): ConnectRequest | number | null {
    if (buffer.length < 4) {
        return null;
    }
    if (buffer[0] !== 0x05) {
        return reply.generalFailure;
    }
    const command = buffer[1];
    const addressType = buffer[3];
    let host: string;
    let offset: number;
    if (addressType === 0x01) {
        if (buffer.length < 10) {
            return null;
        }
        host = Array.from(buffer.subarray(4, 8)).join('.');
        offset = 8;
    } else if (addressType === 0x03) {
        if (buffer.length < 5) {
            return null;
        }
        const length = buffer[4]!;
        if (buffer.length < 5 + length + 2) {
            return null;
        }
        host = buffer.subarray(5, 5 + length).toString('utf8');
        offset = 5 + length;
    } else if (addressType === 0x04) {
        if (buffer.length < 22) {
            return null;
        }
        const groups: string[] = [];
        for (let index = 4; index < 20; index += 2) {
            groups.push(buffer.readUInt16BE(index).toString(16));
        }
        host = groups.join(':');
        offset = 20;
    } else {
        return reply.addressTypeNotSupported;
    }
    if (command !== 0x01) {
        return reply.commandNotSupported;
    }
    return { host, port: buffer.readUInt16BE(offset), length: offset + 2 };
}

function replyPacket(code: number): Buffer {
    return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

function errorReply(error: NodeJS.ErrnoException): number {
    if (error instanceof BlockedTargetError) {
        return reply.notAllowed;
    }
    switch (error.code) {
        case 'ECONNREFUSED':
            return reply.connectionRefused;
        case 'ENETUNREACH':
            return reply.networkUnreachable;
        case 'EHOSTUNREACH':
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return reply.hostUnreachable;
        case 'ETIMEDOUT':
            return reply.ttlExpired;
        default:
            return reply.generalFailure;
    }
}

export interface EgressGuardLaunchOptions {
    proxy: { server: string };
    args: string[];
}

/**
 * Launches a browser server whose traffic goes through a new egress guard.
 * The guard closes when the browser server closes.
 */
export async function launchWithEgressGuard<Server extends BrowserServer>(
    launch: (guardOptions: EgressGuardLaunchOptions) => Promise<Server>,
    options: EgressGuardOptions = {},
): Promise<Server> {
    const guard = await startEgressGuard(options);
    try {
        const server = await launch({
            proxy: { server: `socks5://127.0.0.1:${guard.port}` },
            args: egressGuardChromiumArgs,
        });
        server.once('close', () => void guard.close());
        return server;
    } catch (error) {
        await guard.close();
        throw error;
    }
}
