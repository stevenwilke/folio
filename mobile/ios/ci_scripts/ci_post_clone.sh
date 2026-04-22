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
# Pin Node to 22 (LTS). `brew install node` now pulls Node 25, which breaks
# React Native 0.81's hermes-engine.podspec: `node -p require.resolve(...)`
# returns an empty string, so react_native_path becomes "." and the podspec
# fails trying to read ./package.json. RN 0.81 officially supports Node 20/22.
brew install node@22 cocoapods
brew link --overwrite --force node@22

echo "▶️  Installing Node dependencies"
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"
npm install --legacy-peer-deps --no-audit --no-fund

echo "▶️  Installing CocoaPods"
cd ios
# CocoaPods 1.16.2 / xcodeproj 1.27.0 can't parse Xcode 26's objectVersion = 70.
# Keep the pbxproj at 60 so `pod install` succeeds. (Xcode 26 reads 60 fine.)
sed -i '' 's/objectVersion = 70;/objectVersion = 60;/' ExLibris.xcodeproj/project.pbxproj || true
pod install --repo-update

echo "✅  ci_post_clone complete"
