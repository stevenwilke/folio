#!/bin/sh

# Xcode Cloud runs this after cloning the repo and before the Xcode build.
# Our ios/ directory is checked in, so we only need:
#   1. Node (so `pod install` can run Expo autolinking)
#   2. `npm install` for the JS deps that autolinking reads
#   3. `pod install` to generate Pods/Target Support Files/*.xcconfig

set -e

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_ENV_HINTS=1

echo "▶️  Installing Homebrew dependencies"
brew install node cocoapods

echo "▶️  Installing Node dependencies"
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"
npm install --legacy-peer-deps --no-audit --no-fund

echo "▶️  Installing CocoaPods"
cd ios
pod install --repo-update

echo "✅  ci_post_clone complete"
