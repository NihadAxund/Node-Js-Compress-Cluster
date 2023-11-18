const cluster = require('cluster');
const http = require('http');
const url = require('url');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const productsFilePath = 'products.json';

if (!fs.existsSync(productsFilePath)) {
    fs.writeFileSync(productsFilePath, '[]', 'utf-8');
    console.log('products.json created successfully.');
}

let products = [];

try {
    const data = fs.readFileSync(productsFilePath);
    products = JSON.parse(data);
} catch (err) {
    console.error('Error reading products.json:', err);
}

if (cluster.isMaster) {
    // Master process
    const numWorkers = require('os').cpus().length;
    console.log(numWorkers)

    console.log(`Master cluster setting up ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }

    cluster.on('online', (worker) => {
        console.log(`Worker ${worker.process.pid} is online`);
    });

    cluster.on('exit', (worker, code, signal) => {
        console.error(`Worker ${worker.process.pid} died with code: ${code}, and signal: ${signal}`);
        console.log('Starting a new worker');
        cluster.fork();
    });
} else {
    // Worker process
    const server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        //compress
        const compressResponse = (data) => {
            const acceptEncoding = req.headers['accept-encoding'];
            if (acceptEncoding && acceptEncoding.includes('gzip')) {
                res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/json' });
                zlib.gzip(data, (err, buffer) => {
                    if (err) throw err;
                    res.end(buffer);
                });
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
            }
        };

        // (GET)
        if (pathname === '/products' && req.method === 'GET') {
            const responseData = JSON.stringify(products);
            compressResponse(responseData);
        }

        // (POST)
        else if (pathname === '/products' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                const newProduct = JSON.parse(body);
                newProduct.id = uuidv4();
                products.push(newProduct);

                fs.writeFile('products.json', JSON.stringify(products), (err) => {
                    if (err) throw err;
                    const responseData = JSON.stringify({ message: 'Product added successfully', product: newProduct });
                    compressResponse(responseData);
                });
            });
        }

        // (DELETE)
        else if (pathname === '/products' && req.method === 'DELETE') {
            const index = parseInt(parsedUrl.query.index);
            if (!isNaN(index) && index >= 0 && index < products.length) {
                const deletedProduct = products.splice(index, 1)[0];

                fs.writeFile('products.json', JSON.stringify(products), (err) => {
                    if (err) throw err;
                    const responseData = JSON.stringify({ message: 'Product deleted successfully', product: deletedProduct });
                    compressResponse(responseData);
                });
            } else {
                const responseData = JSON.stringify({ error: 'Invalid index' });
                compressResponse(responseData);
            }
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            const responseData = JSON.stringify({ error: 'Not Found' });
            compressResponse(responseData);
        }
    });

    const PORT = 3000;
    server.listen(PORT, () => {
        console.log(`Worker ${process.pid} is listening at http://localhost:${PORT}`);
    });
}
