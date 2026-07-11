# MkDocs documentation site PRD

This document describes the documentation site requirements for this repository.

## Purpose

The documentation site must give maintainers and users a stable place to understand the project. The repository README is still the front door on GitHub, but the documentation site can hold longer explanations without making the repository root noisy.

## Structure

The site uses MkDocs. Source files live under `docs-site/docs`. English pages live under `docs-site/docs/en/`. Chinese pages live under `docs-site/docs/zh/`.

Each topic needs both languages. Chinese filenames use `.zh.md`. English filenames do not use an `en` suffix.

## Navigation

Every page must be listed in `docs-site/mkdocs.yml`. If a file is not in the navigation, readers are unlikely to find it.

The top navigation must include a GitHub link. This lets readers move from the documentation site back to the source code.

## Reuse

Existing Markdown should be linked into `docs-site/docs` with symlinks when possible. The root README files and module README files are reused this way. This keeps one source of truth for common project explanations.

## Expected result

A maintainer should be able to run MkDocs from `docs-site/`, build the site, and see English and Chinese pages for the project overview, specification, JavaScript layer, Rust engine, and process documents.
