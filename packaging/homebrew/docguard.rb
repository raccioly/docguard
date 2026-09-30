# typed: false
# frozen_string_literal: true

# DocGuard Homebrew formula TEMPLATE (Node CLI, installed from the npm registry
# tarball). Cookbook followed: https://docs.brew.sh/Node-for-Formula-Authors
#
# The live formula is raccioly/homebrew-tap Formula/docguard.rb:
#   brew install raccioly/tap/docguard
#
# release.yml renders this template on every release with
# .github/scripts/homebrew-formula.mjs: it downloads the PUBLISHED tarball
# (what Homebrew will fetch), verifies it against npm's dist.integrity, sets
# `url` and `sha256`, and pushes the result to the tap with a deploy key scoped
# only to that repository (docguard.release-readiness#FR-004). The
# placeholders below are replaced; do not hand-edit a version in here.
class Docguard < Formula
  desc "Deterministic documentation-drift guard for Canonical-Driven Development"
  homepage "https://github.com/raccioly/docguard"
  url "https://registry.npmjs.org/docguard-cli/-/docguard-cli-{{VERSION}}.tgz"
  sha256 "{{SHA256}}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # `docguard --version` prints "docguard v<version>"
    assert_match version.to_s, shell_output("#{bin}/docguard --version")
  end
end
