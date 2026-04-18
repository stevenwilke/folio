#!/bin/sh

# Xcode Cloud runs this after cloning the repo.
# Installs Node deps (needed for Expo autolinking) and runs `pod install`
# so the generated Pods/*.xcconfig files exist before Xcode builds.

set -e

echo "▶️  Installing Homebrew dependencies"
# CocoaPods is usually preinstalled on Xcode Cloud, but install via brew as a safety net.
brew install cocoapods node

echo "▶️  Installing Node dependencies"
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"
npm install --legacy-peer-deps --no-audit --no-fund

echo "▶️  Generating ios/ with expo prebuild"
# Our ios/ folder is checked in, but run prebuild --no-install to sync any
# plugin/config changes into the native project before pod install.
npx expo prebuild --platform ios --no-install

echo "▶️  Installing CocoaPods"
cd ios
pod install --repo-update

echo "✅  ci_post_clone complete"
