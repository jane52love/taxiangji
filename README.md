# 她乡记

一个基于 PWA 的移动端智能体工作台：前端页面（安卓手机优先）包装 TRAE 主智能体，提供多个内容创作场景入口。

**一句话介绍：** 让普通的「她」，把正在经历的生活和画面快速形成文案，变成能拍、能说、能传播的家乡故事。

## 给金梅姐的跑通路径（核心交付）

1. 把「她乡记」文件夹发给她（用 `打包分发.sh` 生成的 `dist/她乡记-分发包-日期.zip`）
2. 她解压后用 **Trae 打开该文件夹**（项目规则 `.trae/rules/project_rules.md` 自动生效，助手即知道全部背景、知识库与归档规则）
3. 她在 Trae 中导入 `skill安装包/` 里的 3 个 skill zip（一次即可；不导入也能用，助手会读 `skills/` 目录兜底）
4. 开始对话；成稿确认后自动归档到 `我的素材/日期-标题/`

面向金梅姐的操作步骤见 [使用说明.md](使用说明.md)。

## 目录结构

```
她乡记/
├── 使用说明.md                  # 金梅姐操作指南（3 步上手）
├── 打包分发.sh                  # 一键生成 skill 安装包 + 完整分发包
├── .trae/rules/project_rules.md # Trae 项目规则（打开文件夹自动生效）
├── README.md                    # 本文件
├── docs/
│   ├── PRD.md                   # 产品需求文档（依据产品整合文档整理）
│   └── frontend-spec.md         # 前端规格说明（交给 codex 实现）
├── skills/                      # 场景 Skill 定义（从桌面资料迁移）
│   ├── mulan-video-content/     # 1. 她乡记文案（v5 正式版，含 references/）
│   ├── benchmark-copywriting/   # 2. 对标账号文案（对标账号分析 · 9层框架）
│   ├── account-diff-compare/    # 3. 对标账号分析（双账号对比 HTML 报告）
│   ├── video-homepage-material/ # 4. 视频号首页素材生成（待更新）
│   └── （skill安装包/ 由打包脚本生成，供 Trae 导入）
├── 我的素材/                     # 每次对话确认主题后归档（时间-标题 文件夹）
│   └── README.md                # 保存规范
├── 我的知识/                     # 知识库（可手动维护）
│   ├── README.md                # 维护说明
│   ├── 金梅姐说话风格规则.md      # 句式公式、用词白/黑名单
│   └── 场景触发库/               # 22 个主题文件 + 00-主题索引.md（已解析）
├── frontend/                    # 前端代码占位（codex 将在此实现）
└── dist/                        # 打包产物（分发包 zip）
```

## 四个场景入口

| # | 场景 | Skill 标识 | 状态 |
|---|------|-----------|------|
| 1 | 她乡记文案 | `mulan-video-content` | 可用（v5） |
| 2 | 对标账号文案 | `benchmark-copywriting` | 可用 |
| 3 | 对标账号分析 | `account-diff-compare` | 可用 |
| 4 | 视频号首页素材生成 | `video-homepage-material` | 待更新 |

## 核心工作流

```
木兰输入（语音/文字 + 图片）→ 场景触发知识库 → 多轮挖掘（不编，先挖真实内容）
→ 生成四件套（视频脚本 / 口播文案 / 标题推荐 / 视频号配文）
→ benchmark 自检改稿 → 木兰确认 → 归档到 我的素材/YYYY-MM-DD-标题/
```

## 关键文档

- 产品全貌：[docs/PRD.md](docs/PRD.md)
- 前端实现需求（codex 用）：[docs/frontend-spec.md](docs/frontend-spec.md)
- 素材归档规范：[我的素材/README.md](我的素材/README.md)
- 知识库维护方法：[我的知识/README.md](我的知识/README.md)
