#!/bin/bash
set -e

# ─── Colors & Formatting ─────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'
REVERSE='\033[7m'

# ─── Helpers ──────────────────────────────────────────
info()  { echo -e "${CYAN}ℹ ${NC}$1"; }
ok()    { echo -e "${GREEN}✔ ${NC}$1"; }
warn()  { echo -e "${YELLOW}⚠ ${NC}$1"; }
fail()  { echo -e "${RED}✖ ${NC}$1"; exit 1; }
hr()    { echo -e "${DIM}$(printf '%.0s─' {1..50})${NC}"; }

# ─── Interactive Menu (arrow keys) ────────────────────
# Usage: menu_select RESULT_VAR "Title" "option1" "option2" ...
# Stores the 0-based index into RESULT_VAR
menu_select() {
  local result_var="$1"; shift
  local title="$1"; shift
  local options=("$@")
  local count=${#options[@]}
  local selected=0

  # Hide cursor
  tput civis 2>/dev/null || true

  # Cleanup on exit
  trap 'tput cnorm 2>/dev/null || true; trap - RETURN' RETURN

  echo -e "\n${BOLD}${title}${NC}"
  echo -e "${DIM}  ↑↓ to navigate, Enter to select${NC}\n"

  # Draw initial menu
  for ((i=0; i<count; i++)); do
    if [ $i -eq $selected ]; then
      echo -e "  ${REVERSE} ${options[$i]} ${NC}"
    else
      echo -e "   ${options[$i]}"
    fi
  done

  # Read keys
  while true; do
    # Read a single character (raw mode)
    IFS= read -rsn1 key

    # Handle escape sequences (arrow keys)
    if [[ "$key" == $'\x1b' ]]; then
      read -rsn2 rest
      key+="$rest"
    fi

    case "$key" in
      $'\x1b[A' | k) # Up arrow or k
        if [ $selected -gt 0 ]; then
          ((selected--))
        fi
        ;;
      $'\x1b[B' | j) # Down arrow or j
        if [ $selected -lt $((count-1)) ]; then
          ((selected++))
        fi
        ;;
      '') # Enter
        break
        ;;
    esac

    # Redraw: move cursor up by count lines and redraw
    tput cuu "$count" 2>/dev/null || printf '\033[%dA' "$count"

    for ((i=0; i<count; i++)); do
      tput el 2>/dev/null || printf '\033[K'
      if [ $i -eq $selected ]; then
        echo -e "  ${REVERSE} ${options[$i]} ${NC}"
      else
        echo -e "   ${options[$i]}"
      fi
    done
  done

  # Show cursor
  tput cnorm 2>/dev/null || true

  eval "$result_var=$selected"
}

# ─── Interactive Multi-Select (arrow keys + space) ────
# Usage: multi_select RESULT_VAR "Title" "option1" "option2" ...
# Stores space-separated indices of selected items
multi_select() {
  local result_var="$1"; shift
  local title="$1"; shift
  local options=("$@")
  local count=${#options[@]}
  local cursor=0
  local -a checked=()

  # Initialize all as unchecked
  for ((i=0; i<count; i++)); do
    checked[$i]=0
  done

  tput civis 2>/dev/null || true
  trap 'tput cnorm 2>/dev/null || true; trap - RETURN' RETURN

  echo -e "\n${BOLD}${title}${NC}"
  echo -e "${DIM}  ↑↓ navigate, Space toggle, A select all, Enter confirm${NC}\n"

  # Draw initial menu
  for ((i=0; i<count; i++)); do
    local check=" "
    [ "${checked[$i]}" -eq 1 ] && check="${GREEN}✔${NC}"
    if [ $i -eq $cursor ]; then
      echo -e "  ${REVERSE} [${check}${REVERSE}] ${options[$i]} ${NC}"
    else
      echo -e "   [${check}] ${options[$i]}"
    fi
  done

  while true; do
    IFS= read -rsn1 key
    if [[ "$key" == $'\x1b' ]]; then
      read -rsn2 rest
      key+="$rest"
    fi

    case "$key" in
      $'\x1b[A' | k)
        [ $cursor -gt 0 ] && ((cursor--))
        ;;
      $'\x1b[B' | j)
        [ $cursor -lt $((count-1)) ] && ((cursor++))
        ;;
      ' ') # Space — toggle
        if [ "${checked[$cursor]}" -eq 0 ]; then
          checked[$cursor]=1
        else
          checked[$cursor]=0
        fi
        ;;
      a | A) # Select/deselect all
        local all_checked=1
        for ((i=0; i<count; i++)); do
          [ "${checked[$i]}" -eq 0 ] && all_checked=0 && break
        done
        local new_val=$((1 - all_checked))
        for ((i=0; i<count; i++)); do
          checked[$i]=$new_val
        done
        ;;
      '') # Enter
        break
        ;;
    esac

    tput cuu "$count" 2>/dev/null || printf '\033[%dA' "$count"
    for ((i=0; i<count; i++)); do
      tput el 2>/dev/null || printf '\033[K'
      local check=" "
      [ "${checked[$i]}" -eq 1 ] && check="${GREEN}✔${NC}"
      if [ $i -eq $cursor ]; then
        echo -e "  ${REVERSE} [${check}${REVERSE}] ${options[$i]} ${NC}"
      else
        echo -e "   [${check}] ${options[$i]}"
      fi
    done
  done

  tput cnorm 2>/dev/null || true

  local indices=""
  for ((i=0; i<count; i++)); do
    [ "${checked[$i]}" -eq 1 ] && indices+="$i "
  done
  eval "$result_var='${indices% }'"
}

# ─── Pre-flight Checks ───────────────────────────────
command -v gh   >/dev/null || fail "gh (GitHub CLI) is not installed — brew install gh"
gh auth status >/dev/null 2>&1 || fail "gh is not authenticated — run: gh auth login"
[ -f "package.json" ] || fail "Run this script from the project root"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || fail "Could not determine GitHub repo"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null) || fail "Could not read package.json version"

echo ""
echo -e "${BOLD}🔄 NearDrop Release Updater${NC}"
echo -e "   ${DIM}Repo: ${REPO}  •  Local: v${VERSION}${NC}"
hr

# ═══════════════════════════════════════════════════════
# Step 1: Select Release
# ═══════════════════════════════════════════════════════
info "Fetching releases..."

RELEASE_DATA=$(gh release list --repo "$REPO" --limit 10 --json tagName,publishedAt,isDraft --jq '.[] | "\(.tagName)|\(.publishedAt | split("T")[0])|\(if .isDraft then "draft" else "" end)"')

if [ -z "$RELEASE_DATA" ]; then
  fail "No releases found"
fi

declare -a TAGS=()
declare -a MENU_ITEMS=()

while IFS= read -r line; do
  tag=$(echo "$line" | cut -d'|' -f1)
  date=$(echo "$line" | cut -d'|' -f2)
  draft=$(echo "$line" | cut -d'|' -f3)
  TAGS+=("$tag")

  label="${tag}  ${DIM}${date}${NC}"
  [ -n "$draft" ] && label+="  ${YELLOW}(draft)${NC}"
  [ "$tag" = "v${VERSION}" ] && label+="  ${GREEN}← local${NC}"
  MENU_ITEMS+=("$label")
done <<< "$RELEASE_DATA"

menu_select RELEASE_IDX "Select release to update:" "${MENU_ITEMS[@]}"
SELECTED_TAG="${TAGS[$RELEASE_IDX]}"

echo ""
ok "Selected: ${BOLD}${SELECTED_TAG}${NC}"
hr

# ═══════════════════════════════════════════════════════
# Step 2: Show Current Assets
# ═══════════════════════════════════════════════════════
info "Current assets on ${SELECTED_TAG}:"

ASSETS=$(gh release view "$SELECTED_TAG" --repo "$REPO" --json assets --jq '.assets[] | "\(.name)|\(.size)"' 2>/dev/null || true)

if [ -n "$ASSETS" ]; then
  echo ""
  while IFS= read -r a; do
    name=$(echo "$a" | cut -d'|' -f1)
    size=$(echo "$a" | cut -d'|' -f2)
    # Convert bytes to human readable
    if [ "$size" -gt 1073741824 ] 2>/dev/null; then
      human=$(echo "scale=1; $size/1073741824" | bc 2>/dev/null || echo "${size}B")
      human="${human}G"
    elif [ "$size" -gt 1048576 ] 2>/dev/null; then
      human=$(echo "scale=1; $size/1048576" | bc 2>/dev/null || echo "${size}B")
      human="${human}M"
    else
      human="${size}B"
    fi
    echo -e "  ${DIM}•${NC} ${name}  ${DIM}(${human})${NC}"
  done <<< "$ASSETS"
else
  echo -e "  ${DIM}(no assets)${NC}"
fi

echo ""
hr

# ═══════════════════════════════════════════════════════
# Step 3: Select Platform(s) to Build
# ═══════════════════════════════════════════════════════
PLATFORM_OPTIONS=(
  "All platforms  ${DIM}(macOS + Windows + Linux)${NC}"
  "macOS only"
  "Windows only"
  "Linux only"
  "macOS + Linux"
  "macOS + Windows"
  "Windows + Linux"
  "Skip build  ${DIM}(use existing dist-electron/ files)${NC}"
)

menu_select PLAT_IDX "Select platforms to build:" "${PLATFORM_OPTIONS[@]}"

BUILD_MAC=false
BUILD_WIN=false
BUILD_LINUX=false
SKIP_BUILD=false

case "$PLAT_IDX" in
  0) BUILD_MAC=true; BUILD_WIN=true; BUILD_LINUX=true ;;
  1) BUILD_MAC=true ;;
  2) BUILD_WIN=true ;;
  3) BUILD_LINUX=true ;;
  4) BUILD_MAC=true; BUILD_LINUX=true ;;
  5) BUILD_MAC=true; BUILD_WIN=true ;;
  6) BUILD_WIN=true; BUILD_LINUX=true ;;
  7) SKIP_BUILD=true ;;
esac

BUILD_FLAGS=""
if [ "$BUILD_MAC" = true ];   then BUILD_FLAGS+="m"; fi
if [ "$BUILD_WIN" = true ];   then BUILD_FLAGS+="w"; fi
if [ "$BUILD_LINUX" = true ]; then BUILD_FLAGS+="l"; fi

echo ""
hr

# ═══════════════════════════════════════════════════════
# Step 4: Version Check
# ═══════════════════════════════════════════════════════
TAG_VERSION="${SELECTED_TAG#v}"
if [ "$TAG_VERSION" != "$VERSION" ]; then
  warn "Version mismatch: local=${VERSION}, release=${TAG_VERSION}"
  echo ""
  menu_select VMISMATCH_IDX "How to proceed?" \
    "Continue anyway  ${DIM}(files will be v${VERSION})${NC}" \
    "Abort"
  [ "$VMISMATCH_IDX" -eq 1 ] && fail "Aborted."
  echo ""
  hr
fi

# ═══════════════════════════════════════════════════════
# Step 5: Build
# ═══════════════════════════════════════════════════════
if [ "$SKIP_BUILD" = false ]; then
  PLATFORMS_DESC=""
  [ "$BUILD_MAC" = true ]   && PLATFORMS_DESC+="macOS "
  [ "$BUILD_WIN" = true ]   && PLATFORMS_DESC+="Windows "
  [ "$BUILD_LINUX" = true ] && PLATFORMS_DESC+="Linux "

  echo ""
  info "Building for ${BOLD}${PLATFORMS_DESC}${NC}..."
  echo ""

  if ! npx electron-builder -${BUILD_FLAGS}; then
    fail "Build failed!"
  fi

  echo ""
  ok "Build complete"
else
  info "Using existing files in dist-electron/"
fi

hr

# ═══════════════════════════════════════════════════════
# Step 6: Select Artifacts to Upload
# ═══════════════════════════════════════════════════════
info "Scanning dist-electron/ for artifacts..."

declare -a ALL_ARTIFACTS=()
declare -a ARTIFACT_LABELS=()

for f in dist-electron/*.{dmg,exe,AppImage,deb,zip} dist-electron/latest*.yml dist-electron/*.blockmap; do
  [ -f "$f" ] || continue
  ALL_ARTIFACTS+=("$f")
  BASENAME=$(basename "$f")
  SIZE=$(du -h "$f" | awk '{print $1}')
  ARTIFACT_LABELS+=("${BASENAME}  ${DIM}(${SIZE})${NC}")
done

if [ ${#ALL_ARTIFACTS[@]} -eq 0 ]; then
  fail "No artifacts found in dist-electron/"
fi

multi_select SELECTED_INDICES "Select files to upload:" "${ARTIFACT_LABELS[@]}"

if [ -z "$SELECTED_INDICES" ]; then
  fail "No files selected"
fi

declare -a UPLOAD_FILES=()
for idx in $SELECTED_INDICES; do
  UPLOAD_FILES+=("${ALL_ARTIFACTS[$idx]}")
done

echo ""
ok "Selected ${#UPLOAD_FILES[@]} file(s)"
hr

# ═══════════════════════════════════════════════════════
# Step 7: Confirm & Upload
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}Summary${NC}"
echo -e "  Release:  ${CYAN}${SELECTED_TAG}${NC}"
echo -e "  Files:    ${#UPLOAD_FILES[@]} artifact(s)"
echo ""
for f in "${UPLOAD_FILES[@]}"; do
  echo -e "  ${GREEN}↑${NC} $(basename "$f")"
done
echo ""

menu_select CONFIRM_IDX "Upload and replace assets?" \
  "${GREEN}Yes, proceed${NC}" \
  "${RED}No, abort${NC}"

[ "$CONFIRM_IDX" -eq 1 ] && fail "Aborted."

echo ""

# Delete old matching assets
info "Removing old assets..."
EXISTING_ASSETS=$(gh release view "$SELECTED_TAG" --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null || true)

DELETED=0
for f in "${UPLOAD_FILES[@]}"; do
  BASENAME=$(basename "$f")
  if echo "$EXISTING_ASSETS" | grep -qx "$BASENAME"; then
    gh release delete-asset "$SELECTED_TAG" "$BASENAME" --repo "$REPO" --yes 2>/dev/null && ((DELETED++)) || warn "Could not delete: $BASENAME"
  fi
done
[ $DELETED -gt 0 ] && ok "Removed ${DELETED} old asset(s)"

# Upload
info "Uploading..."
echo ""

UPLOADED=0
FAILED=0
for f in "${UPLOAD_FILES[@]}"; do
  BASENAME=$(basename "$f")
  printf "  %-50s " "$BASENAME"
  if gh release upload "$SELECTED_TAG" "$f" --repo "$REPO" --clobber 2>/dev/null; then
    echo -e "${GREEN}✔${NC}"
    ((UPLOADED++))
  else
    echo -e "${RED}✖${NC}"
    ((FAILED++))
  fi
done

echo ""
hr
echo ""

if [ $FAILED -gt 0 ]; then
  warn "${UPLOADED} uploaded, ${FAILED} failed"
else
  ok "All ${UPLOADED} artifact(s) uploaded!"
fi

echo ""
echo -e "${GREEN}${BOLD}🎉 Release ${SELECTED_TAG} updated!${NC}"
echo -e "   ${CYAN}https://github.com/${REPO}/releases/tag/${SELECTED_TAG}${NC}"
echo ""
