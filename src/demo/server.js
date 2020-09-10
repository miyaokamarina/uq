const http = require('http');

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();

        return;
    }

    if (Math.random() > 0.33) {
        req.destroy();
        res.writeHead(500);
        res.end();
    } else {
        res.writeHead(Math.random() > 1 / 3 ? 200 : 500);
        res.end();
    }
});

server.listen(12310);
