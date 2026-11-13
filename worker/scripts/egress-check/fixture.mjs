import http from 'node:http';

const name = process.env.FIXTURE_NAME ?? 'fixture';

http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture');
    if (url.pathname === '/redirect') {
        response.writeHead(302, { location: url.searchParams.get('to') ?? '/' }).end();
        return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><title>${name}</title><p>fixture-${name}-content</p>`);
}).listen(80);
