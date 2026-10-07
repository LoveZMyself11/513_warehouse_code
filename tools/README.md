# 工具目录

这里的脚本分为可复用的库存工具和仅供历史资料处理的 legacy 工具。脚本默认从项目根目录解析输入与输出，因此可以在任意当前工作目录执行。

## 库存工具

`tools/inventory/generate_inventory_assets.py` 根据 `fixtures/inventory/inventory_image_manifest.csv` 生成审核后的 `fixtures/inventory/inventory.csv`、`fixtures/inventory/inventory.json` 以及开发库用的 `supabase/seed.sql`：

```bash
python3 tools/inventory/generate_inventory_assets.py
```

`tools/inventory/rename_inventory_images.py` 是一次性的图片整理工具。它会读取 `data/` 下的原始微信图片、写入 manifest 并重命名图片；只有在重新准备一套原始图片时才运行，不能对现有线上数据直接执行：

```bash
python3 tools/inventory/rename_inventory_images.py
```

## Legacy 工具

`tools/legacy/wechat_inventory_processor.py` 将手工粘贴的聊天记录导出到 `artifacts/legacy/wechat-import/`。生成的 SQL 使用历史 `items` 表结构，只能离线审阅，不能导入现网 Supabase。

`tools/legacy/create_account_import_template.mjs` 生成旧版账号模板到 `artifacts/legacy/account-import/`。它依赖外部 `@oai/artifact-tool`，该依赖不由 `npm ci` 提供；没有该运行环境时不要为运行 legacy 工具修改正式依赖。

所有 `artifacts/legacy/` 内容都是可再生的交付草稿，不是前端运行时资源，也不应提交已填写的人员资料、密码或服务密钥。
