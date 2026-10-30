import sys
import types
import unittest
from unittest.mock import Mock, patch

from memory_loader import load_local_weights, memory_efficient_loading


class Weight:
    def __init__(self, shape):
        self.shape = shape

    def __deepcopy__(self, memo):
        raise AssertionError('weights must not be deep-copied')


class MemoryLoaderTests(unittest.TestCase):
    def test_checkpoint_is_mapped_and_prefixes_preserve_matching_weights(self):
        source_weight = Weight((2, 2))
        torch = types.ModuleType('torch')
        torch.load = Mock(return_value={'state_dict': {'module.weight': source_weight}})
        model = Mock()
        model.state_dict.return_value = {'weight': Weight((2, 2))}
        scopes = []
        with patch.dict(sys.modules, {'torch': torch}):
            load_local_weights('model.pt', model, scope_map=scopes)
        torch.load.assert_called_once_with('model.pt', map_location='cpu', weights_only=True, mmap=True)
        self.assertIs(model.load_state_dict.call_args.args[0]['weight'], source_weight)
        self.assertEqual(scopes, [])

    def test_excluded_missing_and_mismatched_parameters_keep_initialized_weights(self):
        original = {name: Weight((2, 2)) for name in ('excluded', 'missing', 'mismatch')}
        torch = types.ModuleType('torch')
        torch.load = Mock(return_value={'excluded': Weight((2, 2)), 'mismatch': Weight((3, 3))})
        model = Mock()
        model.state_dict.return_value = original.copy()
        with patch.dict(sys.modules, {'torch': torch}):
            load_local_weights('model.pt', model, excludes=['excluded'])
        for name, weight in original.items():
            self.assertIs(model.load_state_dict.call_args.args[0][name], weight)

    def test_funasr_loader_is_restored_even_when_model_initialization_fails(self):
        module = types.ModuleType('funasr.auto.auto_model')
        original = Mock()
        module.load_pretrained_model = original
        with patch.dict(sys.modules, {'funasr.auto.auto_model': module}):
            with self.assertRaisesRegex(RuntimeError, 'failure'):
                with memory_efficient_loading():
                    self.assertIs(module.load_pretrained_model, load_local_weights)
                    raise RuntimeError('failure')
            self.assertIs(module.load_pretrained_model, original)


if __name__ == '__main__':
    unittest.main()
