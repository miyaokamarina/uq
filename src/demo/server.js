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

    const test = Math.round((Math.random() - Number.EPSILON) * 3 + 0.5);

    switch (test) {
        case 1: {
            req.destroy();
            res.writeHead(500);
            res.end();

            return;
        }
        case 2: {
            res.writeHead(500);
            res.end();

            return;
        }
        case 3: {
            res.writeHead(200);
            res.end();

            return;
        }
    }
});

server.listen(12310);
