---
title: "长期用药管理 APP｜离线 MVP 总体技术架构"
version: "v0.2"
status: "内部研究原型技术基线"
updated: "2026-08-27"
language: "zh-CN"
scope: "Android 先行；iOS 后续适配；单机离线 MVP"
inputs:
  - "../product/长期用药管理APP_PRD_v0.1.md"
  - "../product/长期用药管理APP_MVP_离线版_v0.1.md"
---

# 长期用药管理 APP｜离线 MVP 总体技术架构

> 本文冻结内部研究原型的技术边界、模块职责、数据契约和安全降级。产品行为以离线 MVP 文档为准；本文不得扩大医疗能力或当前版本范围。

## 0. 架构结论

1. **采用 Expo + React Native + TypeScript 单代码库，Android 先行，iOS 后续适配。**
2. **使用 Expo Development Build，不使用 Expo Go 作为开发、测试或发布环境。** SQLCipher、TFLite、媒体加密和截屏控制均需要原生能力。
3. **单 App、单仓库、单患者、单进程。** 不引入微服务、服务端、账号、同步队列、monorepo 或远程配置。
4. **离线 P0 不发起网络请求。** 模型、迁移和安全文案随安装包分发；禁用运行时远程更新和远程遥测。
5. **SQLite 是健康数据唯一事实源。** Zustand 只保存临时界面状态，不保存需要恢复的处方、确认、库存或异常事实。
6. **服药生命周期、逐药确认、照片证据和视觉结果正交。** 端侧模型不能自动确认服药或扣减库存。
7. **照片先加密落盘，再推理。** 推理失败不影响凭证和人工闭环。
8. **系统通知是可重建投影。** 数据库保存提醒意图；权限或系统限制可能导致延迟或缺失，产品不承诺绝对送达。
9. **首版视觉只做实物计数和异常提示。** 不做开放式识药，不向用户显示肯定性正确结论。
10. **内部研究数据本机计算、用户主动导出。** 不后台上传原始健康数据。

## 1. 技术选型

| 能力 | 选型 | 边界 |
| --- | --- | --- |
| 语言 | TypeScript，启用严格模式 | 禁止用 `any` 绕过健康数据契约 |
| UI | React Native + Expo | Android 先验收；共享业务代码保持 iOS 可移植 |
| 构建 | Expo Development Build / EAS 本地或受控构建 | 不依赖 Expo Go；构建过程不得注入运行时联网依赖 |
| 路由 | Expo Router | 路由参数只传 ID，不传完整健康对象 |
| 表单 | React Hook Form + Zod | 所有持久化输入先通过 schema 校验 |
| 临时状态 | Zustand | 仅相机 UI、筛选条件、草稿导航状态 |
| 数据库 | `expo-sqlite` + SQLCipher | 手写 repository 和版本化 migration；不用远程数据库 |
| 密钥 | `expo-secure-store` + Android Keystore | SecureStore 保存数据库密钥及媒体密钥别名/版本；不可导出的媒体主密钥只存在于 Keystore |
| 相机 | `expo-camera` | 首版手动快门；照片不进入系统相册 |
| 文件 | `expo-file-system` + 本地 Expo 原生加密模块 | 私有目录、AES-256-GCM 单文件加密 |
| 通知 | `expo-notifications` | 本地调度、自检和重建；无推送服务 |
| 端侧推理 | 自定义 Expo 原生 `VisionInferenceModule` + Google LiteRT/TFLite Android runtime | 原生侧解密、预处理和推理；只向 JS 返回最小结构化结果 |
| 日志 | 本地环形诊断日志 | 脱敏、限额、可清除；不接远程崩溃/分析 SDK |
| 测试 | Vitest/Jest、React Native Testing Library、Detox、Android 真机测试 | 领域契约、数据库迁移、系统能力和故障降级分层验证 |

所有依赖在工程初始化时锁定精确版本和完整性哈希。升级相机、SQLite、通知、加密或推理依赖必须经过 ADR、真机回归和迁移验证。

## 2. 系统边界

### 2.1 P0 设备内能力

- 手工处方、药品、库存、计划、复诊和检查事项。
- 本地提醒、提醒健康检查和深链。
- 手动拍照、跳过原因、照片加密和时间线。
- 实物计数、疑似外观变化和无法判断。
- 已准备、逐药人工确认、库存流水、异常和修订。
- 应用锁、截屏控制、照片保留、全部清除。
- 本地研究事件聚合和主动脱敏导出。

### 2.2 当前禁止依赖

- HTTP API、WebSocket、远程配置、推送服务、云对象存储。
- 在线模型、大模型 API、OCR 服务和第三方药物知识库。
- 远程日志、分析、广告、归因或崩溃上报 SDK。
- 账号、照护者、奖励、语音和自动快门模块。

### 2.3 运行不变量

即使相机权限被拒绝、TFLite 模型不可用、通知权限关闭或设备长期断网，用户仍能从 App 内查看任务、说明跳过拍照原因、逐药确认、修订库存、记录异常和查看复诊事项。

## 3. 分层与模块

```text
React Native UI / Expo Router
        │
        ▼
Application Use Cases
        │
        ▼
Pure TypeScript Domain
        │
        ▼
Ports / Repositories
   ┌────┼──────────┬──────────┬──────────┐
   ▼    ▼          ▼          ▼          ▼
SQLite  Notifications Camera  MediaCrypto TFLite
```

### 3.1 表现层

- 页面、导航、表单、拍摄引导和可恢复草稿。
- 只读取 view model，不直接编写 SQL 或调用原生加密接口。
- 所有高风险操作使用明确文案和二次确认。

### 3.2 应用层

- 编排首次建档、生成任务、准备证据、逐药确认、修订、库存和研究导出。
- 划定事务边界和幂等键。
- 将平台错误转换为稳定的领域错误码。

### 3.3 领域层

- 纯 TypeScript 实体、值对象、状态转换和不变量。
- 不依赖 React、Expo 或平台 API。
- 禁止模型结果驱动服药确认。

### 3.4 基础设施层

- Repository、SQLCipher、迁移、照片加密、通知调度和 TFLite 适配。
- 系统投影可丢弃并从数据库重建。
- 原生模块不得复制处方、确认、库存或异常业务规则。

## 4. 建议目录

```text
medication-adherence-app/
├── app/                         # Expo Router 页面
│   ├── (onboarding)/
│   ├── (tabs)/
│   ├── camera/
│   ├── dose/
│   └── settings/
├── src/
│   ├── domain/                  # 实体、状态、不变量
│   ├── application/             # 用例和事务编排
│   ├── infrastructure/
│   │   ├── database/
│   │   ├── media/
│   │   ├── notifications/
│   │   ├── vision/
│   │   └── research-export/
│   ├── features/                # 页面级功能模块
│   ├── ui/                      # 设计系统和通用组件
│   ├── content/                 # 版本化安全文案
│   └── config/                  # 本地构建开关
├── modules/
│   ├── media-crypto/            # Expo 原生模块；AES-GCM/受控显示/截屏平台能力
│   └── vision-inference/        # 原生 LiteRT；解密、预处理、推理均不进入 JS
├── assets/models/               # 签名后的 TFLite 工件和清单
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
├── app.config.ts
├── eas.json
└── package-lock.json
```

不拆 monorepo，不建立通用框架包。只有确实需要原生平台能力的代码进入 `modules/`。

## 5. 公开 TypeScript 契约

```ts
export type DoseLifecycle =
  | 'scheduled'
  | 'due'
  | 'prepared'
  | 'taken_confirmed'
  | 'late_taken'
  | 'missed'
  | 'revoked';

export type ItemConsumptionAssertion =
  | 'pending'
  | 'taken_as_planned'
  | 'partially_taken'
  | 'not_taken';

export type PhotoEvidenceState =
  | 'captured'
  | 'skipped_with_reason'
  | 'deleted_tombstone';

export type AppearanceAssessment =
  | {
      status: 'suspected_change';
      reasons: Array<'color' | 'shape' | 'texture' | 'imprint'>;
    }
  | { status: 'unable'; reason: string }
  | { status: 'no_anomaly_signal' };

export interface DoseOccurrenceItem {
  id: string;
  occurrenceId: string;
  medicationId: string;
  plannedDoseQuantity: string;
  confirmedConsumptionQuantity: string | null;
  unit: 'tablet' | 'capsule';
  assertion: ItemConsumptionAssertion;
}

export interface VisionObservation {
  photoId: string;
  detectedObjectCount: number | null;
  appearance: AppearanceAssessment;
  modelManifestVersion: string;
  durationMs: number;
}
```

数量用十进制定点字符串进入领域层和数据库，禁止使用二进制浮点直接计算库存。`detectedObjectCount` 只能是整数或空，不能写入 `confirmedConsumptionQuantity`。

## 6. 数据模型

### 6.1 主要表

| 表 | 关键职责 |
| --- | --- |
| `patient_profile` | 单患者本机设置、边界确认版本 |
| `prescription_version` | 不可覆盖的处方版本和生效区间 |
| `medication` | 药名、规格、单位和当前状态 |
| `medication_appearance_version` | 外观基准历史；每种药至多一个 active |
| `regimen` | 固定日/周计划、时区和两个阈值 |
| `dose_occurrence` | 单次任务生命周期和派生时间 |
| `dose_occurrence_item` | 逐药计划量、实际量和确认状态 |
| `photo_evidence` | 加密文件引用、状态、跳过原因、删除墓碑 |
| `photo_medication_link` | 照片和任务药项多对多关联 |
| `vision_observation` | 计数、异常状态、模型清单版本和耗时 |
| `inventory_ledger` | 追加式入库、消耗、撤销和人工修订 |
| `exception_record` | 漏服、副作用等结构化记录 |
| `follow_up_item` | 复诊、取药和检查事项 |
| `reminder_intent` | 计划提醒事实和系统投影版本 |
| `research_event` | 最小本地研究事件 |
| `audit_event` | 高风险修改、导出、删除和设置变更 |

### 6.2 关键约束

- 每个 `medication_id` 最多一条 active 外观基准。
- `record_until` 晚于 `on_time_until`，且早于同方案下一任务。
- `confirmed_consumption_quantity` 仅在非 pending 状态下允许写入；未服用为零。
- 同一确认命令使用稳定 `idempotency_key`，重复执行不得重复扣库存。
- 库存余额由流水聚合；不能直接覆盖历史余额来源。
- 删除照片只清除密文、nonce、tag 和派生缩略图，保留墓碑元数据。
- 撤销事实必须引用原事实；反向库存流水在同一事务中提交。

### 6.3 迁移

- `PRAGMA user_version` 驱动前向迁移，每个版本只有一条路径。
- 启动时先备份数据库页级快照到受保护临时区，迁移成功后删除。
- 迁移失败进入只读恢复页，不创建部分新 schema。
- 每次迁移测试空库、前一版本快照、损坏输入和中断恢复。

## 7. 核心事务与状态转换

### 7.1 准备证据

```text
due
  ├─ 照片加密保存成功 ──> prepared + PhotoEvidence(captured)
  └─ 保存跳过原因 ──────> prepared + PhotoEvidence(skipped_with_reason)
```

相机拍到但加密落盘失败时不得进入 `prepared`。视觉推理在事务提交后运行，结果独立追加。

### 7.2 逐药确认

单个事务完成：

1. 校验任务和药项版本。
2. 保存每个药项的 assertion 和实际数量。
3. 对非零实际量追加负向库存流水。
4. 根据确认时间和阈值派生 `taken_confirmed` 或 `late_taken`。
5. 写入审计事件。

部分药项保持 pending 时，任务不进入最终确认状态。

### 7.3 漏服与补录

- 调度器或下次前台修复在 `record_until` 后追加漏服事件。
- 后续补录追加新的人工确认和修订关系，不删除漏服事件。
- 统计层可将其展示为“曾漏记，后补录晚服”，原始事件保持可追溯。

### 7.4 撤销

- 创建 `revocation`，引用被撤销确认。
- 对原库存变化追加等量反向流水。
- 任务派生为 `revoked` 或根据剩余有效确认重新计算。
- 不物理删除确认事实。

## 8. 提醒架构

### 8.1 ReminderIntent

```ts
export interface ReminderIntent {
  id: string;
  regimenId: string;
  occurrenceId: string;
  scheduledAt: string;
  timeZone: string;
  privacyMode: 'neutral';
  projectionVersion: number;
}
```

SQLite 中的 `ReminderIntent` 是事实；Android 系统通知 ID 是可重建映射。

### 8.2 调度策略

- 方案保存后生成有限滚动窗口内的任务和提醒。
- 每次前台、设备重启、时区变化、权限变化和方案修改后运行 reconciliation。
- 仅取消由本应用创建且记录在投影表中的通知。
- 若精确闹钟能力不可用，使用系统允许的近似本地通知并告知用户。
- 提供测试提醒、权限状态、下一次计划时间和修复入口。

### 8.3 深链

通知只携带不含健康信息的 opaque occurrence ID。打开后从加密数据库加载任务；若任务已完成或已撤销，进入只读详情并提示，不能重复扣库存。

## 9. 相机与媒体

### 9.1 拍摄

- `expo-camera` 提供预览、权限、手动快门和基础画质提示。
- 默认整组模式；逐药模式复用同一页面并限定当前药项。
- 临时明文只允许存在于应用缓存的受控文件，完成加密后立即删除。

### 9.2 媒体加密

- 首次启动由原生媒体加密模块在 Android Keystore 中生成不可导出的媒体主密钥；SecureStore 只保存密钥别名、版本和数据库密钥，不读取或保存媒体主密钥原文。
- 每张照片生成随机数据密钥/nonce，采用 AES-256-GCM；文件头保存格式版本和非敏感算法参数。
- 缩略图同样加密，不允许明文缩略图进入缓存或系统备份。
- 解密仅在原生受控显示或推理组件内短时进行；JavaScript 不得取得媒体密钥、照片 Base64/字节、可逆像素缓冲或明文路径。离开页面或推理结束时清除原生缓冲和临时文件。

### 9.3 保留与截屏

- 默认保留策略为长期；定期清理只处理用户明确配置过期的照片。
- 敏感路由默认启用 Android `FLAG_SECURE` 等价能力。
- 用户全局放开截屏后，敏感路由不再设置保护；偏好变更写入本地审计。

## 10. 端侧视觉

### 10.1 管线

```text
原生模块解密到受控 native buffer
  → 画质门控
  → 药片样物体检测与总数
  → 判断外观基准和形态是否可用
  → 特征/异常分数
  → suspected_change | unable | no_anomaly_signal
  → 保存独立 VisionObservation
  → 清除推理缓冲区
```

### 10.2 用户展示

- `suspected_change`：提示用户核对照片、包装、厂家和处方，并逐药人工确认。
- `unable`：说明本次无法辅助判断，保留照片并进入人工确认。
- `no_anomaly_signal`：不生成通过卡片或安全文案，只正常展示照片、物体总数和确认表单。

### 10.3 强制回退

以下情况直接 `unable`：半片、破损片、透明胶囊、明显遮挡/重叠、同一种药的新旧厂家/批次/外观并用、无 active 基准、模型清单无效、推理超时、输出非有限值或设备不支持。不同计划药物共同入镜是合法整组场景；首版不输出 `size` 原因。

### 10.4 模型发布

- `.tflite`、标签、阈值、预处理参数和版本组成签名 manifest，随安装包分发。
- 运行时不下载模型，不远程改变阈值。
- 历史结果保留原 manifest 版本，升级不自动重算。
- CPU 是首个基线；NNAPI/GPU 只有通过黄金样例一致性、崩溃和性能测试后才启用。
- 构建开关可完全关闭外观管线，照片和人工主链不受影响。

## 11. 应用锁与密钥

- 应用锁是可选隐私门，不替代设备级加密。
- 首次设置主动引导，用户可跳过；设置页可随时启用/关闭。
- 生物识别不可用时回退设备凭据，不自建可远程找回的 PIN 服务。
- 数据库密钥、不可导出的媒体主密钥和未来备份密钥分层，不能复用；媒体加解密完全在原生模块内完成，原始媒体密钥不得进入 JavaScript 内存。
- 应用锁失败不得触发数据删除或阻止系统通知继续调度。
- 卸载后系统密钥丢失，残留密文不可恢复；产品必须明确告知。

## 12. 离线与平台配置

### 12.1 运行时远程更新

- `updates.enabled = false`，发布版本不检查、下载或应用运行时更新。
- 新模型、schema 和安全文案只通过签名安装包升级。
- 构建验证扫描依赖和 bundle，确认没有远程配置或动态代码加载。

### 12.2 Android 自动备份

- Manifest 和 data-extraction-rules 明确排除数据库、WAL、照片、缩略图、密钥包装材料、研究事件和诊断日志。
- P1 备份只能由应用主动生成认证加密容器，不能依赖系统自动备份。

### 12.3 网络约束

- P0 业务代码不定义 HTTP client 或联网 repository。
- 测试构建使用网络拦截器/系统审计验证核心旅程零网络请求。
- 未来联网能力必须通过新 ADR、独立 consent 和显式网络状态进入，不复用当前离线接口暗中上传。

## 13. 研究事件与导出

### 13.1 事件最小化

研究事件只保存：本地随机研究会话 ID、事件类型、相对/粗粒度时间、耗时区间、结果类别和模型版本。不得包含照片、药名、疾病、处方文本、自由文本、广告 ID 或稳定硬件标识。

### 13.2 导出流程

1. 本机生成汇总和字段预览。
2. 用户确认研究同意仍有效并主动授权。
3. 生成版本化、带完整性校验的脱敏包。
4. 通过系统分享面板离开应用；App 不选择或上传到默认远程目的地。
5. 写入导出审计；用户可随后清除本地研究事件。

完整健康数据导出和 P1 加密备份使用不同格式与用途，不能混用。

## 14. 错误与降级

| 错误 | 用户行为 | 系统行为 |
| --- | --- | --- |
| 相机权限拒绝 | 说明原因并人工确认 | 保存跳过状态，提供设置入口 |
| 照片加密失败 | 重试或跳过 | 不进入已准备，不保留不完整文件 |
| 模型失败/超时 | 人工核对 | 保存照片和 `unable`，主链继续 |
| SQL 事务失败 | 重试 | 整体回滚，不能部分扣库存 |
| 通知权限关闭 | 从首页查看任务 | 显示持续告警和修复入口 |
| 精确闹钟不可用 | 接受近似提醒 | 使用允许的系统能力并展示限制 |
| 时区变化 | 核对计划 | 暂停派生、重建未来任务和提醒 |
| 密钥不可用 | 进入恢复说明 | 不创建新明文库，不静默清空数据 |
| 存储空间不足 | 清理或调整保留策略 | 禁止声称照片已保存；允许无照片人工确认 |

## 15. 测试策略

### 15.1 单元与属性测试

- 状态转换、两个时间阈值和漏服后补录。
- 十进制定点数量、部分服用、库存聚合和反向流水。
- 多药任务派生、幂等确认和撤销。
- Zod 输入 schema 和错误码映射。

### 15.2 数据和契约测试

- 空库、历史快照、迁移中断和损坏库。
- group/per-item 照片关联、墓碑和级联约束。
- TFLite 黄金图片、预处理张量、计数和三种内部状态。
- 确认事务和库存事务的崩溃注入。

### 15.3 Android 真机测试

- 通知权限、精确闹钟、重启、强制停止、时区和省电模式。
- 相机权限、后台切换、低存储、不同方向和进程被杀。
- SQLCipher、Keystore、生物识别变化、截屏和自动备份排除。
- 低/中/高性能设备的冷启动、照片落盘、推理耗时和峰值内存。

### 15.4 端到端场景

- 整组一张和逐药拍摄。
- 多药部分服用、无照片人工确认和模型完全关闭。
- 半片、透明胶囊和同一种药的新旧外观并用强制回退；整组多种药同框属于正常测试场景。
- 漏服后补录、撤销确认和照片永久删除。
- 飞行模式连续运行、用户主动研究导出和全部清除。

## 16. 性能预算

| 指标 | Android 目标 |
| --- | --- |
| 冷启动至首页可交互 P95 | ≤2 秒 |
| 通知点击至相机可操作 P95 | ≤2 秒 |
| 照片加密落盘 P95 | ≤1 秒 |
| 单次端侧分析 P95 | ≤3 秒；超时返回 `unable` |
| 分析峰值额外内存 | 由低端目标机 Spike 冻结；不得触发系统杀进程 |

模型性能目标不能牺牲照片保存和人工确认的可靠性。

## 17. ADR 决策

| ADR | 决策 | 状态 |
| --- | --- | --- |
| ADR-001 | Expo + React Native + TypeScript 单代码库，Android 先行 | 已接受 |
| ADR-002 | Expo Development Build；不使用 Expo Go | 已接受 |
| ADR-003 | SQLite 是健康数据唯一事实源，Zustand 仅临时 UI | 已接受 |
| ADR-004 | SQLCipher + SecureStore 密钥封装 | 待安全 Spike 验证 |
| ADR-005 | 照片采用原生 AES-256-GCM 单文件加密 | 待安全评审 |
| ADR-006 | 手动快门；默认整组一张、可选逐药 | 已接受 |
| ADR-007 | 系统通知是可重建投影，不承诺绝对送达 | 已接受 |
| ADR-008 | 状态正交、逐药确认、实物数与剂量分离 | 已接受 |
| ADR-009 | 视觉只提示异常/无法判断，内部保留无异常信号 | 已接受 |
| ADR-010 | 模型随包发布、无运行时下载 | 已接受 |
| ADR-011 | 禁用运行时远程更新和远程遥测 | 已接受 |
| ADR-012 | 系统自动备份排除全部健康数据和密钥 | 已接受 |
| ADR-013 | 研究指标本机计算、用户主动脱敏导出 | 已接受 |
| ADR-014 | 单条事实撤销/修订；照片可物理销毁并留墓碑 | 已接受 |
| ADR-015 | P1 认证加密备份是公开测试门禁 | 已接受 |

每条 ADR 必须在 `docs/decisions/` 独立建档后才算工程签署完成；上表只记录总体架构决策。

## 18. 实施阶段

### Phase 0：风险 Spike

- 建立 Expo Development Build 最小 Android 工程。
- 验证 SQLCipher、SecureStore、AES-GCM 文件、通知、截屏和 TFLite。
- 用代表性机型冻结最低 Android 版本和性能降级线。

### Phase 1：领域与存储

- 完成 schema、迁移、repository、状态机和库存流水。
- 完成事务、幂等、撤销和崩溃恢复测试。

### Phase 2：人工核心闭环

- 完成手工建档、固定计划、提醒、跳过拍照、已准备、逐药确认和库存。
- 模型保持关闭，先验证完整离线主链。

### Phase 3：照片与端侧视觉

- 完成私有加密媒体、整组/逐药拍摄和时间线。
- 接入计数、异常提示和强制回退；完成模型卡和黄金样例。

### Phase 4：复诊、异常与研究

- 完成复诊事项、异常记录、安全分流和本地摘要。
- 完成脱敏研究包、预览、授权和清除。

### Phase 5：真实患者研究加固

- 完成威胁模型、隐私评估、医学/药学文案审核、伦理材料和设备矩阵。
- 完成长时间提醒、存储压力、卸载/密钥丢失和退出流程演练。

### Phase 6：公开测试准备（P1）

- 完成加密备份、原子恢复、迁移/回滚、商店披露和 iOS 适配。

## 19. 技术评审完成标准

- 架构、MVP 和状态契约逐项对应，无超范围联网、照护、奖励或语音依赖。
- 目标 Android 真机证明 SQLCipher、媒体加密、通知、截屏和 TFLite 可用或可安全降级。
- 模型完全关闭时，核心人工闭环仍通过全部 P0 验收。
- 数据库和照片不进入系统自动备份，运行时远程更新已关闭。
- 安全、医学、隐私和研究负责人签署各自门禁。
- 每项高风险决策已有独立 ADR、负责人和验证证据。

## 20. 个人本地测试版 schema v4 实现附录

### 20.1 定位与迁移边界

本节记录 2026-08-26 个人本地测试版已经落地的架构增量，用于指导当前工程集成和测试。它不修改前述正式离线 MVP 技术基线，也不表示处方版本、每周计划、完整外观识别、异常/研究、真实患者门禁或公开测试能力已经全部完成。

个人库使用单向迁移链：v2 建立加密个人数据结构，v3 原地为照片增加 `capture_purpose`，v4 原地增加库存预测偏好、复诊/取药/检查事项审计及辅助通知投影。启动时先应用 SQLCipher 密钥并通过认证探测，再启用 `foreign_keys` 和 WAL、执行迁移、写 `migration_journal`，最后设置 `PRAGMA user_version=4`。v3 表和业务行不得为升级 v4 而清除、覆盖或重算。

| v4 组件 | 架构职责 |
| --- | --- |
| `inventory_forecast_preferences` | 保存每药补药提醒提前天数；现有药升级默认 7，新药创建同步写 7；空值只关闭提醒 |
| `follow_up_items` | 保存人工录入的复诊、取药和检查事项及当前状态 |
| `follow_up_item_events` | 追加创建、编辑、完成和取消快照，支持审计与历史回看 |
| `auxiliary_reminder_intents` | 保存 refill、follow-up advance 和 follow-up due 的设备内提醒意图 |
| `auxiliary_reminder_projections` | 保存系统通知 ID、调度/取消状态和失败码；可由 intent 重建 |

正式数据字典中的 `follow_up_item` 与通用提醒概念映射到上述个人测试版表，但正式 MVP 仍以[数据字典与事件契约](数据字典与事件契约_v0.1.md)第 0—12 章为准；个人表名、固定 `count` 单位和仅每日计划等实现限制不得反向改写正式范围。

### 20.2 库存预测管线

```text
inventory_ledger 定点余额
        +
当前生效的 active 每日固定计划量
        ↓
fullDoses = floor(max(balance, 0) / dailyDose)
        ↓
不足日 = 下一未来计划本地日期 + fullDoses 天
        ↓
若开启提醒：不足日前 leadDays 天，本地 09:00
        ↓
已进入提前窗口：本次对账立即建立 refill intent
```

- 预测只读取追加式库存流水和每日固定计划，不读取 `count_observations`、照片状态或任何视觉结果。
- 同药多条同一时区计划聚合每日总计划量；出现跨时区计划时安全返回不可计算，不猜测本地日期。
- 暂停或没有有效计划时不可计算；余额不足一次每日剂量时，不足日就是下一未来计划日。
- `lead_days=NULL` 只令两个提醒触发时间为空并取消 refill intent；余额、每日剂量、完整可服次数和预计不足日继续计算。因此关闭提醒不关闭预测。
- 每次库存校正、计划变化、恢复前台和跨日对账后均可重新派生结果；预测结果不写回库存流水，也不成为新的健康事实。

### 20.3 事项、审计和跨日对账

事项用例只允许以下追加式变化：

```text
create  → pending + created event
edit    → pending(row_version+1) + edited event
complete→ completed + completed event
cancel  → cancelled + cancelled event
```

编辑、完成和取消均要求当前状态为 pending，并携带预期 `row_version`；没有物理删除单项事项的 repository 或应用用例。每个事件保存操作后的完整快照、命令 ID 和记录时间，事务失败时事项与事件一同回滚。Repository 按 UTC 截止时间查询所有仍 pending 的逾期事项，前台恢复不能只扫描“今天”，以保证多日未打开后的事项仍能进入对账。

pending 事项始终有 `follow_up_due` 意图；设置提前天数时另有 `follow_up_advance` 意图。完成、取消或删除提前设置只改变相关意图/投影状态，不物理删除事项和事件。

### 20.4 可靠通知投影与取消

数据库 intent 是期望状态，Android 系统通知是可重建 projection。任务提醒与 v4 辅助提醒遵守同一原则：

1. 创建或修改 intent 后，projection 进入 `pending_rebuild`。
2. 调度成功才保存系统通知 ID 和 `scheduled`；权限或平台失败保存 `failed`，不删除 intent。
3. 取消先把 projection 置为 `cancel_pending`，并保留原系统通知 ID。
4. 平台取消失败时继续保留旧 ID、`cancel_pending` 和失败信息；后续前台/重启/权限恢复对账必须先重试旧 ID，不能提前创建替代通知。
5. 只有平台确认旧通知已取消或不存在后，projection 才进入 `cancelled`；之后如 intent 再次 active，才允许按同一业务来源重建。

这种顺序避免“数据库显示已取消但旧通知仍弹出”以及失败重试产生重复通知。

### 20.5 全部清除与空库重建

全部清除不是逐表 `DELETE`。协调器必须停止业务读写并清理本应用通知和加密媒体，然后关闭 SQLCipher 连接，依次确认删除数据库 `-wal`、`-shm` 和主文件；只有全部数据库文件删除成功后，才能销毁数据库密钥。媒体密钥/别名、解密缓存和本地升级标记也必须清除。任一步失败均保留可恢复错误状态，不得先销毁唯一解密密钥，也不得创建新空库遮盖旧密文。

所有目标确认不存在后，下一次初始化才生成新密钥并按空库路径创建 schema v4。该流程需要真机验证文件占用、部分删除、重复清除、进程中断和系统通知取消失败。

## 21. 修订记录

| 日期 | 修订 | 状态 |
| --- | --- | --- |
| 2026-08-23 | 冻结 Expo/React Native 离线 MVP 总体技术架构 | 正式技术基线 |
| 2026-08-26 | 增加个人本地测试版 schema v4、库存预测、事项审计、辅助提醒投影与物理清除实现附录 | 实现附录；不代表正式 MVP 全部完成 |
| 2026-08-28 | 登记 29 文件/138 测试；修复后 x86_64 Release 构建、静态属性、API 36 干净离线冷启动、修复前包覆盖和异常明文库保护通过 | 真实 v3 包与 ARM 真机待验；不改变正式 MVP 或真实数据门禁 |

## 文档结论

正式技术路线为 Android 先行的 Expo + React Native + TypeScript 单代码库。应用以 SQLCipher 中的追加事实为核心，以系统通知、私有加密照片和随包 TFLite 模型作为可降级能力。视觉结果永远独立于服药确认；即使模型、相机或通知受限，用户仍能完成离线人工记录和纠错。
