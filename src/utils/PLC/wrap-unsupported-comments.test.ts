import { wrapUnsupportedComments } from './wrap-unsupported-comments'

test.each(['(* trailing comment *)', 'Counter := 1;\n(* keep unsaved work *)', '(**)'])(
  'preserves a complete IEC comment at EOF: %s',
  (source) => {
    expect(wrapUnsupportedComments(source)).toBe(source)
    expect(wrapUnsupportedComments(wrapUnsupportedComments(source))).toBe(source)
  },
)
test.each([
  ['(* open', '(* open*)'],
  ['// trailing', '(*// trailing*)'],
  ['/* trailing */', '(*/* trailing */*)'],
  ["Value := '(* string *)';", "Value := '(* string *)';"],
  ['(* complete *)\nCounter := 1;', '(* complete *)\nCounter := 1;'],
  ['{{ // C code\nfoo(); }}', '{{ // C code\nfoo(); }}'],
])('preserves established comment/string/native-block behavior: %s', (source, expected) => {
  expect(wrapUnsupportedComments(source)).toBe(expected)
})
