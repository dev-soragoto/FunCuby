import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
// noinspection JSUnresolvedReference
const port = Number(process.env.PORT || 5173),
    host = process.env.HOST || "127.0.0.1";
const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
};
const notFound = (res) => {
    res.writeHead(404);
    res.end("Not found");
};
const server = http.createServer(async (req, res) => {
    try {
        if (!["GET", "HEAD"].includes(req.method)) {
            res.writeHead(405);
            res.end();
            return;
        }
        const path = decodeURIComponent(
            new URL(req.url, "http://localhost").pathname,
        );
        const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
        if (
            !file.startsWith(root + sep) ||
            path.includes("\\") ||
            path.split("/").some((s) => s.startsWith("."))
        ) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (!(await stat(file)).isFile()) {
            notFound(res);
            return;
        }
        res.writeHead(200, {
            "Content-Type": types[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            "Permissions-Policy": "bluetooth=(self), screen-wake-lock=(self)",
        });
        res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch {
        notFound(res);
    }
});
// noinspection HttpUrlsUsage
server.listen(port, host, () => console.log(`FunCuby: http://${host}:${port}`));
