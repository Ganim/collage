# Collage

Collage is a free, open source, mobile-first web app for laying out photos on a sheet so they
print at exact physical sizes. Pick your photos, set the size each one should have on paper, and
Collage arranges them to fit the page.

It is a static site: everything runs in your browser and your photos never leave your device.

Live at https://collage.guilhermeganim.com.br/

## Running locally

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

## Scripts

| Command             | What it does                      |
| ------------------- | --------------------------------- |
| `npm run dev`       | Start the Vite dev server         |
| `npm run build`     | Type-check and build into `dist/` |
| `npm test`          | Run the unit tests (Vitest)       |
| `npm run lint`      | Lint with ESLint                  |
| `npm run typecheck` | Type-check with TypeScript        |

## Docker

```sh
docker build -t collage .
docker run --rm -p 8080:80 collage
```

The image builds the site and serves `dist/` with nginx on port 80.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
