# Safe nested configuration

## Requirements

- **FR-001**: `load_config` in `config_loader.py` MUST accept nested relative
  JSON paths beneath `base_dir`. It MUST reject absolute paths, `..` traversal,
  symlink or resolved-path escapes, files larger than 65,536 bytes, invalid JSON,
  and decoded roots that are not objects. Existing top-level JSON behavior MUST
  remain stable.

## Verification

`tests/test_config_loader.py` covers current valid behavior. Hidden evaluation
checks nested paths and every safety boundary.
