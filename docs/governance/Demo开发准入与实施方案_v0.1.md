---
title: "长期用药管理 APP｜可安装功能 Demo 开发准入与实施方案"
version: "v0.1"
status: "待执行｜仅限虚构数据内部演示"
updated: "2026-08-24"
owner: "产品负责人 + React Native/Expo 跨平台负责人"
scope: "Android 本地 APK 内部概念演示，不适用于真实患者研究"
inputs:
  - "./Gate_B正式编码准入报告_v0.1.md"
  - "../architecture/Phase0技术Spike方案_v0.1.md"
  - "../architecture/离线MVP总体技术架构_v0.2.md"
  - "../architecture/数据字典与事件契约_v0.1.md"
  - "../design/交互流程与状态文案_v0.1.md"
---

# 可安装功能 Demo 开发准入与实施方案

## 0. 结论与文档定位

现有产品、交互、数据、架构、测试、安全和视觉文档已经足以支持一个仅使用虚构数据的 Android 可安装功能 Demo。Demo 的目标是验证核心交互闭环和演示端侧物体计数，不是临床验证、真实患者试用或正式产品发布。

> **文档关系（2026-08-24）：** 本方案继续描述当前已安装、未加密且仅限虚构数据的 APK。拟议的“长期用药助手｜个人本地测试版”目标见[个人本地测试版功能完善与交互修改说明 v0.1](个人本地测试版功能完善与交互修改说明_v0.1.md)。新说明处于待实施状态；在其加密和验收门禁完成前，不得据此向当前 APK 录入真实个人数据。

本方案是 [Gate B 正式编码准入报告](Gate_B正式编码准入报告_v0.1.md) 允许开展的低风险原型工作，不改变 Gate B 的“附条件通过”结论，也不替代 [Phase 0 技术 Spike](../architecture/Phase0技术Spike方案_v0.1.md)。正式患者业务编码、真实患者内部研究和公开测试仍须通过 Phase 0、安全硬门槛、伦理审查、知情同意、隐私评估及医学/药学文案审核。

### 0.1 Demo 冻结决策

| 项目 | 决策 |
| --- | --- |
| Demo 形式 | 可独立安装并运行的 Android APK |
| 演示对象 | 项目内部成员和受控概念演示参与者 |
| 数据范围 | 仅虚构药物、虚构处方及无个人信息的演示素材 |
| 功能范围 | 虚构建档、固定时间提醒、今日任务、拍照、总物体计数、逐药人工确认、库存流水和历史 |
| 视觉能力 | 受控纯色背景下的轮廓计数；不识别具体药物或剂量 |
| 运行方式 | 核心闭环离线运行，本地 APK 侧载 |
| 验证设备 | 一台 Android 模拟器和一台 Android 真机 |
| 数据保护 | 普通 SQLite、应用私有照片目录、一键清除；仅适用于虚构数据 |

## 1. 当前环境与开发前准备

### 1.1 当前环境检查结果

截至 2026-08-24，开发电脑已安装 Node.js `v24.15.0` 和 npm `11.12.1`，但尚未完成 Expo/React Native Android 本地开发所需的原生工具链：

- 当前仅发现 Java 8，不能作为本项目 Android 工具链的冻结依据；开发时使用 Android Studio 随附的 JBR/JDK。
- 尚未发现 Android Studio、Android SDK、Platform Tools 或 `adb`。
- 尚未配置 `ANDROID_HOME`。
- 尚未建立可运行的 Android 模拟器。
- 尚未连接并验证 Android 真机。

Node.js/npm 是否与创建时锁定的 Expo SDK 完全兼容，须通过空白 Development Build 冒烟测试确认；不能仅依据版本号判定通过。

### 1.2 必需软件

1. 安装当前稳定版 Android Studio，并使用其安装向导和 SDK Manager。
2. 安装 Android SDK Platform 35 和 36。
3. 安装 Android SDK Build Tools、Platform Tools、Command-line Tools 和 Android Emulator。
4. 安装一个 API 36、Google APIs、`x86_64` 模拟器系统镜像。
5. 创建 Pixel 7 等同规格的 API 36 模拟器。
6. 配置 `ANDROID_HOME` 指向实际 SDK 目录，并确保命令行可调用 `adb`。
7. 启用 Windows 硬件虚拟化和 Windows Hypervisor Platform；如环境不支持，记录原因并以真机优先开发，模拟器准入仍需后续关闭。

### 1.3 必需实物与素材

- 一台可开启开发者选项和 USB 调试的 Android 真机。
- 一条支持数据传输的 USB 线；Windows 如需要则安装厂商 USB 驱动。
- 深色和浅色各一张无纹理、哑光纯色背景纸。
- 1—8 个糖片、纽扣、几何片或其他非药品演示物。
- 固定测试图片，包括分离物体、接触物体、低对比、反光、阴影、模糊和杂乱背景样例。

演示素材不得包含真实处方、真实患者用药照片、姓名、联系方式、就诊信息或其他个人信息。

### 1.4 环境准入门槛

只有同时满足以下条件，才进入业务 Demo 编码：

- 模拟器能够启动并保持稳定运行。
- `adb devices` 能同时识别模拟器和已授权真机。
- 空白 Expo Development Build 能在模拟器和真机完成两次洁净构建、安装及启动。
- 原生 Kotlin 测试模块能够被 TypeScript 调用并返回固定测试值。
- 断开开发服务器后，单独构建的内部 APK 能启动内嵌 JavaScript bundle。

## 2. 安全边界与演示数据规则

### 2.1 强制提示

首次启动必须显示且要求用户确认：

> 内部演示版本，仅限虚构数据。禁止录入真实患者信息、真实处方或真实用药照片。本应用不能用于指导或证明实际服药。

确认后，首页顶部持续显示“虚构数据 Demo”标识。设置页必须提供“一键清除全部演示数据”。

### 2.2 本轮允许的简化

Demo 可以使用普通 `expo-sqlite` 和应用私有照片目录，因为数据被强制限定为虚构数据。此简化只用于内部概念演示，不构成正式产品安全决策。

正式架构中冻结的 SQLCipher、SecureStore/Android Keystore、AES-GCM 媒体加密、备份排除、应用锁、截屏策略和安全删除仍然有效，必须由 Phase 0 和后续正式实现验证。本 Demo 不得据此宣称已满足正式隐私或安全要求。

### 2.3 禁止范围

本轮不得实现或接入：

- 网络业务接口、云端同步、远程更新、远程日志或遥测；
- 大模型、在线问诊、OCR 或开放式识药；
- 外观异常模型、药物身份判断、剂量换算或自动确认；
- 照护者、奖励、虚拟宠物、语音或自动快门；
- 漏服补服、停药、改量、副作用处置等医疗建议；
- 真实患者招募、真实健康数据导入或对外公开分发。

## 3. Demo 技术基线

### 3.1 工程与依赖

- Expo + React Native + TypeScript，Android 先行，单仓库管理。
- 使用 Expo Development Build；Expo Go 不作为开发或验收环境。
- 使用 Expo Router 管理页面和通知深链。
- 使用 React Hook Form + Zod 管理表单及输入校验。
- Zustand 仅保存临时界面状态，持久事实必须写入 SQLite。
- 使用 `expo-sqlite` 保存虚构结构化数据。
- 使用 `expo-camera` 执行手动快门拍照。
- 使用 `expo-notifications` 调度本地提醒。
- 照片保存在应用私有目录，不写入系统相册。
- 使用 Expo Modules API 编写 Kotlin 原生轮廓计数模块。
- 禁用 Expo 运行时远程更新；最终演示 APK 不依赖 Metro 或远程 JavaScript bundle。

应用包名冻结为 `com.helpusurvive.medicationdemo`，显示名称冻结为“用药记录 Demo”。

### 3.2 推荐目录边界

```text
app/                         Expo Router 页面与布局
src/domain/                  状态、数量、领域规则
src/application/             用例与事务编排
src/infrastructure/          SQLite、文件、通知实现
src/ui/                      复用组件和 Demo 标识
modules/demo-pill-counter/   Kotlin 轮廓计数原生模块
assets/demo-fixtures/        无个人信息的固定测试图片
```

这只是 Demo 工程边界，不修改总体技术架构文档中的正式模块边界。

## 4. 最小完整演示闭环

### 4.1 首次启动与虚构建档

1. 显示 Demo 限制并取得确认。
2. 用户选择预置的“演示药A”“演示药B”，或手工创建名称以“演示”开头的虚构药项。
3. 为每种演示药录入计划服用数量和初始库存。
4. 设置每日固定提醒时间。
5. 保存方案并生成今日任务及本地通知意图。

不得提供真实药名目录、真实处方模板或从真实照片导入信息的入口。

### 4.2 提醒与拍照

1. 通知点击后进入对应今日任务。
2. 页面显示计划药项和计划数量。
3. 用户选择“拍摄本次准备物”或“跳过拍照”。
4. 跳过时必须选择或填写原因，之后仍可进入人工主链。
5. 拍照时显示取景区域和受控背景提示，要求物体分开放置。
6. 照片保存到应用私有目录后调用本地计数模块。
7. 计数成功时显示“检测到 N 个独立物体”；失败时显示原因并允许人工填写照片中物体数。

计数结果只是照片记忆辅助信息，不能填充任何单药实际服用量。

### 4.3 已准备与逐药确认

1. 完成拍照或记录跳过原因后，用户点击“已准备”。
2. “已准备”只更新任务进度，不扣减库存。
3. 页面逐项询问每种演示药的实际情况：按计划服用、部分服用或未服用。
4. 对按计划或部分服用的药项，用户人工确认实际数量。
5. 每个药项单独保存确认状态和实际数量。
6. 全部药项完成后，任务进入已确认状态；允许一项已服、另一项未服。
7. 库存只根据逐药人工确认数量生成消耗流水。

### 4.4 历史、纠错与清除

- 历史页按任务展示计划、照片、计数观察、逐药确认事实和库存流水。
- 用户可以撤销错误任务；系统追加相反方向库存流水，不删除原流水。
- 用户可以修订单药实际数量；系统追加冲销流水和新的正确方向流水，并保留修订时间。
- 被用户删除的照片不再可见；Demo 可直接删除文件并保留结构化删除标记。
- “一键清除全部演示数据”必须删除 SQLite 数据、照片文件和临时缓存，并返回首次启动页。

## 5. 数据与状态契约

### 5.1 最小数据表

| 表 | 作用 | 关键约束 |
| --- | --- | --- |
| `medications` | 虚构药项 | 名称必须为演示名称；软停用，不直接删除历史引用 |
| `regimens` | 固定时间方案 | 每日固定时间；本轮不支持按需或交替剂量 |
| `dose_occurrences` | 某次计划任务 | 保存计划时间、提醒意图和任务生命周期 |
| `dose_items` | 任务内逐药事实 | 每个药项独立保存计划量、人工确认量和确认状态 |
| `photo_evidence` | 照片或跳过事实 | 一张整组照片可关联同一任务的多个药项 |
| `count_observations` | 计数器观察 | 保存检测数、状态、失败原因和算法版本 |
| `inventory_ledger` | 追加式库存流水 | 消耗、冲销、修订和初始库存均不可原地覆盖 |

### 5.2 三个数量必须分离

| 数量 | 来源 | 允许影响库存 |
| --- | --- | --- |
| `detected_object_count` | 本地轮廓计数器或用户对照片总数的人工覆盖 | 否 |
| `planned_dose_quantity` | 用户建立方案时录入 | 否 |
| `confirmed_consumption_quantity` | 用户逐药确认实际情况时录入 | 是 |

禁止把照片总物体数分配给具体药项，禁止用总物体数推导实际服用量，禁止因计数成功自动完成药项确认。

### 5.3 事务规则

- “逐药确认 + 库存消耗流水”在同一个 SQLite 事务中提交。
- 已准备状态不产生库存流水。
- 撤销时追加与原消耗等量、方向相反并引用原流水的记录。
- 修订时先冲销原确认对应流水，再追加修订后的新流水。
- 重试同一命令必须使用幂等键，不能重复扣减库存。
- 历史任务、原确认和修订记录不得因纠错而被物理覆盖。

## 6. Kotlin 轮廓计数模块

### 6.1 TypeScript 接口

```ts
type DemoCountResult =
  | {
      status: "counted";
      detectedObjectCount: number;
      quality: "acceptable";
      boxes?: Array<{ x: number; y: number; width: number; height: number }>;
    }
  | {
      status: "unable";
      reason:
        | "low_contrast"
        | "blur"
        | "overlap"
        | "background_noise"
        | "too_dark"
        | "processing_error";
    };

interface DemoPillCounter {
  countObjects(photoUri: string): Promise<DemoCountResult>;
}
```

模块名称中的 `Pill` 仅代表项目内部技术命名；用户界面统一称“物体计数”，不得据此暗示识别了药物身份。

### 6.2 处理流程

1. 从应用私有 URI 读取图片，并按最长边不超过约 1024 像素进行降采样。
2. 采样取景区域边缘，估算纯色背景及其颜色方差。
3. 根据前景与背景的颜色距离生成二值掩膜。
4. 使用小尺寸形态学开闭运算去除孤立噪声并填补小孔洞。
5. 执行连通区域标记，按面积、长宽比和边界接触情况过滤异常区域。
6. 对合格的独立区域计数，并可返回用于调试显示的包围框。
7. 检测到低对比、过暗、明显模糊、物体接触、背景方差过大或处理异常时返回 `unable`。

所有阈值必须由无个人信息的固定测试图片校准并写入版本化常量，不能根据药名或剂量变化。本 Demo 不使用 TFLite 模型；正式端侧视觉能力仍按模型卡和 Phase 0 方案验证。

### 6.3 人工回退

- `unable` 不阻断照片保存和服药记录。
- 页面以普通语言说明“照片不适合自动计数”，并显示重拍、人工填写总数、继续但不填写三个选项。
- 人工填写只修订照片观察信息，不影响任何单药确认字段。
- 计数器崩溃、超时或返回未知值时统一映射为 `processing_error`。

## 7. 本地提醒与恢复

- 仅实现每日固定时间提醒；不实现每周、按需或交替剂量计划。
- 数据库保存提醒意图、任务 ID、计划触发时间和系统通知 ID。
- 系统通知是数据库意图的可重建投影，不是任务事实来源。
- 通知点击必须通过任务 ID 深链到相应今日任务。
- 应用每次前台启动时检查未来提醒并补建缺失通知。
- 通知权限被拒绝或系统能力不可用时，显示持续的本地提示并保留今日任务。
- Demo 不承诺提醒绝对送达或绝对准时；模拟器结果不能替代真机通知证据。
- 为现场演示提供“创建一分钟后的演示提醒”，但该入口必须带有 Demo 标识且不能进入正式需求。

## 8. 构建、交付与执行顺序

### 8.1 执行顺序

1. 完成 Android Studio、SDK、模拟器和真机环境冒烟。
2. 创建 Expo TypeScript 工程和 Development Build。
3. 建立 Demo 标识、禁止真实数据提示和一键清除框架。
4. 建立 SQLite 最小 schema、迁移、repository 和库存事务。
5. 实现虚构建档、固定计划、今日任务和逐药确认页面。
6. 接入应用私有照片、相机和跳过拍照流程。
7. 实现 Kotlin 轮廓计数模块、固定图片测试及人工回退。
8. 接入本地通知、任务深链和前台提醒重建。
9. 实现历史、撤销、修订、反向流水和数据清除。
10. 在模拟器和真机完成离线验收，生成内部侧载 APK。

### 8.2 APK 交付

- 开发过程使用 Development Build。
- 最终交付一个内嵌 JavaScript bundle、不依赖 Metro 的 release-like APK。
- APK 使用专门的内部 Demo 签名，签名材料不得提交到仓库，也不得复用于正式发布。
- 建议文件名为 `medication-demo-v0.1-android.apk`。
- 同时保存版本号、Git commit（如项目已初始化 Git）、构建时间、依赖锁文件和 APK SHA-256。
- 仅允许本地侧载给受控内部演示设备，不上传应用商店或公开下载站。

## 9. 验收标准

### 9.1 功能与离线

- 开启飞行模式后，虚构建档、今日任务、拍照、人工确认、库存和历史完整可用。
- APK 在 API 36 模拟器和一台真机上均可独立安装、冷启动和清除数据。
- 最终 APK 在未启动 Metro、未连接开发电脑时可运行完整演示闭环。
- 本地通知能在真机触发并进入对应任务；权限拒绝后主链仍可使用。
- 杀死进程或重启应用后，任务、照片、库存及提醒意图能够恢复。

### 9.2 计数与回退

- 深色和浅色受控背景下，1—8 个互不接触的演示物均有固定测试样例。
- 低对比、模糊、接触、杂乱背景及处理异常均能安全返回 `unable`。
- 所有失败场景均可重拍、人工填写总数或继续，不能阻断逐药确认。
- 照片计数结果永远不能自动写入实际服用量、完成确认或产生库存流水。
- 模拟器使用固定图片验证算法；真实拍照、权限和耗时以真机为准。

### 9.3 数据一致性

- 已准备状态不改变库存。
- 一项按计划服用、另一项未服用时，各药项事实和库存变化正确。
- 部分服用只扣减人工确认数量。
- 同一确认命令重试不会重复扣减。
- 撤销生成反向流水；修订保留原事实、冲销流水及新流水。
- 删除照片不删除服药和库存历史；一键清除则删除全部 Demo 数据及照片。

### 9.4 安全边界

- 所有预置名称和素材均为虚构或无个人信息内容。
- 首次提示、首页标识和设置页警示均清晰可见。
- 应用没有业务网络请求、远程更新、远程日志或遥测。
- 用户界面不输出肯定性医学、身份或剂量结论。
- 文档、APK 和演示话术均不得把 Demo 描述为真实患者可用产品。

## 10. 与正式产品门禁的关系

Demo 验收通过只能证明：选定设备上可以演示离线核心交互、追加式库存和受控背景总物体计数。它不能关闭以下正式门禁：

- Phase 0 S00—S08 真机验证；
- SQLCipher、Keystore、AES-GCM、备份排除和截屏保护；
- D-L、D-M、D-N、D-C 四类真机兼容验证；
- TFLite 计数与外观异常能力的模型卡评测；
- 完整提醒可靠性、故障注入和安全验证；
- 伦理、知情同意、隐私、医学及药学人类签署；
- 真实患者数据收集、研究导出或公开发布批准。

Demo 完成后，由主负责人生成单独的 Demo 验收记录。只有回到 Gate B 并完成其未关闭条件，才可进入正式患者业务编码。

## 11. 官方资料

以下资料仅用于开发环境、Expo 原生模块和 Android 本地能力的技术依据，访问日期均为 `2026-08-24`：

- [Expo：Development Builds 介绍](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo：Development Builds 常见问题](https://docs.expo.dev/develop/development-builds/faq/)
- [Expo Modules API：创建 Kotlin/Swift 原生模块](https://docs.expo.dev/modules/get-started/)
- [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/)
- [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [Android Developers：安装 Android Studio](https://developer.android.com/studio/install)
- [Android Developers：运行 Android Emulator](https://developer.android.com/studio/run/emulator)
- [Android Developers：在真机上运行应用](https://developer.android.com/studio/run/device)
- [Android Developers：SDK Platform 版本](https://developer.android.com/tools/releases/platforms)

## 12. 修订记录

| 版本 | 日期 | 变更 | 状态 |
| --- | --- | --- | --- |
| v0.1 | 2026-08-24 | 冻结仅限虚构数据的可安装功能 Demo 范围、技术边界、计数接口、交付顺序和验收标准 | 待执行 |
