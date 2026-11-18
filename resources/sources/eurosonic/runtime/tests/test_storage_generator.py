import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('generate_storage', ROOT / 'generate_storage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GeneratorTests(unittest.TestCase):
    def test_scalars_pointers_arrays_and_idempotence(self):
        source = '''static const struct { void *ptr; int type; } debug_vars[] = {
    {&(RES0__MAIN.COUNTER), UDINT_ENUM},
    {&(RES0__MAIN.INPUT), INT_P_ENUM},
    {&(RES0__MAIN.VALUES.value.table[0]), INT_ENUM},
    {&(RES0__MAIN.VALUES.value.table[1]), INT_ENUM},
};
#define VAR_COUNT 4
'''
        generated = module.generate(source)
        self.assertEqual(generated, module.generate(generated))
        self.assertIn('sizeof((RES0__MAIN.VALUES).value)', generated)
        self.assertNotIn('table[0]).flags', generated)
        self.assertIn('sizeof(*(RES0__MAIN.INPUT).value)', generated)
        self.assertIn('case 2:', generated)
        self.assertNotIn('case 3:', generated)

    def test_unknown_format_fails_closed(self):
        with self.assertRaises(ValueError):
            module.generate('no catalogue')
        with self.assertRaises(ValueError):
            module.generate('debug_vars[] = {\n};\n#define VAR_COUNT 1')


if __name__ == '__main__':
    unittest.main()
