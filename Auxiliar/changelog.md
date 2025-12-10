# Changelog

## v1.0 (Current)
- Initial backup of the current state before layout fixes.
- Issue: "Papel" and "Cores" fields are not correctly positioned (Cores is out of view).
- Action: Created `index_v1.html` and `styles_v1.css`.

## v1.1 (Planned)
- Fix: Restore missing CSS for `.bottom-panels-container`, `.details-panel`, and `.history-panel`.
- Fix: Force `flex-direction: row` on `.full-width-row` to prevent "Papel" and "Cores" from stacking vertically due to `.form-group` inheritance.
- Feature: Ensure "Papel" and "Cores" fields are displayed side-by-side in the "Detalhes da OS" panel.

## v2.0 (Planned)
- Refactor: Split "Histórico" panel into two columns (List on Left, Form on Right).
- Refactor: Remove "Observação" column from the history list table.

## v2.1 (Revert)
- Action: Reverted `index.html` and `styles.css` to the state of v2.0 backups (undoing history panel refactor) at user request.
