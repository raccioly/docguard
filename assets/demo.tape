# VHS tape for DocGuard demo GIF.
# Run with: vhs assets/demo.tape
# Output:   assets/demo.gif

Output assets/demo.gif

Set FontSize 14
Set Width 1400
Set Height 900
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0
Set Padding 20
Set Shell "bash"

# Prepend the local wrapper to PATH so the GIF shows `docguard demo`
# (what users type after `npm i -g docguard-cli`) but runs this checkout's CLI.
# Resolved from $PWD at record time and hidden from the frame, so any clone
# reproduces this tape. Record from the repository root: `vhs assets/demo.tape`.
Hide
Type `export PATH="$PWD/assets/bin:$PATH"`
Enter
Type "clear"
Enter
Show

Sleep 500ms

Type "docguard demo"
Sleep 800ms
Enter

# The demo command finishes in ~1s; this gives viewers time to read the output.
Sleep 18s
