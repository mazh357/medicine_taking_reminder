---
title: "长期用药管理 APP｜Phase 0 技术 Spike 方案"
version: "v0.1"
status: "待执行；Gate B 技术证据规格"
updated: "2026-08-23"
owner: "React Native/Expo 跨平台负责人 + Android 平台负责人"
inputs:
  - "../product/长期用药管理APP_MVP_离线版_v0.1.md"
  - "./离线MVP总体技术架构_v0.2.md"
---

# Phase 0 技术 Spike 方案

> 本文只规定技术原型的验证方法，不创建正式业务工程，也不使用真实患者数据。产品范围以离线 MVP 为准。Spike 结果必须能被另一名工程师在同类设备上复现。

## 1. Gate 目标与边界

Phase 0 必须证明以下能力在 Android 真机上可用或能安全降级：Expo Development Build、SQLCipher、SecureStore/Android Keystore、`expo-camera`、AES-256-GCM 媒体、`expo-notifications`、精确闹钟能力检测、截屏控制、Android Auto Backup 排除、随包 TFLite 推理和零运行时联网。

不允许：真实处方/照片、远程 API、推送服务、远程日志/崩溃上报、OCR、大模型、照护者、奖励、语音、自动快门或医疗建议。测试图片只能使用无个人信息的合成几何物体或经授权的公开测试图。

### 1.1 统一结果定义

| 结果 | 判定 |
| --- | --- |
| 通过 | 达到硬门槛且证据完整，可进入正式实现 |
| 降级通过 | 平台能力不可用，但自动进入本文指定降级，人工主链无损且用户可见原因 |
| 失败 | 数据可能明文/损坏、主链被阻断、降级未触发、结果不可复现或证据缺失 |

任一安全硬门槛失败，Gate B 不通过。仅性能型视觉失败可降级为“关闭视觉、保留拍照与人工确认”。提醒精度失败可降级为近似提醒，但必须能检测能力并持续显示健康告警。

### 1.2 强制目标设备

| 代号 | Android/API | 硬件档位 | 用途 |
| --- | --- | --- | --- |
| D-L | Android 8/9，API 26–28 | arm64、3 GB RAM、低端 CPU | 最低版本和性能下限候选 |
| D-M | Android 11，API 30 | 4–6 GB RAM | Android 12 前备份规则和常见设备 |
| D-N | Android 14，API 34 | 6 GB+ RAM | 通知、精确闹钟默认拒绝和现代系统 |
| D-C | 当前最新稳定 Android，API 以执行时记录 | 8 GB+ RAM、Google 参考或近原生设备 | 当前平台回归 |

四类都必须是真机；模拟器仅可补充故障注入。记录厂商、型号、SoC、RAM、Android 构建号、API、剩余存储、电池优化状态。若任一原生依赖无法支持 D-L，结果不是静默抬高最低版本：提交依赖错误证据，由技术负责人冻结新的最低 API。

### 1.3 统一证据包

每个 Spike 目录使用 `Sxx/<device-code>/<run-id>/`，至少包含：

- `environment.json`：设备、OS、APK SHA-256、Expo/RN/依赖精确版本、Git commit、模型 SHA-256。
- `procedure.md`：逐步操作、预期、实际、操作者和 UTC/本地时间。
- `metrics.csv`：单次样本及汇总，禁止只保留平均值。
- `screens/`：不含健康信息的截图或外拍视频；敏感页截屏测试用另一设备外拍。
- `logs.txt`：脱敏后的应用/系统日志；不得出现密钥、文件明文或完整本机路径。
- `artifacts.sha256`：证据文件完整性清单。
- `result.json`：`pass | degraded | fail`、失败项、复现步骤和关联 ADR。

性能指标至少预热 5 次、正式测量 30 次，报告 P50/P95/max；通知长测至少 30 个触发点。计时使用单调时钟，墙上时间只用于展示。

## 2. Spike 清单

## S00｜Development Build、原生模块和构建可复现性

**关联 ADR：** [ADR-001](../decisions/ADR-001.md)、[ADR-002](../decisions/ADR-002.md)、[ADR-011](../decisions/ADR-011.md)

**目标设备：** D-L、D-N；D-C 复核安装。

**步骤：**

1. 用锁定版本建立一次性最小 Expo 原型，加入 SQLCipher、SecureStore、Camera、Notifications、ScreenCapture、自定义媒体加密模块和原生 `VisionInferenceModule`（Google LiteRT/TFLite Android runtime）。
2. 以 `npx expo run:android --device` 或受控的 Development Build 构建；证明 Expo Go 无法作为验收载体。
3. 清理构建缓存后重复构建；记录 APK SHA-256、原生依赖清单和配置插件生成差异。
4. 修改一个原生配置并确认必须重新构建；JS-only 修改只用于开发迭代。
5. 另建嵌入 JS bundle 的 release-like 内部包供零网络和性能测试，禁用开发菜单。

**测量：** 两次洁净构建成功率、APK/依赖清单差异、四类设备安装启动结果、原生模块自检结果。

**通过：** 所有指定模块在 D-L/D-N 可调用；两次构建的依赖和配置一致；release-like 包完全使用内嵌代码与资产。**降级：** D-L 因已证明的依赖最低 API 不支持，可提出抬高最低 API，但 Gate B 前须获得 ADR 修订签署。**失败：** 需要 Expo Go、运行时下载原生能力或构建无法复现。

**证据：** 统一证据包，加 `resolved-dependencies.txt`、原生 manifest/config diff 和 APK 分析报告。

## S01｜expo-sqlite + SQLCipher

**关联 ADR：** [ADR-003](../decisions/ADR-003.md)、[ADR-004](../decisions/ADR-004.md)

**目标设备：** D-L、D-M、D-N。

**步骤：**

1. 使用 `expo-sqlite` 配置插件启用 `useSQLCipher: true`，prebuild 后核对产物。
2. SecureStore 生成并保存随机 256-bit 数据库密钥；打开数据库后立即设置 `PRAGMA key`，再创建哨兵表。
3. 关闭/重启/升级测试包后读取；用错误密钥和缺失密钥分别打开。
4. 开启 WAL 与外键；执行 10,000 条写入、独占事务回滚和进程强杀恢复。
5. 导出数据库、WAL、SHM 的原始字节，搜索 `SQLite format 3` 和哨兵明文。

**测量：** 打开 P95、10,000 条事务耗时、恢复结果、原始文件明文扫描、错误密钥行为。

**通过：** 正确密钥可重启读取；错误/缺失密钥稳定失败且不建明文新库；数据库/WAL/SHM 无哨兵明文；强杀后满足全有或全无；D-L 打开 P95≤500 ms。**降级：** 打开 P95 介于 500–1000 ms 可进入性能优化但不得进入患者研究。**失败：** 任一明文、静默清库、部分提交或错误密钥可读取。

**证据：** 原始文件 SHA-256、脱敏十六进制抽样、SQLCipher 版本/编译选项、崩溃注入录像与结果库快照。

## S02｜SecureStore、Keystore、应用锁和密钥失效

**关联 ADR：** [ADR-004](../decisions/ADR-004.md)、[ADR-005](../decisions/ADR-005.md)

**目标设备：** D-L、D-N、D-C，均设置设备凭据；D-N 另测试生物识别变更。

**步骤：**

1. 在 SecureStore 创建数据库密钥；由原生媒体模块在 Android Keystore 创建不可导出的媒体主密钥，SecureStore 只保存媒体密钥别名/版本，不保存媒体密钥原文或业务事实。
2. 验证重启、应用更新、锁屏、设备凭据回退和可选 `requireAuthentication` 行为。
3. 新增/删除生物识别后读取；记录是否不可访问，确认进入恢复说明而非清库。
4. 卸载重装并尝试读取残留密文；执行全部清除并检查密钥、库和媒体均不可恢复。
5. 检查自定义备份规则仍排除 SecureStore 条目。

**测量：** 密钥读取 P95、各生命周期结果、认证取消/失败错误码、清除后残留和日志泄漏。

**通过：** 更新后可读；认证失败不删除数据；生物识别变化/卸载行为与产品说明一致；全部清除后无法恢复；日志不出现密钥。**降级：** 设备无合格生物识别时使用设备凭据或关闭可选应用锁，数据库/媒体加密仍必须有效。**失败：** 自动生成新密钥覆盖旧密文、密钥进入备份/日志或认证失败触发清库。

**证据：** 生命周期矩阵、外拍录像、备份清单、脱敏异常栈和清除前后文件清单。

## S03｜Camera → AES-GCM 加密媒体流水线

**关联 ADR：** [ADR-005](../decisions/ADR-005.md)、[ADR-006](../decisions/ADR-006.md)、[ADR-014](../decisions/ADR-014.md)

**目标设备：** 全部四类设备；每台后摄像头 30 张。

**步骤：**

1. 等待 `onCameraReady` 后手动调用拍照；不请求相册权限。
2. 从 Expo 相机缓存 URI 流式读取，经原生模块以 AES-256-GCM 加密至应用私有最终文件；每文件使用唯一 96-bit nonce，文件头携带格式版本，路径使用随机 ID。
3. 只有密文落盘并 `fsync`/原子改名成功后才删除缓存明文并返回“已保存”。
4. 在读取、加密、改名、删明文四个阶段强杀；重启清理孤儿临时文件。
5. 篡改密文、nonce、tag、文件头分别解密；删除原图和缩略图并保留无路径/密钥材料的墓碑。
6. 模拟低存储、相机拒权和加密异常，验证跳过原因仍可走人工主链。
7. 枚举 Expo 原生模块的全部 JS 可调用方法并执行负面测试：不得返回媒体主密钥、数据密钥、照片 Base64/字节、可逆像素缓冲或明文路径，不得接受任意 alias/路径。

**测量：** 从快门返回到密文确认的 P50/P95/max、峰值内存、明文存活时间、nonce 重复数、篡改拒绝率、孤儿文件数。

**通过：** D-L 1280px 长边测试图加密落盘 P95≤1 s；30 张无 nonce 重复；所有篡改 100% 拒绝；恢复后无明文/可解密缩略图；JS bridge 无密钥/明文媒体导出接口；失败不进入 `prepared`。**降级：** 高分辨率不达标时固定降低采集分辨率并重测；相机不可用允许 `skipped_with_reason`。**失败：** 明文残留、重复 nonce、篡改可解密、未落盘却显示成功，或 JS 可取得密钥/明文媒体。

**证据：** 性能 CSV、文件生命周期跟踪、密文抽样与 SHA-256、篡改用例、强杀录像、删除后存储扫描。

## S04｜本地通知、精确闹钟与可重建投影

**关联 ADR：** [ADR-007](../decisions/ADR-007.md)

**目标设备：** D-M、D-N、D-C；至少一台厂商重度省电设备可替代 D-M。

**步骤：**

1. 用 `expo-notifications` 创建中性通知渠道和一次性日期触发；只在 payload 传 opaque occurrence ID。
2. 原生能力端口调用 `AlarmManager.canScheduleExactAlarms()`，并提供系统“闹钟和提醒”设置入口；分别测试允许、拒绝、撤销。
3. 对允许状态调度 30 个短期触发；对拒绝状态启用近似通知并持续显示健康告警。
4. 验证通知权限拒绝、重启、时区变化、手动改时、Doze、省电、进程划走和强制停止。
5. 每次前台、方案变化、重启/时区事件后，从数据库意图对比系统计划并重建；不取消其他应用通知。

**测量：** 请求时间与实际展示时间差、缺失率、重建耗时、重复通知数、能力状态检测时延。

**通过：** 精确能力允许时 30 次无缺失且 P95 误差≤60 s；拒绝/撤销能在下一次前台自检发现并切换近似模式；重建后无重复且数据库意图与系统投影一致。**降级：** 精确能力不可用但近似通知可调度、告警可见、测试提醒可用。**失败：** 权限异常崩溃、声称精确却未检测、恢复后重复/串任务或以通知送达作为服药事实。

**证据：** 计划/实际 CSV、`dumpsys alarm/notification` 脱敏快照、权限状态录像、重建前后投影清单。

## S05｜敏感页截屏、录屏与最近任务预览

**关联 ADR：** [ADR-005](../decisions/ADR-005.md)

**目标设备：** D-L、D-N、D-C。

**步骤：**

1. 为合成处方、药物详情、照片页面启用 `expo-screen-capture`/Android `FLAG_SECURE`。
2. 分别尝试系统截图、系统录屏、第三方投屏和最近任务预览。
3. 打开全局放开开关并确认风险提示后复测；关闭后立即恢复保护。
4. 快速切路由、退后台、旋转屏幕，确认保护不闪烁泄露。

**测量：** 4 类捕获路径阻断率、路由切换泄露帧、设置切换正确率。

**通过：** 默认敏感页 100% 阻断或显示空白，最近任务无内容；显式放开后仅当前全局偏好生效且可恢复。**降级：** 某 OEM 无法完全阻止第三方外拍不视为软件失败，但必须记录残余风险。**失败：** 默认可截图/录屏、后台预览泄露或普通页面被永久误锁。

**证据：** 第二台设备外拍录像、捕获文件、页面/设置矩阵和系统版本。

## S06｜随包 TFLite/LiteRT 推理与关闭开关

**关联 ADR：** [ADR-009](../decisions/ADR-009.md)、[ADR-010](../decisions/ADR-010.md)

**目标设备：** 全部四类设备。

**步骤：**

1. 通过原生 `VisionInferenceModule` 将一个固定、无医疗用途的测试 `.tflite` 模型和签名 manifest 随包分发；Metro 仅把 `.tflite` 作为本地资产。
2. 在原生侧完成受控解密、预处理和 LiteRT 推理，只向 JS 返回计数、状态、原因码、manifest 版本和耗时；校验模型/manifest SHA-256、输入形状/类型、预处理版本和输出有限值；CPU 为唯一首轮后端。
3. 飞行模式冷启动并推理 30 次；记录耗时、内存和崩溃。
4. 测试 manifest 篡改、模型缺失、形状错误、输出 NaN、超时和设备不支持，均映射 `unable`。
5. 打开构建/本地故障开关完全禁用模型，验证拍照、逐药确认和库存示例主链不依赖模型。

**测量：** 加载时间、推理 P50/P95/max、额外峰值内存、崩溃率、错误映射率、飞行模式网络请求数。

**通过：** CPU 推理 P95≤3 s；30 次零崩溃；所有无效输入 100% 返回 `unable`；JS 无照片明文/可逆像素缓冲；模型关闭时人工主链通过。**降级：** 任一目标设备超时、内存压力、兼容失败或安全边界无法满足时关闭该设备视觉能力，不降低人工功能。**失败：** 运行时下载模型、明文媒体进入 JS、模型结果自动确认/扣库存、错误导致照片或人工流程中断。

**证据：** 模型 manifest/SHA-256、输入输出黄金向量、性能 CSV、内存轨迹、错误注入结果和离线抓包。

## S07｜Auto Backup 排除、零运行时联网与远程更新关闭

**关联 ADR：** [ADR-011](../decisions/ADR-011.md)、[ADR-012](../decisions/ADR-012.md)、[ADR-013](../decisions/ADR-013.md)

**目标设备：** D-M（Android 11 及以下规则）、D-N/D-C（Android 12+ 规则）。

**步骤：**

1. 在 app config 显式设置 `updates.enabled=false`；从最终 APK/配置证明只加载内嵌 bundle/assets。
2. 同时配置 `fullBackupContent` 和 `dataExtractionRules`，排除 database、WAL/SHM、files 下媒体/导出、SecureStore shared preferences、研究事件和诊断日志；`allowBackup=false` 作为 P0 防御性总开关是否生效亦须记录。
3. 填入合成哨兵，执行 cloud/D2D 可用的备份恢复测试；重装后确认哨兵未恢复。
4. 对 release-like 包在首次启动、建档、拍照、提醒、模型、研究包预览/导出和全部清除全程抓包；扫描依赖的网络权限、端点和动态代码加载。

**测量：** 备份包命中敏感路径数、恢复哨兵数、DNS/TCP/HTTP 请求数、APK 中远程端点数、远程更新请求数。

**通过：** 敏感路径备份/恢复为 0；核心旅程外联为 0；远程更新为 0；系统分享仅在用户主动导出后启动。**降级：** 无法在某 OEM 执行云备份命令时，APK 规则静态验证可暂记降级，但真实患者研究前必须补真机恢复证据。**失败：** 任一敏感文件进入备份、后台外联、远程模型/阈值/代码下载。

**证据：** APK manifest/资源抽取、备份/恢复日志、文件清单、抓包摘要和静态端点扫描。

## S08｜集成故障降级与 Gate B 演练

**关联 ADR：** [ADR-003](../decisions/ADR-003.md)、[ADR-007](../decisions/ADR-007.md)、[ADR-008](../decisions/ADR-008.md)、[ADR-014](../decisions/ADR-014.md)

**目标设备：** D-L、D-N。

**步骤：** 使用合成数据依次组合：飞行模式、通知拒绝、精确闹钟拒绝、相机拒绝、模型关闭、低存储、应用强杀、数据库事务失败和密钥不可用。演练“查看任务→说明跳过→已准备→逐项人工确认→追加库存→撤销反向流水”的最小示例；密钥不可用场景只进入恢复说明，不生成明文数据。

**测量：** 主链完成率、错误提示映射、重复事实/流水数、孤儿文件数、恢复耗时。

**通过：** 除密钥不可用与数据库不可写外，所有可降级组合均能完成一次人工闭环；事务失败无部分库存；密钥不可用不泄露或清库。**降级：** 视觉、相机、提醒各自关闭按指定路径继续。**失败：** 任一模型/通知事实改写人工确认，或产生重复扣减、明文、静默丢失。

**证据：** 场景矩阵、事件/库存黄金序列、故障注入日志和录像。

## 3. Gate B 汇总规则

1. S00–S08 均有四态结果、负责人和复核人；不得用“待观察”替代结论。
2. S01、S02、S03、S05、S07 任一安全失败，Gate B=`fail`。
3. S04 允许精确闹钟降级；S06 允许整体关闭视觉；二者必须通过 S08 人工主链。
4. D-L 不支持导致最低 API 调整时，必须先修订 ADR-001 和设备矩阵，不能由开发者临场决定。
5. Gate B 只能允许正式业务编码；不能替代真实患者研究所需伦理、医学、药学、隐私和安全签署。

## 4. 官方依据（访问日期：2026-08-23）

- [Expo：Development Build introduction](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo：expo-sqlite 与 SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo：SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo：Camera](https://docs.expo.dev/versions/latest/sdk/camera/)
- [Expo：Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo：ScreenCapture](https://docs.expo.dev/versions/latest/sdk/screen-capture/)
- [Expo：App config / updates.enabled](https://docs.expo.dev/versions/latest/config/app/)
- [Android：Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Android：Cryptography](https://developer.android.com/privacy-and-security/cryptography)
- [Android：Android Keystore KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)
- [Android：FLAG_SECURE](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE)
- [Android：Auto Backup](https://developer.android.com/identity/data/autobackup)
- [NIST SP 800-38D：GCM/GMAC](https://csrc.nist.gov/pubs/sp/800/38/d/final)
- [Google AI Edge：LiteRT for Android](https://ai.google.dev/edge/litert/android/)

## 5. 统一交接摘要

```text
产出文件：docs/architecture/Phase0技术Spike方案_v0.1.md；docs/decisions/ADR-001.md—ADR-015.md
使用的基线版本：PRD v0.1、离线 MVP v0.1、总体技术架构 v0.2、治理审计 v0.1（均更新于 2026-08-23）
已冻结决策：S00—S08 的设备、步骤、指标、通过/降级/失败门槛和证据格式；ADR-001—015 的工程选择
外部证据与访问日期：仅 Expo/Android/Google AI Edge 官方文档、NIST 标准、所选推理库官方仓库；2026-08-23
发现的基线冲突：已由主智能体统一冻结为不可导出的原生 Keystore 媒体主密钥；Phase 0 仍需用运行时检测和代码审查证明媒体密钥不进入 JavaScript 内存
需要人类签署的事项：最低 Android API、密钥层级与删除声明、精确闹钟产品说明、模型性能门槛、Gate B 结论
自动检查结果：待本文档集生成后执行文件数、链接、围栏和禁用功能扫描
残余风险：OEM 通知/备份差异、SecureStore 生物识别变化导致密钥不可用、社区推理库维护风险、物理摄像泄露无法由 FLAG_SECURE 阻止
```
