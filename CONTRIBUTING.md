# 贡献指南（CONTRIBUTING）

本文档规定 LearnRise 仓库的提交规范与仓库卫生要求。所有贡献者在提交前请阅读并遵守。

## 1. Conventional Commits

提交信息必须遵循 Conventional Commits 格式：

```
<type>(<scope>): <subject>
```

- `type` 必须从以下类型中选择：`feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`
- `scope` 可选，用于限定影响范围（如 `repo`、`api`、`web`、`deps`）
- `subject` 用一句话描述变更，使用祈使语气，末尾不加句号

示例：

```bash
git commit -m "feat(api): 新增知识点检索接口"
git commit -m "fix(web): 修复仪表盘雷达图空数据渲染"
git commit -m "chore(deps): 升级 fastapi 至 0.115"
git commit -m "docs(readme): 补充本地演示步骤"
```

## 2. 一次提交只做一件事

每个提交必须只完成一个目的。禁止把多个不相关的改动混在同一个提交里。拆分规则：

- **改名与逻辑变更分离**：纯重命名/移动（如模块改名、文件移动、类型改名）必须单独提交；逻辑行为变化必须单独提交。两者不得合并。
- **依赖变更单独提交**：`requirements.txt`、`package.json` / `package-lock.json` 等依赖清单的变动必须使用 `chore(deps):` 类型单独提交，不与功能代码混提。
- **功能与测试**：一个功能改动与其直接对应的测试可以放在同一个提交里，但测试不得夹带其他功能的改动。

## 3. 生成物（Generated Artifacts）

以下文件为脚本生成，**不得手工编辑**：

- `openapi.json`
- `docs/api/*.md`
- `frontend/src/api/generated/`（含 `schema.d.ts` 等生成文件）

这些文件顶部带有 "do not edit" 说明头。如需更新，请运行生成脚本重新生成，并把生成结果作为独立提交（`chore(repo): regenerate API artifacts` 或 `docs(api): ...`）提交。生成脚本 `scripts/gen_api_docs.py` 在 backend 容器内运行：

```bash
# 示例：重新生成 API 文档（在 backend 容器内执行生成脚本）
docker compose run --rm -v "$PWD:/repo" -w /repo backend python scripts/gen_api_docs.py
git add openapi.json docs/api frontend/src/api/generated
git commit -m "chore(repo): regenerate API artifacts"
```

## 4. 预提交门禁（Pre-commit Gates）

提交前必须通过以下两个检查脚本：

```bash
scripts/check_legacy_name.sh    # 检查旧名称（legacy name）残留
scripts/check_repo_hygiene.sh   # 检查仓库卫生（未跟踪文件、生成物一致性等）
```

任一脚本失败时，禁止提交；先修复问题再重新执行。

```bash
git add <changed-files>
scripts/check_legacy_name.sh && scripts/check_repo_hygiene.sh
git commit -m "<type>(<scope>): <subject>"
```

## 5. 分支

- 主分支为 `main`，功能/修复分支从 `main` 切出，完成后以 PR 合入。
- 工作分支命名采用 `feat/<topic>`、`fix/<topic>`、`chore/<topic>`。
- 禁止向远端强推（`--force`）他人分支。
