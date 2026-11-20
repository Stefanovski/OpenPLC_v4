Print engine adapted from Autonomy-Logic/openplc-editor, tag v4.3.0.
Original source: src/backend/shared/print and src/middleware/shared/ports/print-types.ts.
The upstream GPL-3.0 license is preserved in UPSTREAM-LICENSE.txt.
Font license and notices are preserved in fonts/OFL.txt and the font source files.
Local changes adapt type imports and legacy Eurosonic diagram semantics; local adapters are separate.

The print wizard styling, PDF canvas viewer, page setup fields and guarded PDF.js
engine polyfills are adapted from v4.3.0 frontend export-pdf-modal.tsx,
page-setup-fields/index.tsx and middleware/adapters/editor/services/pdf-export.
Local adapters preserve the legacy project/store and IPC interfaces.
