import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const root = process.cwd();
const outputDir = path.join(root, "outputs/2026-10-07-account-import");
const workbook = Workbook.create();
const template = workbook.worksheets.add("账号导入模板");
const instructions = workbook.worksheets.add("填写说明");
const options = workbook.worksheets.add("部门与身份");
const headers = ["部门", "姓名", "手机号", "学号", "身份", "联系邮箱", "职位", "备注"];
const departments = ["宣传部", "组织部", "竞赛办公室", "文体部", "文艺部", "红承志愿服务队", "学风督导部", "生活部"];

template.showGridLines = false;
template.getRange("A1:H1").values = [headers];
template.getRange("A1:H1").format.fill = "#304C42";
template.getRange("A1:H1").format.font = { name: "Arial", size: 11, bold: true, color: "#FFFFFF" };
template.getRange("A1:H1").format.rowHeight = 28;
template.getRange("A1:H1").format.horizontalAlignment = "center";
template.getRange("A1:H101").format.verticalAlignment = "center";
template.getRange("A2:H101").format.font = { name: "Arial", size: 11, color: "#26332E" };
template.getRange("A2:E101").format.fill = "#FFF4CE";
template.getRange("F2:H101").format.fill = "#F3F5F4";
template.getRange("A2:H101").format.rowHeight = 24;
template.getRange("C2:D101").setNumberFormat("@");
template.getRange("E2:E101").dataValidation = { rule: { type: "list", values: ["普通用户", "部门管理员", "超级管理员"] } };
template.getRange("A2:A101").dataValidation = { rule: { type: "list", formula1: "'部门与身份'!$A$2:$A$9" } };
template.freezePanes.freezeRows(1);
template.freezePanes.freezeColumns(2);
[23, 14, 19, 20, 19, 33, 17, 38].forEach((width, index) => { template.getRangeByIndexes(0, index, 101, 1).format.columnWidth = width; });
template.tables.add("A1:H101", true, "StudentAccountImport");

instructions.showGridLines = false;
instructions.getRange("A1").values = [["513 仓库人员导入填写说明"]];
instructions.getRange("A1").format.font = { name: "Arial", size: 15, bold: true, color: "#26332E" };
instructions.getRange("A3:B3").values = [["字段", "填写要求"]];
instructions.getRange("A4:B13").values = [
  ["部门、姓名、手机号、学号、身份", "必填。黄色区域填写人员信息，空白行不导入。"],
  ["部门", "使用准确的部门名称。系统会自动创建尚不存在的部门。部门选项可在第三张表维护。"],
  ["学号", "登录账号，2 至 32 位字母、数字、下划线或短横线。按文本填写，保留前导零。字母不区分大小写。"],
  ["手机号", "填写完整的中国大陆手机号，借用物品后用于联系。"],
  ["身份", "普通用户、部门管理员或超级管理员。由超级管理员导入并核对身份。"],
  ["联系邮箱、职位、备注", "选填。联系邮箱用于联系，不是学号登录标识。"],
  ["初始密码", "新账号统一为 513base123。首次登录必须设置个人密码后才能使用系统。"],
  ["重复与冲突", "同一文件重复学号会被标记。数据库已有学号或 Auth 账号不会被覆盖。"],
  ["导入结果", "人员管理中选择本文件，预览校验后导入。每行显示结果，可下载结果表并修正失败行。"],
  ["文件范围", "单次最多 500 人，文件不超过 5 MB。不要更改第一行列名。"],
];
instructions.getRange("A3:B3").format.fill = "#304C42";
instructions.getRange("A3:B3").format.font = { name: "Arial", size: 11, bold: true, color: "#FFFFFF" };
instructions.getRange("A4:B13").format.font = { name: "Arial", size: 11, color: "#26332E" };
instructions.getRange("A3:B13").format.verticalAlignment = "top";
instructions.getRange("A3:B13").format.wrapText = true;
instructions.getRange("A:A").format.columnWidth = 29;
instructions.getRange("B:B").format.columnWidth = 79;
instructions.getRange("A4:B13").format.rowHeight = 45;

options.showGridLines = false;
options.getRange("A1:C1").values = [["部门选项", "身份选项", "身份代码"]];
options.getRange("A2:A9").values = departments.map((name) => [name]);
options.getRange("B2:C4").values = [["普通用户", "member"], ["部门管理员", "admin"], ["超级管理员", "super_admin"]];
options.getRange("A1:C1").format.fill = "#304C42";
options.getRange("A1:C1").format.font = { name: "Arial", size: 11, bold: true, color: "#FFFFFF" };
options.getRange("A2:C9").format.font = { name: "Arial", size: 11, color: "#26332E" };
options.getRange("A:C").format.columnWidth = 26;
options.getRange("A1:C9").format.rowHeight = 25;

console.log((await workbook.inspect({ kind: "table", range: "账号导入模板!A1:H5", include: "values,formulas", tableMaxRows: 5, tableMaxCols: 8 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!", options: { useRegex: true, maxResults: 20 } })).ndjson);
await fs.mkdir(path.join(outputDir, "previews"), { recursive: true });
for (const [sheetName, range, fileName] of [["账号导入模板", "A1:H10", "template"], ["填写说明", "A1:B13", "instructions"], ["部门与身份", "A1:C9", "options"]]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.25, format: "png" });
  await fs.writeFile(path.join(outputDir, "previews", `${fileName}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "account_import_template.xlsx");
await output.save(outputPath);
// ExcelJS requires the default spreadsheet namespace instead of x-prefixed tags.
execFileSync(process.env.PYTHON || "python3", [path.join(root, "tools/normalize_xlsx_namespaces.py"), outputPath]);
const publicDir = path.join(root, "public/templates");
await fs.mkdir(publicDir, { recursive: true });
await fs.copyFile(outputPath, path.join(publicDir, "account_import_template.xlsx"));
console.log(`OUTPUT=${outputPath}`);
