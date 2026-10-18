import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in Langfuse that sits in front of the hand-built one and misbehaves on purpose: wrong
 * status codes, broken bodies, dropped connections, silence, and a cursor that never ends. It is how
 * the chaos tests check that the tool says what is wrong and how to fix it.
 */

export type Fault =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'server-error'
  | 'too-many'
  | 'html'
  | 'truncated-json'
  | 'empty-body'
  | 'wrong-shape'
  | 'reset'
  | 'silent'
  | 'endless-cursor';

export interface ChaosOptions {
  /** The address of the well-behaved server to pass good requests to. */
  upstream: string;
  fault: Fault;
  /** How many requests fail before the rest pass through. Omit to fail every request. */
  failFirst?: number;
}

export interface ChaosLangfuse {
  url: string;
  requests: number;
  close: () => Promise<void>;
}

function misbehave(fault: Fault, response: ServerResponse, request: IncomingMessage): boolean {
  switch (fault) {
    case 'unauthorized':
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"message":"Invalid credentials"}');
      return true;
    case 'forbidden':
      response
        .writeHead(403, { 'content-type': 'application/json' })
        .end('{"message":"Forbidden"}');
      return true;
    case 'not-found':
      response.writeHead(404, { 'content-type': 'text/html' }).end('<html>Not Found</html>');
      return true;
    case 'server-error':
      response.writeHead(500, { 'content-type': 'text/plain' }).end('boom');
      return true;
    case 'too-many':
      response
        .writeHead(429, { 'retry-after': '0', 'content-type': 'text/plain' })
        .end('slow down');
      return true;
    case 'html':
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<!doctype html><title>Sign in</title>');
      return true;
    case 'truncated-json':
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"id":"a"');
      return true;
    case 'empty-body':
      response.writeHead(200, { 'content-type': 'application/json' }).end('');
      return true;
    case 'wrong-shape':
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"data":"not a list","meta":7}');
      return true;
    case 'reset':
      request.socket.destroy();
      return true;
    case 'silent':
      return true;
    case 'endless-cursor':
      return false;
  }
}

export async function startChaosLangfuse(options: ChaosOptions): Promise<ChaosLangfuse> {
  const state = { requests: 0 };
  const server: Server = createServer((request, response) => {
    state.requests += 1;
    const failing = options.failFirst === undefined || state.requests <= options.failFirst;
    if (failing && misbehave(options.fault, response, request)) return;
    const url = new URL(request.url ?? '/', options.upstream);
    fetch(url, { headers: { authorization: request.headers.authorization ?? '' } })
      .then(async (upstream) => {
        let text = await upstream.text();
        if (options.fault === 'endless-cursor' && url.pathname === '/api/public/v3/scores') {
          const body = JSON.parse(text) as { meta: Record<string, unknown> };
          body.meta.cursor = 'same-cursor-forever';
          text = JSON.stringify(body);
        }
        response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(text);
      })
      .catch(() => response.writeHead(502).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
