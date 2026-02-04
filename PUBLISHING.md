# Publishing Guide

This extension is prepared for VS Code Marketplace publishing, but not published yet.

## Prerequisites
- Install vsce:
  - `npm i -g @vscode/vsce`
- Create a publisher in the Marketplace:
  - Go to Visual Studio Marketplace and create a publisher.
  - Use the same `publisher` value as in `package.json` (currently `adriantrisetiawan`).
- Create a Personal Access Token (PAT) for Marketplace publishing.

## Login
- `vsce login adriantrisetiawan`
- Paste your PAT when prompted.

## Package
- `vsce package`
- This generates a `.vsix` in the repo root.

## Publish
- `vsce publish`

## Troubleshooting
- If you change the publisher name, update `package.json`.
- If publish fails with validation errors, check `package.json`, `README.md`, and `LICENSE` are present.
