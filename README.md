# mrcsx-mobility

A private, self-hosted MCP server for public transport
and railway integration.

## Status

Version 0.1.0 — functional mock implementation.

Real public transport data is not yet available.

## Technology

- Node.js 24 LTS
- TypeScript with native type stripping
- Model Context Protocol SDK v2
- Streamable HTTP
- Zod schema validation
- Native Node.js test runner

## Development

Install dependencies:

    npm ci

Start the server:

    npm start

Start with automatic restart:

    npm run dev

Run type checking and integration tests:

    npm run check

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| GET /health | Service health check |
| /mcp | MCP Streamable HTTP |

The development server listens on 127.0.0.1:3100.

## MCP tools

### mobility_ping

Read-only connectivity check.

Accepts an optional string parameter called nonce.
Returns service metadata, the current UTC timestamp
and the unchanged nonce, or null if omitted.

## Security

The current implementation is restricted to localhost.
Authentication is not yet implemented.

Do not expose this version directly to the internet.

## Roadmap

- Docker containerization
- Reverse proxy integration
- Remote MCP connectivity
- OAuth authentication with Pocket ID
- Public transport data integration
- Production monitoring

## License

Private. Not licensed for redistribution.
