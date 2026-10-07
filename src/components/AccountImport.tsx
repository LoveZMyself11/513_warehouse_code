import { type ChangeEvent, useState } from "react";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { accountFunctionError } from "../auth/accountApi";

interface AccountRow {
  rowNumber: number;
  department: string;
  name: string;
  phone: string;
  studentId: string;
  role: string;
  email: string;
  position: string;
  notes: string;
  error?: string;
  success?: boolean;
}

const columnNames: Record<string, keyof AccountRow> = {
  "部门": "department", "姓名": "name", "手机号": "phone", "电话": "phone",
  "学号": "studentId", "学号/工号": "studentId", "身份": "role", "角色代码": "role",
  "联系邮箱": "email", "职位": "position", "备注": "notes",
  department: "department", name: "name", phone: "phone", student_id: "studentId", role: "role", email: "email", position: "position", notes: "notes",
};
const roles: Record<string, string> = { "普通用户": "member", "部门管理员": "admin", "普通管理员": "admin", "超级管理员": "super_admin" };
const roleLabel: Record<string, string> = { member: "普通用户", admin: "部门管理员", super_admin: "超级管理员" };

function rowError(row: AccountRow) {
  if (!/^[a-z0-9_-]{2,32}$/.test(row.studentId)) return "学号格式不正确";
  if (!row.department || row.department.length > 80) return "部门未填写或超过 80 字";
  if (!row.name || row.name.length > 80) return "姓名未填写或超过 80 字";
  if (!/^(?:\+?86[- ]?)?1[3-9][0-9]{9}$/.test(row.phone)) return "手机号格式不正确";
  if (!["member", "admin", "super_admin"].includes(row.role)) return "身份不正确";
  if (row.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 254)) return "联系邮箱格式不正确";
  if (row.position.length > 80 || row.notes.length > 500) return "职位或备注过长";
  return undefined;
}

export default function AccountImport({ onImported }: { onImported: () => void | Promise<void> }) {
  const { client, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  if (profile?.role !== "super_admin") return null;
  const readyRows = rows.filter((row) => !row.error && !row.success);

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRows([]);
    setMessage(null);
    setCompleted(0);
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) {
      setMessage("请选择不超过 5 MB 的 .xlsx 文件。"); return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.getWorksheet("账号导入模板") || workbook.worksheets[0];
      if (!sheet) throw new Error("文件中没有工作表。");
      let headerRow = 0;
      const columns = new Map<number, keyof AccountRow>();
      for (let rowNumber = 1; rowNumber <= Math.min(15, sheet.rowCount); rowNumber += 1) {
        const found = new Map<number, keyof AccountRow>();
        sheet.getRow(rowNumber).eachCell((cell, column) => {
          const key = columnNames[cell.text.trim()];
          if (key) found.set(column, key);
        });
        if (["department", "name", "phone", "studentId", "role"].every((key) => [...found.values()].includes(key as keyof AccountRow))) {
          headerRow = rowNumber;
          found.forEach((key, column) => columns.set(column, key));
          break;
        }
      }
      if (!headerRow) throw new Error("找不到部门、姓名、手机号、学号、身份列，请使用导入模板。");
      const parsed: AccountRow[] = [];
      sheet.eachRow((excelRow, rowNumber) => {
        if (rowNumber <= headerRow) return;
        const row: AccountRow = { rowNumber, department: "", name: "", phone: "", studentId: "", role: "", email: "", position: "", notes: "" };
        columns.forEach((key, column) => {
          const value = excelRow.getCell(column).text.trim();
          (row as unknown as Record<string, unknown>)[key] = value;
        });
        if (!row.name && !row.studentId && !row.phone) return;
        row.studentId = row.studentId.toLowerCase();
        row.role = roles[row.role] || row.role || "member";
        row.error = rowError(row);
        parsed.push(row);
      });
      if (!parsed.length) throw new Error("模板中没有填写人员信息。");
      if (parsed.length > 500) throw new Error("单次最多导入 500 人，请拆分文件。");
      const counts = new Map<string, number>();
      parsed.forEach((row) => counts.set(row.studentId, (counts.get(row.studentId) || 0) + 1));
      parsed.forEach((row) => { if (counts.get(row.studentId)! > 1) row.error = "文件中存在重复学号"; });
      setRows(parsed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件无法读取，请检查是否为有效 Excel 文件。");
    } finally {
      setBusy(false);
    }
  }

  async function importRows() {
    if (!client || !readyRows.length) return;
    setBusy(true);
    setMessage(null);
    setCompleted(0);
    let imported = 0;
    try {
      for (let start = 0; start < readyRows.length; start += 25) {
        const batch = readyRows.slice(start, start + 25);
        const { data, error } = await client.functions.invoke("import-accounts", { body: { rows: batch } });
        if (error || !Array.isArray(data?.results)) throw new Error(await accountFunctionError(error, data?.error || "导入服务暂不可用。"));
        const results = new Map<number, { success: boolean; error?: string }>(data.results.map((result: { rowNumber: number; success: boolean; error?: string }) => [result.rowNumber, result]));
        imported += Number(data.imported) || 0;
        setRows((current) => current.map((row) => {
          const result = results.get(row.rowNumber);
          return result ? { ...row, success: result.success, error: result.error } : row;
        }));
        setCompleted(Math.min(start + batch.length, readyRows.length));
      }
      setMessage(`已创建 ${imported} 个账号。请查看每行结果。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败，已成功创建的账号会保留。");
    } finally {
      if (imported > 0) {
        try { await onImported(); }
        catch { setMessage(`已创建 ${imported} 个账号，人员列表刷新失败，请关闭后刷新。`); }
      }
      setBusy(false);
    }
  }

  function downloadReport() {
    const csvCell = (value: string) => `"${(/^[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
    const csv = [["Excel 行号", "学号", "姓名", "结果"], ...rows.map((row) => [String(row.rowNumber), row.studentId, row.name, row.success ? "导入成功" : row.error || "待导入"])]
      .map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "513base-账号导入结果.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}><Upload size={17} />批量导入</button>
    {open && <div className="modal-layer" onClick={() => { if (!busy) setOpen(false); }}>
      <section className="modal borrow-modal account-import-modal" role="dialog" aria-modal="true" aria-labelledby="account-import-title" onClick={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">人员管理</p><h2 id="account-import-title">Excel 账号导入</h2></div><button className="icon-button" title="关闭" aria-label="关闭" type="button" disabled={busy} onClick={() => setOpen(false)}><X size={20} /></button></header>
        <form onSubmit={(event) => event.preventDefault()}>
        <div className="heading-actions">
          <a className="secondary-button" download href={`${import.meta.env.BASE_URL}templates/account_import_template.xlsx`}><Download size={17} />下载模板</a>
          <label className="secondary-button"><FileSpreadsheet size={17} />选择 Excel<input type="file" accept=".xlsx" hidden disabled={busy} onChange={(event) => void readFile(event)} /></label>
          {rows.length > 0 && <button className="secondary-button" type="button" onClick={downloadReport}><Download size={17} />导出结果</button>}
        </div>
        {fileName && <p className="muted-text">{fileName} · {rows.length} 人</p>}
        {message && <div className="auth-message" role="status">{message}</div>}
        {busy && <p role="status">{completed > 0 ? `已处理 ${completed} 人` : "正在处理..."}</p>}
        <div className="table-wrap"><table><thead><tr><th>行</th><th>姓名 / 学号</th><th>部门</th><th>手机号</th><th>身份</th><th>结果</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td><td><div className="user-cell"><strong>{row.name}</strong><small>{row.studentId}</small></div></td><td>{row.department}</td><td>{row.phone}</td><td>{roleLabel[row.role] || row.role}</td><td>{row.success ? "导入成功" : row.error || "待导入"}</td>
        </tr>)}</tbody></table></div>
        <div className="form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>关闭</button><button className="primary-button" type="button" disabled={busy || !readyRows.length} onClick={() => void importRows()}><Upload size={17} />导入 {readyRows.length} 个账号</button></div>
        </form>
      </section>
    </div>}
  </>;
}
