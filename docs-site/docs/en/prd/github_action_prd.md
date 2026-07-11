# GitHub Actions documentation deployment PRD

This document describes the GitHub Actions requirements for the MkDocs documentation site.

## Purpose

The documentation site should be deployable without manual build steps. A maintainer pushes documentation changes, and GitHub Actions builds the MkDocs site and publishes the static output to GitHub Pages.

## Triggering

The workflow should run when documentation files, MkDocs configuration, dependency files, or the workflow itself change. It should also support manual runs through `workflow_dispatch`.

## Build inputs

The build uses:

```text
docs-site/mkdocs.yml
docs-site/requirements.txt
docs-site/docs/
README.md
README.zh.md
assets/js/README.md
assets/js/README.zh.md
rust-ai/README.md
rust-ai/README.zh.md
```

The README files are included because the docs site links them through symlinks.

## Build output

MkDocs writes static HTML to `docs-site/site`. GitHub Actions uploads that directory as the Pages artifact.

## Expected result

After a successful workflow run, GitHub Pages should serve the documentation site. The site should contain both English and Chinese pages, and the navigation should include a GitHub link.
