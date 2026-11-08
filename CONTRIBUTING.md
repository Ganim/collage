# Contributing

Thanks for your interest in Collage.

## Setup

```sh
npm install
npm run dev
```

## Before opening a pull request

Run the same checks as CI:

```sh
npm run build:wasm
npm run lint
npm run typecheck
npm test
npm run build
```

## Standards

- TypeScript in strict mode; avoid `any`.
- Code is formatted with Prettier (`npm run format`).
- Write a failing test first, then the code that makes it pass.
- Keep modules small, with one responsibility each.
- Architecture boundary: `src/core` and `src/packing` are pure logic. They must not import from
  `react`, `src/ui` or `src/storage`. ESLint enforces this.
- Commit messages use short conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
