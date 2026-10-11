A = """
# @implements x#FR-001
"""
B = '# @implements x#FR-001'
C = f"{A!r} # @implements x#FR-001 {'#' + B}"
D = rb'# @implements x#FR-001'
E = (
    "# @implements x#FR-001"
    '# @implements x#FR-001'
)
