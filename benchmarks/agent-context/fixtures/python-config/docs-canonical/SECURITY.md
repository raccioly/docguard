# Security

## Configuration files

`load_config` may read relative JSON paths beneath its configured base directory.
It rejects absolute paths, traversal, symlink escapes, files larger than 64 KiB,
invalid JSON, and roots other than JSON objects.
