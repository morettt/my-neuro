'use strict';

const http = require('http');

const port = Number(process.env.NEKO_USER_PLUGIN_SERVER_PORT || 48916);
const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/health')) {
        const body = JSON.stringify({ status: 'ok', time: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
    }
    if (url.startsWith('/plugins')) {
        const body = JSON.stringify({ plugins: [], message: 'stub' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
    }
    res.writeHead(404);
    res.end();
});
server.listen(port, '127.0.0.1');
