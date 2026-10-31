import { defineConfig } from 'vite';

/**
 * Netlify Functions Development Plugin for Vite.
 * Intercepts requests to /api/* and /.netlify/functions/* during `npm run dev`
 * and executes the local serverless function handler directly in-process.
 * Eliminates "Cannot GET /.netlify/functions/campus-ai" during local development.
 */
function netlifyFunctionsDevPlugin() {
  return {
    name: 'netlify-functions-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const host = req.headers.host || 'localhost:5173';
        const parsedUrl = new URL(req.url, `http://${host}`);
        const isFunctionPath =
          parsedUrl.pathname.startsWith('/api') ||
          parsedUrl.pathname.startsWith('/.netlify/functions');

        if (!isFunctionPath) {
          return next();
        }

        try {
          // Dynamic import of Netlify Function
          const funcModule = await import('./netlify/functions/campus-ai.mjs');
          const handler = funcModule.default || funcModule.handler;

          if (typeof handler !== 'function') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Function handler not found.' }));
            return;
          }

          // Read body stream if present
          let bodyStr = '';
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            bodyStr = Buffer.concat(chunks).toString('utf8');
          }

          const fullUrl = `http://${host}${req.url}`;
          const webReq = new Request(fullUrl, {
            method: req.method,
            headers: req.headers,
            body: bodyStr && req.method !== 'GET' && req.method !== 'HEAD' ? bodyStr : undefined
          });

          const webRes = await handler(webReq, {});

          res.statusCode = webRes.status;
          webRes.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });

          const responseText = await webRes.text();
          res.end(responseText);
        } catch (err) {
          console.error('[vite-netlify-functions-dev] Error invoking function:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: 'Dev function middleware error: ' + (err.message || String(err))
          }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [netlifyFunctionsDevPlugin()],
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022'
  }
});
