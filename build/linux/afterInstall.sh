#!/bin/bash
# Post-installation script for NearDrop .deb package

# Create /usr/bin symlink so 'neardrop' works from terminal
ln -sf /opt/NearDrop/neardrop /usr/bin/neardrop 2>/dev/null || true

# Fix /dev/shm if not mounted or has wrong permissions (required by Electron/Chromium)
if ! mount | grep -q '/dev/shm'; then
  mount -t tmpfs -o rw,nosuid,nodev,noexec,relatime,size=512M tmpfs /dev/shm 2>/dev/null || true
fi

if [ -d /dev/shm ]; then
  chmod 1777 /dev/shm 2>/dev/null || true
fi
