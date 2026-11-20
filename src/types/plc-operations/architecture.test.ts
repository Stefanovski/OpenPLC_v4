import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

test('shared PLC operations have no provider, chat protocol, Electron IPC or concrete bridge imports', () => {
  const folders = ['src/types/plc-operations', 'src/renderer/operations', 'src/main/services/plc-operations']
  for (const folder of folders)
    for (const file of readdirSync(join(process.cwd(), folder))) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
      const source = readFileSync(join(process.cwd(), folder, file), 'utf8')
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const imports = ast.statements.flatMap((s) =>
        (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
        s.moduleSpecifier &&
        ts.isStringLiteral(s.moduleSpecifier)
          ? [s.moduleSpecifier.text]
          : [],
      )
      for (const specifier of imports)
        expect(specifier).not.toMatch(/codex|claude|openai|anthropic|electron|types\/IPC/i)
      expect(source).not.toMatch(/window\.bridge|codexDebuggerActive|account\/login|turn\/start/)
    }
})
