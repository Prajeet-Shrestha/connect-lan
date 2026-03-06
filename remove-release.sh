#!/bin/bash
set -e

# ─── Colors ───────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ ${NC}$1"; }
ok()    { echo -e "${GREEN}✔ ${NC}$1"; }
fail()  { echo -e "${RED}✖ ${NC}$1"; exit 1; }

# ─── Pre-flight checks ───────────────────────────────
command -v gh >/dev/null || fail "gh (GitHub CLI) is not installed"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run: gh auth login"

# ─── List existing releases ──────────────────────────
echo ""
echo -e "${BOLD}🔗 NearDrop — Remove Release${NC}"
echo ""
echo -e "${BOLD}Existing releases:${NC}"
gh release list --limit 10
echo ""

# ─── Ask which version ───────────────────────────────
read -p "Enter version to remove (e.g. 1.0.1): " VERSION
VERSION="${VERSION#v}" # strip leading 'v' if provided
TAG="v${VERSION}"

# ─── Confirm ─────────────────────────────────────────
echo ""
echo -e "${YELLOW}⚠  This will:${NC}"
echo "  • Delete GitHub release ${TAG}"
echo "  • Delete remote tag ${TAG}"
echo "  • Delete local tag ${TAG}"
echo ""
read -p "Are you sure? [y/N]: " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || fail "Aborted."

# ─── Delete release ──────────────────────────────────
info "Deleting GitHub release ${TAG}..."
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release delete "$TAG" --yes
  ok "GitHub release deleted"
else
  echo -e "${YELLOW}  Release ${TAG} not found on GitHub (skipping)${NC}"
fi

# ─── Delete remote tag ───────────────────────────────
info "Deleting remote tag ${TAG}..."
if git ls-remote --tags origin | grep -q "refs/tags/${TAG}$"; then
  git push --delete origin "$TAG"
  ok "Remote tag deleted"
else
  echo -e "${YELLOW}  Remote tag ${TAG} not found (skipping)${NC}"
fi

# ─── Delete local tag ────────────────────────────────
info "Deleting local tag ${TAG}..."
if git tag -l | grep -q "^${TAG}$"; then
  git tag -d "$TAG"
  ok "Local tag deleted"
else
  echo -e "${YELLOW}  Local tag ${TAG} not found (skipping)${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}✔ Release ${TAG} removed!${NC}"
echo ""
