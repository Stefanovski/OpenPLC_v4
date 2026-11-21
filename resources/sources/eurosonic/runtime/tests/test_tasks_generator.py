import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('generate_tasks', ROOT / 'generate_tasks.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def project(count=3):
    tasks = '\n'.join(f'TASK task{i}(INTERVAL := T#{10 * (i + 1)}ms, PRIORITY := {i});' for i in range(count))
    programs = '\n'.join(f'PROGRAM instance{i} WITH task{i} : MAIN;' for i in range(count))
    return f'CONFIGURATION Config0\nRESOURCE Res0 ON PLC\n{tasks}\n{programs}\nEND_RESOURCE\nEND_CONFIGURATION'


class TaskGeneratorTests(unittest.TestCase):
    def test_single_task_legacy(self):
        self.assertEqual(module.parse_tasks(project(1)), [])

    def test_two_and_three(self):
        for count in (2, 3):
            self.assertEqual(module.parse_tasks(project(count)), [(f'TASK{i}', 10 * (i + 1), i) for i in range(count)])

    def test_limit_and_invalid_assignments(self):
        for st in (project(4), project().replace('WITH task1', 'WITH unknown'),
                   project().replace('instance1', 'instance0'), project().replace(' WITH task1', ''),
                   project().replace('Res0', 'Other'), project().replace('PRIORITY := 1', 'PRIORITY := 32'),
                   project().replace('INTERVAL := T#20ms', 'SINGLE := enabled')):
            with self.subTest(st=st), self.assertRaises(ValueError):
                module.parse_tasks(st)

    def test_intervals(self):
        for duration, expected in [('T#10ms', 10), ('TIME#0.05s', 50), ('T#1s_10ms', 1010), ('T#1000us', 1), ('T#24h', 86400000)]:
            self.assertEqual(module.interval_ms(duration), expected)
        for invalid in ('T#0ms', 'T#500us', 'T#-10ms', 'T#25h', 'intervalVariable'):
            with self.assertRaises(ValueError):
                module.interval_ms(invalid)

    def test_comments_and_strings_do_not_create_tasks(self):
        self.assertEqual(module.parse_tasks("(* outer (* TASK fake(); *) inner *)\n" + project(1) + "\n// TASK fake();\n'TASK fake();'"), [])

    def test_split_preserves_bodies_and_is_idempotent(self):
        source = '''void RES0_run__(unsigned long tick) {
  TASK0 = !(tick % 1);
  TASK1 = !(tick % 5);
  if (TASK1) { SLOW_body__(&INSTANCE1); }
  if (TASK0) { FAST_body__(&INSTANCE0); }
  if (TASK0) { OTHER_body__(&INSTANCE2); }
}
'''
        tasks = [('TASK0', 10, 0), ('TASK1', 50, 1)]
        generated = module.generate(source, tasks)
        self.assertEqual(module.generate(generated, tasks), generated)
        body = generated.split('switch (index)')[1]
        self.assertIn('case 0: { FAST_body__(&INSTANCE0);  OTHER_body__(&INSTANCE2);', body)
        self.assertIn('case 1: { SLOW_body__(&INSTANCE1);', body)
        self.assertIn('task_times[index]', generated)

    def test_unknown_scheduler_is_rejected_not_silently_dropped(self):
        tasks = [('TASK0', 10, 0), ('TASK1', 50, 1)]
        for body in ('TASK0 = !(tick % 1); unexpected();',
                     'TASK0 = !(tick % 1); TASK1 = !(tick % 5); unassigned_body__();'):
            with self.assertRaises(ValueError):
                module.generate('void RES0_run__(unsigned long tick) {' + body + '}', tasks)


if __name__ == '__main__':
    unittest.main()
