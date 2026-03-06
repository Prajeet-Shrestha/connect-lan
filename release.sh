#!/bin/bash
set -e

# ─── Colors ───────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Helpers ──────────────────────────────────────────
info()  { echo -e "${CYAN}ℹ ${NC}$1"; }
ok()    { echo -e "${GREEN}✔ ${NC}$1"; }
warn()  { echo -e "${YELLOW}⚠ ${NC}$1"; }
fail()  { echo -e "${RED}✖ ${NC}$1"; exit 1; }

# ─── Pre-flight checks ───────────────────────────────
command -v node >/dev/null  || fail "node is not installed"
command -v npm  >/dev/null  || fail "npm is not installed"
command -v gh   >/dev/null  || fail "gh (GitHub CLI) is not installed — brew install gh"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run: gh auth login"

# Ensure we're in the project root
[ -f "package.json" ] || fail "Run this script from the project root"

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  fail "Working tree is dirty. Commit or stash changes first."
fi

# ─── Current version ─────────────────────────────────
CURRENT=$(node -p "require('./package.json').version")
echo ""
echo -e "${BOLD}🔗 NearDrop Release Script${NC}"
echo -e "   Current version: ${CYAN}v${CURRENT}${NC}"
echo ""

# ─── Ask for bump type ────────────────────────────────
echo -e "${BOLD}Which version bump?${NC}"
echo "  1) patch  (bug fixes, security patches)"
echo "  2) minor  (new features, backward compatible)"
echo "  3) major  (breaking changes)"
echo ""
read -p "Enter choice [1/2/3]: " CHOICE

case "$CHOICE" in
  1) BUMP="patch" ;;
  2) BUMP="minor" ;;
  3) BUMP="major" ;;
  *) fail "Invalid choice: $CHOICE" ;;
esac

# ─── Bump version ─────────────────────────────────────
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
ok "Version bumped: ${CURRENT} → ${NEW_VERSION}"

# ─── Confirm ─────────────────────────────────────────
echo ""
echo -e "${BOLD}Will release:${NC} v${NEW_VERSION} (${BUMP})"
echo -e "${BOLD}Actions:${NC}"
echo "  • Commit version bump"
echo "  • Build for macOS, Windows, Linux (x64 + arm64)"
echo "  • Create git tag v${NEW_VERSION}"
echo "  • Push to GitHub"
echo "  • Create GitHub Release with all artifacts"
echo ""
read -p "Proceed? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  # Revert the version bump
  npm version "$CURRENT" --no-git-tag-version --allow-same-version >/dev/null
  fail "Aborted. Version reverted to ${CURRENT}."
fi

# ─── Run tests ────────────────────────────────────────
info "Running tests..."
npm test || fail "Tests failed. Fix before releasing."
ok "Tests passed"

# ─── Commit ───────────────────────────────────────────
info "Committing version bump..."
git add -A
git commit -m "release: v${NEW_VERSION}" --quiet
ok "Committed"

# ─── Build ────────────────────────────────────────────
OUT_DIR="dist-electron/v${NEW_VERSION}"
info "Building for all platforms into ${OUT_DIR}/ ..."
npx electron-builder -mwl -c.directories.output="$OUT_DIR"
ok "Build complete → ${OUT_DIR}/"

# ─── Tag ──────────────────────────────────────────────
info "Creating tag v${NEW_VERSION}..."
git tag -a "v${NEW_VERSION}" -m "v${NEW_VERSION}"
ok "Tagged"

# ─── Push ─────────────────────────────────────────────
info "Pushing to GitHub..."
git push --quiet
git push --tags --quiet
ok "Pushed"

# ─── Collect artifacts ────────────────────────────────
ARTIFACTS=()
for f in "${OUT_DIR}"/*.{dmg,exe,AppImage,deb,zip}; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done
# Add auto-update manifests and blockmaps
for f in "${OUT_DIR}"/latest*.yml; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done
for f in "${OUT_DIR}"/*.blockmap; do
  [ -f "$f" ] && ARTIFACTS+=("$f")
done

if [ ${#ARTIFACTS[@]} -eq 0 ]; then
  warn "No artifacts found to upload"
fi

# ─── Create GitHub Release ────────────────────────────
info "Creating GitHub Release..."

NOTES="## What's Changed

### Security / Fixes
- See [CHANGELOG.md](https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/blob/main/CHANGELOG.md) for details.

**Full Changelog**: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/compare/v${CURRENT}...v${NEW_VERSION}"

gh release create "v${NEW_VERSION}" \
  --title "v${NEW_VERSION}" \
  --notes "$NOTES" \
  "${ARTIFACTS[@]}"

ok "GitHub Release created"

# ─── Done ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}🎉 v${NEW_VERSION} released successfully!${NC}"
echo -e "   ${CYAN}https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/v${NEW_VERSION}${NC}"
echo ""
