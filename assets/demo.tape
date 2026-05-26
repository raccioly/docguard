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

# Add the local wrapper to PATH so the GIF shows `docguard demo`
# (what users type after `npm i -g docguard-cli`) but runs the local CLI.
Env PATH "/Users/ricardoaccioly/.gemini/canonical-spec-kit/.claude/worktrees/zealous-ardinghelli-facf7d/assets/bin:/Users/ricardoaccioly/.nvm/versions/node/v22.22.0/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

Sleep 500ms

Type "docguard demo"
Sleep 800ms
Enter

# The demo command finishes in ~1s; this gives viewers time to read the output.
Sleep 18s
