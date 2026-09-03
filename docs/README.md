# 本机开发与 APK 安装指南

本页保留维护者的本机环境、开发和验证说明。只想下载安装体验的读者，请先阅读[项目首页使用指南](../README.md)。

这是一个面向长期服药场景的 Android 离线个人测试版，使用 Expo + React Native + TypeScript 开发。

当前版本用于验证提醒、拍照留存、物体轮廓计数、逐药确认、库存预测、复诊/取药/检查事项、历史记录和本地加密等功能。以下功能虽已实现，仍只属于个人本地测试版；它不是医疗产品，也不适用于真实患者研究。

> **当前门禁：仍只能使用虚构数据。** App `0.3.0` 已实现同一药物 1—8 个每日提醒时段和五个主功能图标。38 个测试文件、191 项 Node 测试及 10 项 Android 原生单元测试通过；x86_64 与 ARM64 Release-like APK 已于 2026-09-02 构建并完成静态审计。本轮 API 36 页面流程、v5→v6 设备升级和 ARM64 真机运行仍待验证；授权药片图片评测、安全取证和人类签署也未完成，`realPatientDataAllowed=false`。

## 1. 已实现的功能

- 启动后直接进入“今天”，不显示重复的 Demo 声明或横幅；
- 录入药物、库存和 1—8 个每日提醒时段，每个时段独立设置时间、数量和启停状态；
- 创建今日任务和本地提醒；
- 手动拍照，或记录跳过拍照的原因；
- 在纯色背景下进行端侧物体轮廓计数；
- 逐项确认按计划服用、部分服用或未服用；
- 自动生成库存扣减、修订和撤销流水；
- 显示每种药物的库存余额、预计用尽日和下次不足日；预测条件不足时显示原因，不猜测日期；
- 为每种药物设置不提醒，或提前 3、7、14、30 天的补药提醒，新药默认提前 7 天；
- 新增、修改、完成或取消复诊、取药和检查事项，并设置不提前，或提前 1、3、7 天提醒；
- 按近 7 天、近 30 天或全部日期，以及药物和结果筛选已有实际事实的历史记录；
- 查看全部历史照片，逐张预览、删除或清除本机数据；
- 修改、暂停或恢复计划，校正库存；
- 切换主题和文字大小，检查相机、通知、存储及加密状态；
- 在底部导航和五个主页面标题显示“今日、用药、事项、记录、设置”功能图标；
- 使用 SQLCipher 保存结构化数据，并以 Android Keystore + AES-GCM 逐文件加密照片。
- 在设置中提供与服药链路隔离的“照片比较实验”：匿名样本、正反面版本基线、1—8 个对象计数、照片重拍/预览/删除及人工标注。外观模型未通过图片评测，当前保持 `count_only`；远程识图关闭。
- 冷启动和回到前台时执行跨天任务与提醒对账；锁屏通知使用不含药名、剂量和事项标题的中性文案；
- 用户确认清除后物理删除数据库、照片、缓存、密钥、偏好和本地通知，再自动重建空白安全运行时。

核心功能保持离线，不接入远程更新、遥测或大模型。代码、模拟器和 APK 静态检查通过不等于真机验收；在真实 v3 包升级、真机磁盘、密钥失效、备份排除、锁屏通知和照片物理删除证据完成前，仍不得录入真实个人健康数据。

## 目标版本变更与实施状态

项目已依据[个人本地测试版功能完善与交互修改说明 v0.1](governance/个人本地测试版功能完善与交互修改说明_v0.1.md)完成主体代码改造，包括 schema v4、本地加密、连续任务、库存预测、事项提醒、计划修改、历史筛选、设置扩展、照片管理和交互简化。

当前自动化与历史构建结果见[2026-08-27 功能验收记录](quality/个人本地测试版功能验收记录_2026-08-27.md)；[2026-08-25/26 高风险验收记录](quality/个人本地测试版高风险验收记录_2026-08-25.md)仅作为历史基线。旧数据升级崩溃已经完成代码修复和 API 36 同场景复验；照片 AES-GCM 随机 IV 故障也已完成修复、原生仪器测试和模拟器实拍复验。实现与模拟器通过仍不等于真实数据准入，当前还需完成 ARM 真机安全取证、真实 v3 包升级和专业负责人签署。

## 2. 项目位置

```text
D:\help_u_surivive\
├─ android-dev-shell.ps1          Android 开发环境启动脚本
├─ .toolchains\                   Android Studio、SDK、模拟器和缓存
└─ medication-adherence-app\     App 源码（本项目）
```

Gradle 依赖缓存实际保存在 `.toolchains\gradle-home`，项目启动脚本会在当前开发终端中将其临时映射为较短的 `G:\`，以避开 Windows/CMake 的 260 字符路径限制。项目临时文件和 npm 缓存分别固定到 `.toolchains\tmp` 与 `.toolchains\npm-cache`，不再主动写入 C 盘项目临时目录。

主要目录：

- `app/`：页面和路由；
- `src/`：业务逻辑、数据库和功能模块；
- `modules/`：Android 原生 Kotlin 计数模块；
- `android/`：生成后的 Android 原生工程；
- `docs/`：产品、架构、安全、测试和治理文档。

## 3. 第一次运行前的准备

本电脑的项目专用 Android 工具链已经放在 `D:\help_u_surivive\.toolchains\`，不需要再安装全局 Java 或 Android SDK。

每次开始开发前，请打开一个新的 PowerShell 窗口，然后运行：

```powershell
powershell -NoExit -ExecutionPolicy Bypass -File D:\help_u_surivive\android-dev-shell.ps1
```

脚本会完成以下工作：

1. 临时启用项目专用的 Java 17、Android SDK、ADB 和模拟器；
2. 检查硬件加速和工具链；
3. 自动进入 `D:\help_u_surivive\medication-adherence-app`。

请保留新打开的 PowerShell 窗口。脚本设置只对这个窗口有效，不会改动电脑原有的 Java 环境。

环境正常时，窗口会显示：

- Java 版本为 17；
- Android SDK 位于 `D:\help_u_surivive\.toolchains\android-sdk`；
- 可用模拟器名称为 `MedicationDemo_API_36`；
- 加速状态为可用。

## 4. 在 Android 模拟器上运行

### 方法一：命令行运行（推荐）

#### 第一步：启动模拟器

在刚才打开的项目开发窗口中运行：

```powershell
adb start-server
Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd", "MedicationDemo_API_36", "-camera-back", "webcam0"
```

第一条命令先准备 ADB 服务；第二条命令在独立窗口启动模拟器，并将模拟器后置摄像头连接到本机的 `HD Webcam`。它不会占用当前 PowerShell。模拟器窗口出现后，等待它进入 Android 桌面。第一次启动可能需要约一分钟。

检查模拟器是否已经连接：

```powershell
adb devices
```

看到类似下面的结果即可继续：

```text
List of devices attached
emulator-5554    device
```

#### 第二步：编译并运行 App

保持模拟器开启，在项目开发窗口中运行：

```powershell
npm run android
```

这条命令会编译 Android Development Build、安装到模拟器、启动本地开发服务，并打开 App。首次原生构建耗时较长，后续构建会使用缓存。

运行期间不要关闭显示开发服务日志的终端。如果 App 已安装但页面没有载入，可在项目目录重新运行：

```powershell
npm start
```

然后在终端按 `a`，或在模拟器中点击“长期用药助手”图标。

#### 第三步：体验最小闭环

建议按以下顺序测试：

1. 创建一个测试药物和用药计划；
2. 设置计划数量、库存和提醒时间；
3. 进入今日任务；
4. 拍摄模拟物体，或选择跳过并填写原因；
5. 标记“已准备”；
6. 分别确认每个药项的实际数量；
7. 查看当前剩余库存和历史记录；
8. 尝试修订、撤销、计划管理和全部数据清除。

模拟器摄像头通常使用电脑摄像头或虚拟画面，不能代替真实手机的拍照验证。请勿为测试而拍摄真实药品。

### 方法二：使用 Android Studio

打开新的 PowerShell 窗口并运行：

```powershell
powershell -NoExit -ExecutionPolicy Bypass -File D:\help_u_surivive\android-dev-shell.ps1 -StartStudio
```

Android Studio 打开后：

1. 如果没有自动载入项目，选择 **Open**；
2. 打开 `D:\help_u_surivive\medication-adherence-app\android`；
3. 等待右下角的 Gradle 同步完成；
4. 打开 **Device Manager**；
5. 找到 `MedicationDemo_API_36`，点击右侧的启动按钮；
6. 顶部运行配置选择 `app`，设备选择该模拟器；
7. 点击绿色运行按钮。

本项目使用 Development Build，因此还需在项目开发窗口中保持本地开发服务运行：

```powershell
npm start
```

## 5. 安装已经生成的 APK

### 在 API 36 模拟器安装当前 x86_64 内部包

当前推荐的模拟器验证包位于：

```text
dist\android\long-term-medication-assistant-v0.3.0-x86_64-internal.apk
```

启动 `MedicationDemo_API_36` 后安装：

```powershell
adb install -r .\dist\android\long-term-medication-assistant-v0.3.0-x86_64-internal.apk
```

该包为 76,484,010 字节，SHA-256 为 `85AE0B4F810566F568F68E37DD392196A7A23C85597604B4124B20D36D055DAD`。它内嵌 JavaScript bundle，安装后不需要运行 Metro 或 `npm start`。

### 安装 Development Build

重新构建后的调试 APK 预期位于：

```text
D:\help_u_surivive\medication-adherence-app\android\app\build\outputs\apk\debug\app-debug.apk
```

模拟器启动后，可在项目开发窗口中安装或覆盖安装：

```powershell
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

目录中的 Debug APK 可能不是当前源码构建，不能代替上述 Release-like 包进行验收。重新构建并确认安装成功后，再运行本地开发服务：

```powershell
npm start
```

然后点击模拟器中的“长期用药助手”图标。这个 APK 是 Development Build，调试时仍需要本地开发服务；它不是可公开分发的正式安装包。

### 在 ARM64 Android 手机上安装内部测试包

内部实机包只适用于 `arm64-v8a` Android 手机，继续使用内部 Debug 证书，只允许虚构数据测试。它内嵌 JavaScript bundle，安装后不需要 Metro 或 `npm start`。当前包为 71,942,956 字节，SHA-256 为 `D7D6E288D02ADFBE23A03F4E3CCDE01C9F03182FC64D8811B28329E821139C4F`；截至 2026-09-02 尚未连接真实手机，运行状态为“已构建、静态审计通过，实机待验”。

1. 在手机“设置 → 关于手机”中连续点击版本号，启用开发者选项；随后打开“USB 调试”。不同品牌的菜单名称可能略有差异。
2. 使用可传输数据的 USB 线连接电脑，在手机上接受这台电脑的调试授权。
3. 通过项目开发终端检查连接和 CPU 架构：

```powershell
adb devices
adb shell getprop ro.product.cpu.abi
```

第一条命令应将手机显示为 `device`，第二条命令应返回 `arm64-v8a`。如果显示 `unauthorized`，请解锁手机并接受授权弹窗。

4. 构建并保全 ARM64 内部包：

```powershell
npm run build:android:release:arm64
```

成功产物位于：

```text
dist\android\long-term-medication-assistant-v0.3.0-arm64-v8a-internal.apk
```

5. 安装或覆盖安装：

```powershell
adb install -r .\dist\android\long-term-medication-assistant-v0.3.0-arm64-v8a-internal.apk
```

安装成功后，可直接点击手机中的“长期用药助手”。建议先打开飞行模式，依次检查冷启动、新增虚构药物、拍照保存、逐药确认、剩余库存和事项倒计时。

如果出现 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，说明手机上同包名 App 的签名不同。不要为了绕过错误自动卸载；卸载会清除该 App 的本地数据库、照片和密钥。只有在确认手机内没有需要保留的数据后，才能由用户主动卸载旧包再重新安装。

也可以把 APK 复制到手机后点击安装；此时 Android 会要求允许对应文件管理器“安装未知应用”。测试结束后应关闭该授权。

## 6. 重新生成调试 APK

确保已经通过 `android-dev-shell.ps1` 进入项目环境，然后运行：

```powershell
Set-Location .\android
.\gradlew.bat :app:assembleDebug
Set-Location ..
```

成功后，新 APK 仍会生成在：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

## 7. 开发前检查和测试

安装或更新依赖：

```powershell
npm install
```

分别运行代码检查和 Node 端测试：

```powershell
npm run typecheck
npm run lint
npm test
npm run doctor
```

运行 Kotlin 计数模块测试：

```powershell
Set-Location .\android
.\gradlew.bat :demo-pill-counter:testDebugUnitTest
Set-Location ..
```

`npm run check` 会同时验证个人本地模式、加密门禁、TypeScript、ESLint 和自动化测试，建议作为日常完整检查。

### 安全预览和清理本地构建缓存

清理脚本默认只显示将要处理的精确路径，不会删除文件：

```powershell
npm run clean:local
npm run clean:local:deep
```

脚本只接受项目目录和 `.toolchains` 中预先列入白名单的可重建缓存，并拒绝工作区根目录、项目根目录、`android` 根目录、`node_modules` 根目录、源码、文档、脚本、`dist`、SDK、AVD、JDK、Gradle 依赖库及 npm 缓存。它还会拒绝处理目录链接或联接点。

只有在逐项核对预览结果后，才可显式执行：

```powershell
pwsh -NoProfile -File .\scripts\clean-local-caches.ps1 -Execute
```

真正删除要求 PowerShell 7 或更高版本，避免 Windows PowerShell 5 在 Android 原生长路径中途失败；旧版 PowerShell 仍可用于默认预览。

不要把盘符根目录、工作区根目录、通配符或未经解析的环境变量交给任何删除命令。

## 8. 常见问题

### 找不到 `adb`、`emulator` 或 Java 版本不是 17

原因通常是当前终端没有载入项目环境。关闭该窗口，重新运行：

```powershell
powershell -NoExit -ExecutionPolicy Bypass -File D:\help_u_surivive\android-dev-shell.ps1
```

可用下面两条命令确认路径和版本：

```powershell
where.exe adb
java -version
```

`adb` 应来自 `D:\help_u_surivive\.toolchains\android-sdk`，Java 应显示 17。

### `adb devices` 显示 `offline`

先等待模拟器完全进入桌面。如果仍然离线，依次运行：

```powershell
adb kill-server
adb start-server
adb devices
```

仍未恢复时，先关闭模拟器，再运行：

```powershell
adb start-server
Start-Process -FilePath "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList "-avd", "MedicationDemo_API_36", "-camera-back", "webcam0"
```

如果模拟器日志曾显示一次 `Unable to connect to adb daemon on port: 5037`，但随后 `adb devices` 显示为 `device`，这只是启动时序提示，可以忽略。

### 相机仍显示虚拟场景或黑屏

本机已将 `MedicationDemo_API_36` 的后置摄像头配置为 `HD Webcam (webcam0)`。修改相机后必须完全关闭并重启模拟器，App 热更新不能改变虚拟硬件。

如果重启后仍没有电脑摄像头画面：

1. 关闭正在使用摄像头的会议软件、浏览器页面或 Windows 相机应用；
2. 在 Windows“设置 → 隐私和安全性 → 相机”中允许桌面应用访问摄像头；
3. 重新运行带有 `-camera-back webcam0` 的模拟器启动命令；
4. 在 App 中允许相机权限，并确保使用后置摄像头。

### App 提示无法连接开发服务

确认项目开发窗口中正在运行：

```powershell
npm start
```

随后在开发服务终端按 `a`，或关闭并重新打开模拟器中的 App。

### 构建看起来停了很久

首次构建需要处理 Gradle、原生依赖、NDK 和 CMake，等待时间会明显长于普通网页项目。只要终端仍有新日志且没有显示 `BUILD FAILED`，通常可以继续等待。

如果错误中出现 `Filename longer than 260 characters`，请关闭当前项目开发窗口，再通过 `android-dev-shell.ps1` 打开新窗口。脚本会使用专门缩短的 `.toolchains\g` 缓存路径；已有旧 CMake 缓存时还需重新生成 `android/app/.cxx`。

### 模拟器无法启动或很卡

先检查硬件加速：

```powershell
emulator -accel-check
```

如果报告不可用，需要检查 BIOS 虚拟化和 Windows Hypervisor Platform。也可以暂时关闭其他占用大量内存的程序。

### 如何关闭模拟器

可以直接关闭模拟器窗口，或运行：

```powershell
adb emu kill
```

## 9. 当前验证状态

截至 2026-09-02：

- App 版本为 `0.3.0`，Android `versionCode=3`，加密数据库 schema 为 v6；
- 已支持同一药物 1—8 个每日提醒时段，每个时段独立设置时间、数量和状态，共享药物库存；
- 时段支持新增、修改、暂停、恢复和退役，药物支持整体暂停与恢复；
- 五个底部导航和五个主页面标题已增加对应功能图标；
- 平台配置、TypeScript、ESLint、38 个测试文件和 191 项 Node 测试通过；
- 10 项 Android 原生单元测试通过，0 失败、0 错误；
- schema v5→v6 的迁移与领域测试通过，真实设备覆盖升级仍待验证。

当前构建产物：

- x86_64 模拟器内部 APK：`dist/android/long-term-medication-assistant-v0.3.0-x86_64-internal.apk`，76,484,010 字节，SHA-256 `85AE0B4F810566F568F68E37DD392196A7A23C85597604B4124B20D36D055DAD`；
- ARM64 手机内部 APK：`dist/android/long-term-medication-assistant-v0.3.0-arm64-v8a-internal.apk`，71,942,956 字节，SHA-256 `D7D6E288D02ADFBE23A03F4E3CCDE01C9F03182FC64D8811B28329E821139C4F`；
- Development Build：仅供连接 Metro 调试，不作为 Release-like 验收包。

两个 Release-like APK 都只包含对应单一 ABI，内嵌离线 JavaScript bundle，无 debuggable 标志、无 `INTERNET`、悬浮窗和外部存储权限，`allowBackup=false`、`usesCleartextTraffic=false`、Expo Updates 关闭，APK v2 签名通过。两者仍使用内部 Android Debug 证书，不是公开发布签名。

本轮未能在 Codex 子进程中启动 ADB，因此 API 36 的多时段页面流程、图标无障碍、v5→v6 设备升级及 ARM64 真机运行仍待验。详细结果见[一日多次提醒与功能图标验收记录](quality/一日多次提醒与功能图标验收记录_2026-09-02.md)。在这些证据和人类专业签署完成前，`realPatientDataAllowed=false`。

## 10. 项目文档

- [产品需求文档](product/长期用药管理APP_PRD_v0.1.md)
- [离线版 MVP 需求文档](product/长期用药管理APP_MVP_离线版_v0.1.md)
- [离线 MVP 总体技术架构](architecture/离线MVP总体技术架构_v0.2.md)
- [项目文档与智能体配置审计](governance/项目文档与智能体配置审计_v0.1.md)
- [Gate B 正式编码准入报告](governance/Gate_B正式编码准入报告_v0.1.md)
- [Demo 开发准入与实施方案](governance/Demo开发准入与实施方案_v0.1.md)
- [个人本地测试版功能完善与交互修改说明](governance/个人本地测试版功能完善与交互修改说明_v0.1.md)
- [2026-08-27 功能验收记录](quality/个人本地测试版功能验收记录_2026-08-27.md)
- [Release 构建失败原因与修复方案](quality/Release构建失败原因与修复方案_2026-08-27.md)
- [v0.3.0 一日多次提醒与功能图标验收记录](quality/一日多次提醒与功能图标验收记录_2026-09-02.md)

## 11. 安全边界

- 不录入或拍摄真实患者、处方、病历和药品数据；
- 不把轮廓计数结果解释为药品正确、剂量正确或已经服药；
- 不提供补服、停药、换药或调整剂量建议；
- 不把当前调试 APK 提供给真实患者使用；
- 真实患者研究必须先通过 Gate B、Phase 0、伦理、隐私和医学安全审核。
