// Answers /supported like an x402 facilitator so merchant quotes carry a payment
// option. The swarm pays directly (--x402-every 0), so nothing is ever settled here.
import { createServer } from 'node:http';
const feePayer = process.argv[2];
createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/supported')) {
    return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', extra: { feePayer } }], extensions: [], signers: {} }));
  }
  res.statusCode = 404;
  res.end('{}');
}).listen(Number(process.argv[3] ?? 4099), '127.0.0.1');
