# Collage

Collage is a free, open source, mobile-first web app for laying out photos on a sheet so they
print at exact physical sizes. Pick your photos, set the size each one should have on paper, and
Collage arranges them to fit the page.

Everything runs in your browser: the layout and the PDF are made on your device. When you sign
in with Google, Collage also keeps a copy of your collections and their photos in a `Collage`
folder in your own Google Drive, so the same work shows up on your other devices. The sign-in
service only holds the authorization, in an encrypted cookie on your device; photos never pass
through it. See the [privacy page](https://collage.guilhermeganim.com/privacidade.html).

Live at https://collage.guilhermeganim.com/

## Your collections

Collections are saved automatically in the browser, and the app works offline after the first
visit. On an iPhone, add it to the Home Screen from Safari before you start: browsers can clear
the data of sites you have not used for a while, and the installed app keeps its own storage.

To keep a copy or move a collection to another device, use "Salvar em arquivo" in the menu. It
creates a `.collage` file with the collection and its photos, which "Abrir de um arquivo" reads
back.

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
