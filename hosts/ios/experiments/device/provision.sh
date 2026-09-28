#!/usr/bin/env bash
# hosts/ios/experiments/device/provision.sh —— 为一个 bundle id 申请开发描述文件
#
# 【为什么需要】Xcode **只在构建某个工程时**才向 Apple 申请描述文件（不会因登录就预生成）。
#   真机实验走的是 `swiftc` 直编 + `codesign`（无 .xcodeproj），所以需要先「借」一个最小工程
#   把描述文件申请下来，然后 run-device.sh 复用它与其中的 entitlements。
#
# 【前置】Xcode 已登录 Apple ID（Settings → Accounts → 见 "Personal Team"）+ 设备已连接并信任
#
# 用法：bash hosts/ios/experiments/device/provision.sh [bundle-id] [team-id]
set -euo pipefail

BUNDLE_ID="${1:-dev.proteus.experiments}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$HERE/.provision-work"
DEVICE="$(xcrun devicectl list devices 2>/dev/null | grep -vE 'simulated' \
  | grep -oE '[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}' | head -1 || true)"

[ -n "$DEVICE" ] || { echo "✗ 未发现真机（先连接并信任）"; exit 2; }

TEAM="${2:-}"
if [ -z "$TEAM" ]; then
  # 从 Xcode 偏好里取 Personal Team ID（登录后才有）
  TEAM="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | grep -oE 'teamID = [A-Z0-9]+' | head -1 | awk '{print $3}')"
fi
[ -n "$TEAM" ] || { echo "✗ 取不到 Team ID——请先在 Xcode → Settings → Accounts 登录 Apple ID"; exit 2; }

echo "==> bundle id=$BUNDLE_ID · team=$TEAM · device=$DEVICE"
rm -rf "$WORK"; mkdir -p "$WORK/App/App.xcodeproj/xcshareddata/xcschemes" "$WORK/App/Sources"

cat > "$WORK/App/Sources/main.swift" <<'SWIFT'
import UIKit
@main final class D: UIResponder, UIApplicationDelegate {
  func application(_ a: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { true }
}
SWIFT

cat > "$WORK/App/App.xcodeproj/project.pbxproj" <<PBX
// !\$*UTF8*\$!
{
	archiveVersion = 1; classes = {}; objectVersion = 56; objects = {
		A1 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = main.swift; sourceTree = "<group>"; };
		A2 = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = App.app; sourceTree = BUILT_PRODUCTS_DIR; };
		A3 = {isa = PBXGroup; children = (A1); path = Sources; sourceTree = "<group>"; };
		A4 = {isa = PBXGroup; children = (A3, A5); sourceTree = "<group>"; };
		A5 = {isa = PBXGroup; children = (A2); name = Products; sourceTree = "<group>"; };
		A6 = {isa = PBXNativeTarget; buildConfigurationList = A9; buildPhases = (A7, A8); name = App; productName = App; productReference = A2; productType = "com.apple.product-type.application"; };
		A7 = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (B1); runOnlyForDeploymentPostprocessing = 0; };
		A8 = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		A9 = {isa = XCConfigurationList; buildConfigurations = (C1); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		B1 = {isa = PBXBuildFile; fileRef = A1; };
		C1 = {isa = XCBuildConfiguration; buildSettings = {
			CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = $TEAM;
			GENERATE_INFOPLIST_FILE = YES; PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;
			PRODUCT_NAME = "\$(TARGET_NAME)"; SDKROOT = iphoneos; SWIFT_VERSION = 5.0;
			IPHONEOS_DEPLOYMENT_TARGET = 15.0; TARGETED_DEVICE_FAMILY = "1,2";
		}; name = Release; };
		C2 = {isa = XCBuildConfiguration; buildSettings = { SDKROOT = iphoneos; }; name = Release; };
		C3 = {isa = XCConfigurationList; buildConfigurations = (C2); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		D1 = {isa = PBXProject; attributes = {LastUpgradeCheck = 1600;}; buildConfigurationList = C3; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = A4; productRefGroup = A5; projectDirPath = ""; projectRoot = ""; targets = (A6); };
	}; rootObject = D1;
}
PBX

cat > "$WORK/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
      <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="A6" BuildableName="App.app" BlueprintName="App" ReferencedContainer="container:App.xcodeproj"/>
    </BuildActionEntry></BuildActionEntries>
  </BuildAction>
</Scheme>
XML

echo "==> 构建以申请描述文件（--allowProvisioningDeviceRegistration 会注册设备）"
(cd "$WORK/App" && xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -destination "platform=iOS,id=$DEVICE" build 2>&1 | grep -iE "error:|Provisioning Profiles|BUILD (SUCCEEDED|FAILED)" | head -8 || true)

echo "==> 描述文件"
ls -t ~/Library/Developer/Xcode/UserData/Provisioning\\ Profiles/*.mobileprovision 2>/dev/null | head -3 | sed 's/^/    /'
echo "（run-device.sh 会自动挑选与 $BUNDLE_ID 匹配的那个）"
