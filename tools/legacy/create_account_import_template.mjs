import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outputDir = path.join(root, "artifacts/legacy/account-import");
const outputPath = `${outputDir}/account_import_template.xlsx`;
const previewDir = path.join(outputDir, "previews");
const fontFamily = "Arial";
const departments = ["未分配", "宣传部", "组织部", "竞赛办公室", "文体部", "文艺部", "红承志愿服务队", "学风督导部", "生活部"];

const workbook = Workbook.create();
const template = workbook.worksheets.add("账号导入模板");
const instructions = workbook.worksheets.add("使用说明");
const departmentOptions = workbook.worksheets.add("部门选项");
const roleStats = workbook.worksheets.add("角色统计");

const rows = [];
for (let index = 1; index <= 5; index += 1) {
  rows.push([`SUPER_ADMIN_${String(index).padStart(2, "0")}`, "super_admin", "超级管理员", "", "", "", "", "", "未分配", "", "TRUE", "", ""]);
}
for (let index = 1; index <= 10; index += 1) {
  rows.push([`ADMIN_${String(index).padStart(2, "0")}`, "admin", "普通管理员", "", "", "", "", "", "未分配", "", "TRUE", "", "分配给部门部长或副部长"]);
}
for (let index = 1; index <= 100; index += 1) {
  rows.push([`MEMBER_${String(index).padStart(3, "0")}`, "member", "普通用户", "", "", "", "", "", "未分配", "", "TRUE", "", ""]);
}

template.showGridLines = false;
template.getRange("A1:M1").merge();
template.getRange("A1").values = [["513 仓库账号统一导入模板"]];
template.getRange("A1").format.font = { name: fontFamily, size: 16, bold: true, color: "#18352D" };
template.getRange("A1:M1").format.rowHeight = 28;
template.getRange("A2:M2").merge();
template.getRange("A2").values = [["共 115 个账号占位：5 个超级管理员、10 个普通管理员、100 个普通用户。黄色单元格需要人工填写或核对。"]];
template.getRange("A2").format.font = { name: fontFamily, size: 10, italic: true, color: "#64706B" };
template.getRange("A2:M2").format.rowHeight = 24;
template.getRange("A3:M3").format.borders = { bottom: { style: "thin", color: "#B8C4BE" } };
template.getRange("A4:M4").values = [["模板编号", "角色代码", "角色名称", "职位", "姓名", "学号/工号", "登录邮箱", "初始密码", "部门", "电话", "是否启用", "Auth User UUID", "备注"]];
template.getRange("A5").write(rows);
template.getRange("A4:M4").format.fill = "#18352D";
template.getRange("A4:M4").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
template.getRange("A4:M4").format.horizontalAlignment = "center";
template.getRange("A4:M4").format.verticalAlignment = "center";
template.getRange("A4:M119").format.font = { name: fontFamily, size: 10, color: "#28342F" };
template.getRange("A5:C119").format.fill = "#F1F4F2";
template.getRange("D5:M119").format.fill = "#FFF8DF";
template.getRange("K5:K119").format.fill = "#E7F2EC";
template.getRange("A4:M119").format.borders = { insideHorizontal: { style: "thin", color: "#E6EBE8" }, bottom: { style: "thin", color: "#CFD8D3" } };
template.getRange("A5:A119").setNumberFormat("@");
template.getRange("F5:J119").setNumberFormat("@");
template.getRange("L5:L119").setNumberFormat("@");
template.getRange("A4:M119").format.verticalAlignment = "center";
template.getRange("D5:M119").format.wrapText = true;
template.getRange("B5:B119").dataValidation = { rule: { type: "list", values: ["super_admin", "admin", "member"] } };
template.getRange("D5:D119").dataValidation = { rule: { type: "list", values: ["部长", "副部长", "干事", "其他"] } };
template.getRange("I5:I119").dataValidation = { rule: { type: "list", formula1: "'部门选项'!$A$2:$A$10" } };
template.getRange("K5:K119").dataValidation = { rule: { type: "list", values: ["TRUE", "FALSE"] } };
template.tables.add("A4:M119", true, "AccountImportTable");
template.getRange("A4:M4").format.fill = "#18352D";
template.getRange("A4:M4").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
template.getRange("I10:I19").format.fill = "#FCE8E5";
template.getRange("I10:I19").format.font = { name: fontFamily, size: 10, bold: true, color: "#963D33" };
template.freezePanes.freezeRows(4);
template.freezePanes.freezeColumns(3);
const templateWidths = [18, 16, 14, 14, 14, 16, 25, 18, 22, 16, 13, 38, 30];
templateWidths.forEach((width, index) => { template.getRangeByIndexes(0, index, 119, 1).format.columnWidth = width; });
template.getRange("A4:M119").format.rowHeight = 22;
template.getRange("A1:M2").format.rowHeight = 26;

instructions.showGridLines = false;
instructions.getRange("A1:F1").merge();
instructions.getRange("A1").values = [["使用说明"]];
instructions.getRange("A1").format.font = { name: fontFamily, size: 16, bold: true, color: "#18352D" };
instructions.getRange("A3:B3").values = [["步骤", "说明"]];
instructions.getRange("A4:B11").values = [
  ["1. 填写模板", "补全姓名、学号/工号、登录邮箱、初始密码、部门和联系方式。不要在 GitHub 提交含密码的已填写文件。"],
  ["2. 创建 Auth 账号", "本 Excel 不能直接创建 Supabase Auth 账号。先在 Supabase Authentication 中创建或邀请账号。"],
  ["3. 关联 UUID", "把 Supabase Auth User UUID 填入模板，再关联到 public.users.auth_user_id。"],
  ["4. 分配权限", "由超级管理员在后台分配角色、部门和启用状态。"],
  ["超级管理员", "可维护库存、部门、人员、借用订单和审批等全部后台数据。"],
  ["普通管理员", "分配给各部门部长或副部长，只能维护本部门普通用户并监管本部门借用订单状态。"],
  ["普通用户", "可查看库存、提交库存变更申请、提交借用申请并查看自己的订单。"],
  ["账号安全", "模板不提供默认密码。请为每个真实账号设置独立强密码，并通过安全渠道交付。"],
];
instructions.getRange("A3:B3").format.fill = "#18352D";
instructions.getRange("A3:B3").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
instructions.getRange("A4:B11").format.font = { name: fontFamily, size: 10, color: "#28342F" };
instructions.getRange("A3:B11").format.borders = { insideHorizontal: { style: "thin", color: "#E1E7E3" }, bottom: { style: "thin", color: "#CFD8D3" } };
instructions.getRange("A4:A11").format.font = { name: fontFamily, size: 10, bold: true, color: "#285946" };
instructions.getRange("A3:B11").format.verticalAlignment = "top";
instructions.getRange("A3:B11").format.wrapText = true;
instructions.getRange("A:A").format.columnWidth = 20;
instructions.getRange("B:B").format.columnWidth = 82;
instructions.getRange("A4:B11").format.rowHeight = 42;

departmentOptions.showGridLines = false;
departmentOptions.getRange("A1:B1").values = [["部门选项", "说明"]];
departmentOptions.getRange("A2:B10").values = departments.map((name, index) => [name, index === 0 ? "尚未分配部门时使用" : "当前部门"]);
departmentOptions.getRange("A1:B1").format.fill = "#18352D";
departmentOptions.getRange("A1:B1").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
departmentOptions.getRange("A2:B10").format.font = { name: fontFamily, size: 10, color: "#28342F" };
departmentOptions.getRange("A1:B10").format.borders = { insideHorizontal: { style: "thin", color: "#E1E7E3" }, bottom: { style: "thin", color: "#CFD8D3" } };
departmentOptions.getRange("A:A").format.columnWidth = 24;
departmentOptions.getRange("B:B").format.columnWidth = 28;

roleStats.showGridLines = false;
roleStats.getRange("A1:D1").merge();
roleStats.getRange("A1").values = [["角色数量核对"]];
roleStats.getRange("A1").format.font = { name: fontFamily, size: 16, bold: true, color: "#18352D" };
roleStats.getRange("A3:D3").values = [["角色代码", "目标数量", "模板数量", "核对结果"]];
roleStats.getRange("A4:B7").values = [["super_admin", 5], ["admin", 10], ["member", 100], ["合计", 115]];
roleStats.getRange("C4:C6").formulas = [["=COUNTIF('账号导入模板'!$B$5:$B$119,A4)"], ["=COUNTIF('账号导入模板'!$B$5:$B$119,A5)"], ["=COUNTIF('账号导入模板'!$B$5:$B$119,A6)"]];
roleStats.getRange("C7").formulas = [["=SUM(C4:C6)"]];
roleStats.getRange("D4:D7").formulas = [["=IF(B4=C4,\"一致\",\"需检查\")"], ["=IF(B5=C5,\"一致\",\"需检查\")"], ["=IF(B6=C6,\"一致\",\"需检查\")"], ["=IF(B7=C7,\"一致\",\"需检查\")"]];
roleStats.getRange("A3:D3").format.fill = "#18352D";
roleStats.getRange("A3:D3").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
roleStats.getRange("A4:D7").format.font = { name: fontFamily, size: 11, color: "#28342F" };
roleStats.getRange("A7:D7").format.font = { name: fontFamily, size: 11, bold: true, color: "#18352D" };
roleStats.getRange("A3:D7").format.borders = { insideHorizontal: { style: "thin", color: "#E1E7E3" }, bottom: { style: "thin", color: "#CFD8D3" } };
roleStats.getRange("D4:D7").conditionalFormats.add("containsText", { text: "需检查", format: { fill: "#FCE8E5", font: { color: "#963D33", bold: true } } });
roleStats.getRange("A:D").format.columnWidth = 20;

const keyInspection = await workbook.inspect({
  kind: "table",
  range: "账号导入模板!A1:M12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 13,
});
console.log("KEY_INSPECTION");
console.log(keyInspection.ndjson);
const statsInspection = await workbook.inspect({
  kind: "table",
  range: "角色统计!A1:D7",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 6,
});
console.log("STATS_INSPECTION");
console.log(statsInspection.ndjson);
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log("FORMULA_ERRORS");
console.log(formulaErrors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
const previews = [
  ["账号导入模板", "A1:M18", "template"],
  ["使用说明", "A1:B11", "instructions"],
  ["部门选项", "A1:B10", "departments"],
  ["角色统计", "A1:D7", "stats"],
];
for (const [sheetName, range, fileName] of previews) {
  const preview = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
  await fs.writeFile(path.join(previewDir, `${fileName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
