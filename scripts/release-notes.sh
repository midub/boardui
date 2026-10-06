#!/usr/bin/env bash
# Prints the body of the GitHub release for a version: what boardui is, the demo link, how to
# install the CLI from the release archives, and the version's section of CHANGELOG.md (which
# must exist). The release workflow (.github/workflows/release.yml) uses it.
#
# Usage: scripts/release-notes.sh 1.0.0
set -euo pipefail
version=${1:?usage: release-notes.sh <version>}
root=$(cd "$(dirname "$0")/.." && pwd)
url=https://github.com/midub/boardui/releases/download/v$version

changes=$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 || index($0, "## " v " ") == 1 || $0 == "## " v { p = 1; next }
  p && (/^## / || /^\[[^]]+\]: /) { exit }
  p { print }
' "$root/CHANGELOG.md")
if [[ -z "${changes//[[:space:]]/}" ]]; then
  echo "CHANGELOG.md has no section for $version" >&2
  exit 1
fi

cat <<EOF
**boardui** shows printed circuit boards in 3D. It converts IPC-2581 files into glTF boards that carry components, pins and nets as metadata, and \`<board-viewer>\`, a three.js web component, displays them with hover, selection, net highlighting and HTML widgets.

**Demo: <https://midub.github.io/boardui/>.** Drop an IPC-2581 file: it is converted in your browser (WebAssembly), nothing is uploaded.

## Install the command-line tool

Download the archive for your platform, check it against \`SHA256SUMS\`, and put \`boardui\` on your \`PATH\`:

| Platform | Archive |
|---|---|
| Linux x86_64 (static) | [\`boardui-$version-x86_64-unknown-linux-musl.tar.gz\`]($url/boardui-$version-x86_64-unknown-linux-musl.tar.gz) |
| Linux ARM64 (static) | [\`boardui-$version-aarch64-unknown-linux-musl.tar.gz\`]($url/boardui-$version-aarch64-unknown-linux-musl.tar.gz) |
| macOS Apple silicon | [\`boardui-$version-aarch64-apple-darwin.tar.gz\`]($url/boardui-$version-aarch64-apple-darwin.tar.gz) |
| macOS Intel | [\`boardui-$version-x86_64-apple-darwin.tar.gz\`]($url/boardui-$version-x86_64-apple-darwin.tar.gz) |
| Windows x86_64 | [\`boardui-$version-x86_64-pc-windows-msvc.zip\`]($url/boardui-$version-x86_64-pc-windows-msvc.zip) |

\`\`\`sh
curl -LO $url/boardui-$version-x86_64-unknown-linux-musl.tar.gz
curl -LO $url/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf boardui-$version-x86_64-unknown-linux-musl.tar.gz
sudo install boardui-$version-x86_64-unknown-linux-musl/boardui /usr/local/bin/

boardui convert board.xml -o board.glb    # IPC-2581 in, boardui GLB out
boardui validate board.glb                # check a GLB against the profile
\`\`\`

The macOS binaries are not signed: if macOS blocks a binary downloaded with a browser, run \`xattr -d com.apple.quarantine boardui\`. See the [README](https://github.com/midub/boardui/blob/v$version/README.md) for usage, embedding the viewer and building from source.

## Changes in $version
$changes
EOF
