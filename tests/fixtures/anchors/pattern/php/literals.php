<?php
$a = <<<EOT
// @implements x#FR-001
# @implements x#FR-001
EOT;
$b = <<<'EOT'
/* @implements x#FR-001 */
EOT;
$c = "# @implements x#FR-001 {$a["k"]}";
$d = '// @implements x#FR-001';
