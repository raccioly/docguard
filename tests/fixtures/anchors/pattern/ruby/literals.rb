a = %q(# @implements x#FR-001 (nested) parens)
b = <<~EOS
  # @implements x#FR-001
EOS
c = "#{a} # @implements x#FR-001 #{"#nested"}"
d = %w[# @implements]
e = /# @implements x#FR-001/
f = :"# @implements"
