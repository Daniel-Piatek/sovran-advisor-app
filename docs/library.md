---
title: Library
paths: ^/library$
---
The Library is the app's design library: every colour, font, size and piece the screens are built from, on one page.

## How you use it

- Look here to see how the app looks and why. Switch Light / Dark at the bottom to see both.
- When you ask Claude to change how your app looks, it reads this page first, so every screen stays the same style.

## How it works

Every colour, font and spacing is a named value in `public/tokens.css`; the pieces are styled in `public/style.css`. This page, `public/library.js`, draws them with the app's own classes, so what you see here is what the screens use. The style follows the Live Sovran Visual Identity Guide.
