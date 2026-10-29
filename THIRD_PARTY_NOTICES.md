# Third-party sources and licenses

Original application code: MIT, see `LICENSE`. No third-party visual assets are used.

## Cortico — MIT

World template and unmodified official `extension-check.ts` / `extension-describe.ts`:

- Repository: https://github.com/Pal-AI-Lab/Cortico
- Tag: `v0.2.9`; commit: `e42d4e442fef67ee87c47f92b6294f3743485bdd`.
- Template: `templates/extension/world`; copied before implementing this extension. Original blob IDs are in `provenance/template.json`.
- Official scripts are retained under `scripts/upstream/`; local wrapper supplies their expected repository layout without changing their logic.
- Notice: `Copyright (c) 2026 Phantivia`. Full license: `licenses/Cortico-MIT.txt`.
- Framework development dependency pinned to `cortico@0.2.9`.
- Runtime observation reads the version-pinned host formats documented by `src/core/usage-log.ts`, `tool-log.ts`, `transcript.ts` and `run.ts`. The local reader and aggregator are original code, not modified host code. Image-bound reference: https://api-docs.deepseek.com/guides/vision/ (consulted 2026-10-29); only the documented conditional bound is used, without copying a calculator implementation.

## DeepSeek reference tokenizer data — MIT

- Repository: https://github.com/deepseek-ai/deepseek-recipe
- Commit: `935817c66f5d6e64838f419692545f06787e485f`.
- Files: `static/tokenizers/v41/tokenizer.json`, `static/tokenizers/v4/tokenizer.json`, corresponding README notices and tokenizer LICENSE.
- Exact source links, blob IDs and SHA-256: `provenance/tokenizers.json`.
- V4.1 reference compares upstream against `deepseek-ai/DeepSeek-V4-Flash-Vision-Exp` revision `6821d6ad3681a4b137b066b76094fa82ebd0a380`.
- V4 reference compares upstream against `deepseek-ai/DeepSeek-V4-Pro` revision `b5968e9190ef611bbf34a7229255be88a0e937c1`.
- These recipe files already change image-token mappings. Exact upstream descriptions are preserved unchanged as `assets/tokenizers/v41/UPSTREAM.md` and `assets/tokenizers/v4/UPSTREAM.md`. We have made no further modifications to the JSON files.
- Notice: `Copyright (c) 2023 DeepSeek`. Full license: `licenses/DeepSeek-MIT.txt` and `assets/tokenizers/LICENSE`.
- This is a family text-size reference, especially for Flash, not a claim of exact service-side counts. No model weights are included.

## Hugging Face tokenizers.js — Apache-2.0

- Package: `@huggingface/tokenizers@0.2.0` (offline reference tokenizer runtime).
- Repository: https://github.com/huggingface/tokenizers.js
- Full license: `licenses/HuggingFace-Apache-2.0.txt`.
- Uses the local `Tokenizer` constructor, not a Hub downloader or model loader.

Independent test fixtures were generated using Hugging Face `tokenizers@0.23.2` (Rust Node bindings, Apache-2.0) on public synthetic strings. That native reference implementation is not a runtime dependency and is not shipped in the extension package. Runtime and development dependency versions/integrity are recorded in `pnpm-lock.yaml`; their packages retain their respective licenses.

## ExcelJS official Node entry, bundled for local export — MIT

- Package: `exceljs@4.4.0`; repository: https://github.com/exceljs/exceljs/tree/v4.4.0.
- Implementation since v0.5.2: the official Node entry is bundled into `dist/xlsx-export-worker.mjs` together with its resolved dependencies. ExcelJS is a development dependency; consumers need no separately installed ExcelJS to run the worker. The old prebuilt browser distribution is not used. No browser Worker, CSP relaxation or remote script is added.
- Copyright (c) 2014-2019 Guyon Roche. Full license: `licenses/ExcelJS-MIT.txt`.
- `provenance/production-dependencies.json` inventories both the installed runtime tokenizer and actual Excel build inputs. `provenance/excel-bundle.json` records the worker SHA-256, individual input hashes and external Node built-ins. The inventory includes 75 package identities (74 bundled plus the runtime tokenizer), with upstream notices preserved in `licenses/Production-dependencies.txt`.
- JSZip is used under its MIT option. `saxes@5.0.1` omits its license file from the npm archive; the original ISC notice is retained from https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE in `licenses/saxes-5.0.1-ISC.txt`.
- UUID versions below the fix are resolved to `uuid@11.1.1` (MIT), including the actual rebuilt worker code. ExcelJS's unzipper dependency is resolved to `unzipper@0.12.5` (MIT), removing the legacy binary/buffers chain. No unclear buffers license is relabeled as MIT; that package is removed from the dependency graph and bundle.
- unzipper's optional S3 SDK import is replaced at build time by original application code in `src/excel/no-cloud.cjs` that explicitly denies cloud access. No AWS SDK or cloud capability is included. The upstream ExcelJS/unzipper source files themselves are not edited.
- The original workbook layout, history manager and sorting code are MIT application code. No third-party visual assets were added.
- Desktop CSP regression reference: https://github.com/Pal-AI-Lab/Coopanion/blob/v0.2.13/app/main.cjs (`WINDOW_CSP`). The synthetic browser test uses the same policy string, with no `unsafe-inline` or Blob-worker allowance. It uses Cortico's MIT `createPanelContext`, lifecycle and binary-result protocol directly; no Coopanion application code is modified or bundled into the extension.
